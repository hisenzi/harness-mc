import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {inspectSessionHandoff, verifySessionCommit} from './lib/session-handoff.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'session-handoff-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repo=path.join(root,'repo'); fs.mkdirSync(repo);
  const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8'}); assert.equal(r.status,0,r.stderr); return r.stdout.trim();};
  git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  fs.writeFileSync(path.join(repo,'base.txt'),'base\n');git('add','base.txt');git('commit','-m','base');
  const base=git('rev-parse','HEAD');git('switch','-c','codex/test');
  fs.writeFileSync(path.join(repo,'change.txt'),'one\n');
  fs.writeFileSync(path.join(repo,'verify.mjs'),"import fs from 'node:fs'; if(fs.readFileSync('change.txt','utf8')!=='one\\n') process.exit(1);\n");
  git('add','change.txt','verify.mjs');git('commit','-m','change');
  const head=git('rev-parse','HEAD');git('remote','add','origin','https://github.com/example/repo.git');
  const packet={version:1,task_ref:'https://github.com/example/repo/issues/6',repository:'example/repo',branch:'codex/test',target_branch:'main',base_sha:base,scope_paths:['change.txt','verify.mjs'],handoff:{source_session:'source-session',state:'released',head_sha:head},verifier:{id:'content',command:process.execPath,args:['verify.mjs']}};
  const remote={main:base,head,offline:false,pr:null};const calls=[];
  const runner=(command,args,opts)=>{
    calls.push([command,args]);
    if(command==='git'&&args.includes('ls-remote'))return remote.offline?{status:1,stdout:'',stderr:'offline'}:{status:0,stdout:`${remote.main}\trefs/heads/main\n${remote.head||''}${remote.head?'\trefs/heads/codex/test\n':''}`,stderr:''};
    if(command==='gh')return remote.offline?{status:1,stdout:'',stderr:'offline'}:{status:0,stdout:JSON.stringify(remote.pr?[{isCrossRepository:false,...remote.pr}]:[]),stderr:''};
    return spawnSync(command,args,opts);
  };
  const inspect=()=>inspectSessionHandoff({repoPath:repo,packet,runner});
  const verify=()=>verifySessionCommit({repoPath:repo,packet,sessionId:'receiver',runner});
  return {root,repo,git,base,head,packet,remote,calls,inspect,verify,runner};
}

test('new session recovers approved lane facts without granting operation authority',t=>{
  const f=fixture(t),r=f.inspect();
  assert.equal(r.local.head_sha,f.head);assert.equal(r.local.branch,'codex/test');
  assert.equal(r.verification.local,'not_recorded');assert.equal(r.next_action,'verify_commit');
  assert.equal(r.operation_authority,'external_approval_required');
  assert.equal(r.handoff.source_session,'source-session');assert.equal(r.read_only,true);
  assert(!f.calls.some(([c,a])=>c==='git'&&a.some(x=>['fetch','add','commit','push','merge','switch','checkout','reset','clean'].includes(x))));
});
test('real verifier binds clean commit and remains discoverable from another call',t=>{
  const f=fixture(t),r=f.verify();assert.equal(r.decision,'READY');
  const observed=f.inspect();assert.equal(observed.verification.local,'passed');
  assert.equal(observed.verification.verified_commit,f.head);assert.equal(observed.next_action,'create_draft_pr');
});
test('new commit invalidates prior pass without erasing historical verified commit',t=>{
  const f=fixture(t);f.verify();fs.writeFileSync(path.join(f.repo,'change.txt'),'two\n');f.git('add','change.txt');f.git('commit','-m','next');
  f.packet.handoff.head_sha=f.git('rev-parse','HEAD');
  const r=f.inspect();assert.equal(r.verification.local,'stale');assert.equal(r.verification.verified_commit,f.head);assert.equal(r.next_action,'verify_commit');
});
test('dirty tree cannot borrow commit proof',t=>{
  const f=fixture(t);f.verify();fs.writeFileSync(path.join(f.repo,'change.txt'),'two\n');
  assert.equal(f.inspect().verification.local,'dirty');assert.equal(f.verify().reason,'dirty_checkout');
});
test('index flags cannot hide modified source behind a clean status',t=>{
  for(const flag of ['--assume-unchanged','--skip-worktree']) {
    const f=fixture(t);f.git('update-index',flag,'change.txt');
    fs.writeFileSync(path.join(f.repo,'change.txt'),'two\n');
    assert.equal(f.git('status','--porcelain'),'');
    f.packet.verifier.args=['-e',"if(require('fs').readFileSync('change.txt','utf8')!=='two\\n')process.exit(1)"];
    assert.equal(f.verify().reason,'index_hides_worktree_changes');
    assert.deepEqual(f.inspect().local.hidden_paths,['change.txt']);
  }
});
test('unrelated dirty is named without content and blocks this isolated pilot',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.repo,'foreign.txt'),'unrelated');
  const r=f.inspect();assert.equal(r.reason,'dirty_outside_scope');assert.deepEqual(r.local.outside_scope,['foreign.txt']);
});
test('failed verifier never produces a pass',t=>{
  const f=fixture(t);f.packet.verifier.args=['-e','process.exit(9)'];
  assert.equal(f.verify().reason,'verifier_failed');assert.equal(f.inspect().verification.local,'failed');
});
test('verifier mutation invalidates result even with exit zero',t=>{
  const f=fixture(t);f.packet.verifier.args=['-e',"require('fs').writeFileSync('change.txt','mutated')"];
  assert.equal(f.verify().reason,'verifier_changed_source');
});
test('missing released handoff is never interpreted as abandonment',t=>{
  const f=fixture(t);f.packet.handoff.state='active';assert.equal(f.inspect().reason,'handoff_not_released');
});
test('changed HEAD requires a refreshed handoff',t=>{
  const f=fixture(t);f.packet.handoff.head_sha=f.base;assert.equal(f.inspect().reason,'handoff_head_changed');
});
test('wrong branch and repository are rejected',t=>{
  const f=fixture(t);f.packet.branch='codex/other';assert.equal(f.inspect().reason,'branch_mismatch');
  f.packet.branch='codex/test';f.packet.repository='other/repo';assert.equal(f.inspect().reason,'repository_mismatch');
});
test('unsafe paths, missing scope and duplicate scope are rejected',t=>{
  for(const scope of [[],['../escape'],['.'],['change.txt','change.txt'],['*.md']]){
    const f=fixture(t);f.packet.scope_paths=scope;assert.equal(f.inspect().reason,'invalid_packet');
  }
});
test('committed outside-scope paths cannot hide behind clean worktree',t=>{
  const f=fixture(t);f.packet.scope_paths=['change.txt'];assert.equal(f.inspect().reason,'commits_outside_scope');
});
test('outside-scope commits remain blocked even when subsequently reverted',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.repo,'foreign.txt'),'x');f.git('add','foreign.txt');f.git('commit','-m','foreign');
  f.git('rm','foreign.txt');f.git('commit','-m','remove foreign');f.packet.handoff.head_sha=f.git('rev-parse','HEAD');
  assert.equal(f.inspect().reason,'commits_outside_scope');
});
test('formal CLI rejects invalid packets through both session routes',t=>{
  const f=fixture(t),input=path.join(f.root,'invalid.json');fs.writeFileSync(input,'{}');
  for(const command of ['session-inspect','session-verify']) {
    const cli=fileURLToPath(new URL('./repo-coordination-runtime.mjs',import.meta.url));
    const r=spawnSync(process.execPath,[cli,command,'--repo',f.repo,'--input',input,'--session','receiver'],{encoding:'utf8'});
    assert.equal(r.status,2,r.stderr);assert.equal(JSON.parse(r.stdout).reason,'invalid_packet');
  }
});
test('unreachable base is rejected',t=>{
  const f=fixture(t);f.packet.base_sha='f'.repeat(40);assert.equal(f.inspect().reason,'base_unavailable');
});
test('symlink scope is rejected',t=>{
  const f=fixture(t);fs.symlinkSync('/tmp',path.join(f.repo,'escape'));f.packet.scope_paths.push('escape/file');
  assert.equal(f.inspect().reason,'scope_symlink');
});
test('offline remote stays unknown, never no PR or delivered',t=>{
  const f=fixture(t);f.verify();f.remote.offline=true;
  const r=f.inspect();assert.equal(r.remote.status,'unknown');assert.equal(r.next_action,'refresh_remote');
});
test('target advances: local proof survives, integration requires recheck',t=>{
  const f=fixture(t);f.verify();f.remote.main='e'.repeat(40);
  const r=f.inspect();assert.equal(r.verification.local,'passed');assert.equal(r.verification.integration,'stale');assert.equal(r.next_action,'refresh_target_and_verify_integration');
});
test('matching draft PR remains waiting for human merge review',t=>{
  const f=fixture(t);f.verify();f.remote.pr={number:7,url:'https://github.com/example/repo/pull/7',state:'OPEN',isDraft:true,headRefName:f.packet.branch,headRefOid:f.head,baseRefName:'main',mergedAt:null,mergeCommit:null};
  const r=f.inspect();assert.equal(r.delivery,'draft_pr');assert.equal(r.next_action,'request_merge_review');
});
test('wrong PR head cannot masquerade as tested current delivery',t=>{
  const f=fixture(t);f.verify();f.remote.pr={state:'OPEN',headRefName:f.packet.branch,headRefOid:f.base,baseRefName:'main'};
  assert.equal(f.inspect().next_action,'refresh_pr_head');
});
test('closed unmerged PR is not merged',t=>{
  const f=fixture(t);f.verify();f.remote.pr={state:'CLOSED',headRefName:f.packet.branch,headRefOid:f.head,baseRefName:'main',mergedAt:null,mergeCommit:null};
  const r=f.inspect();assert.equal(r.delivery,'closed_unmerged');assert.equal(r.next_action,'resolve_closed_pr');
});
test('reported merged PR without reachable target evidence cannot authorize cleanup',t=>{
  const f=fixture(t);f.verify();f.remote.pr={state:'MERGED',headRefName:f.packet.branch,headRefOid:f.head,baseRefName:'main',mergedAt:'2026-09-20T00:00:00Z',mergeCommit:{oid:'c'.repeat(40)}};
  assert.equal(f.inspect().next_action,'fetch_and_verify_merge');
});
test('merged ancestry requires target verification and cannot authorize cleanup',t=>{
  const f=fixture(t);f.verify();f.remote.main=f.head;f.remote.head=null;
  f.remote.pr={state:'MERGED',headRefName:f.packet.branch,headRefOid:f.head,baseRefName:'main',mergedAt:'2026-09-20T00:00:00Z',mergeCommit:{oid:f.head}};
  const r=f.inspect();assert.equal(r.delivery,'merged_observed');assert.equal(r.next_action,'verify_merged_target');assert.equal(r.read_only,true);
});
test('edited verifier definition cannot inherit existing pass',t=>{
  const f=fixture(t);f.verify();f.packet.verifier.args=['-e','process.exit(0)'];assert.equal(f.inspect().verification.local,'stale');
});
test('interrupted retry cannot borrow an earlier pass',t=>{
  const f=fixture(t);assert.equal(f.verify().decision,'READY');
  const runner=(command,args,options)=>{if(command===f.packet.verifier.command)throw new Error('interrupted');return f.runner(command,args,options);};
  assert.equal(verifySessionCommit({repoPath:f.repo,packet:f.packet,sessionId:'receiver',runner}).reason,'verification_unavailable');
  const observed=f.inspect();assert.equal(observed.verification.local,'incomplete');assert.equal(observed.verification.verified_commit,f.head);
});
test('main moving during verification prevents a current pass',t=>{
  const f=fixture(t);
  const runner=(command,args,options)=>{if(command===f.packet.verifier.command)f.remote.main='e'.repeat(40);return f.runner(command,args,options);};
  assert.equal(verifySessionCommit({repoPath:f.repo,packet:f.packet,sessionId:'receiver',runner}).reason,'remote_changed_during_verification');
  assert.equal(f.inspect().verification.local,'failed');
});
test('fork PR with the same branch name remains unknown',t=>{
  const f=fixture(t);f.verify();f.remote.pr={isCrossRepository:true,state:'OPEN',headRefName:f.packet.branch,headRefOid:f.head,baseRefName:'main'};
  const observed=f.inspect();assert.equal(observed.remote.reason,'pr_repository_unverified');assert.equal(observed.next_action,'refresh_remote');
});

test('REVIEW: later failure invalidates same-commit prior success',t=>{
 const f=fixture(t),gate=path.join(f.root,'fail-now');
 f.packet.verifier.args=['-e',`if(require('fs').existsSync(${JSON.stringify(gate)}))process.exit(9)`];
 assert.equal(f.verify().decision,'READY');
 fs.writeFileSync(gate,'fail');
 assert.equal(f.verify().reason,'verifier_failed');
 const r=f.inspect();
 assert.notEqual(r.verification.local,'passed');
});
test('REVIEW: index changes require re-binding dirty handoff',t=>{
 const f=fixture(t),file=path.join(f.repo,'change.txt');
 fs.writeFileSync(file,'two\n');f.git('add','change.txt');fs.writeFileSync(file,'one\n');
 let r=f.inspect(); f.packet.handoff.working_diff_sha256=r.local.working_diff_sha256;
 assert.equal(f.inspect().next_action,'review_and_commit_scope');
 fs.writeFileSync(file,'three\n');f.git('add','change.txt');fs.writeFileSync(file,'one\n');
 r=f.inspect();
 assert.equal(r.reason,'dirty_handoff_unbound');
});
test('REVIEW: ancestry alone cannot verify merged result',t=>{
 const f=fixture(t);assert.equal(f.verify().decision,'READY');
 f.git('switch','main');fs.writeFileSync(path.join(f.repo,'change.txt'),'bad\n');f.git('add','change.txt');f.git('commit','-m','main concurrent edit');
 const merge=spawnSync('git',['merge','--no-ff','--no-commit','codex/test'],{cwd:f.repo,encoding:'utf8'});assert.equal(merge.status,1);
 fs.writeFileSync(path.join(f.repo,'change.txt'),'bad\n');f.git('add','change.txt');f.git('commit','-m','merge while keeping main edit');
 const mergeSha=f.git('rev-parse','HEAD');
 assert.equal(spawnSync(process.execPath,['verify.mjs'],{cwd:f.repo,encoding:'utf8'}).status,1);
 f.git('switch','codex/test');f.remote.main=mergeSha;
 f.remote.pr={state:'MERGED',headRefName:f.packet.branch,headRefOid:f.head,baseRefName:'main',mergedAt:'2026-09-20T00:00:00Z',mergeCommit:{oid:mergeSha}};
 const r=f.inspect();
 assert.notEqual(r.delivery,'merged_verified');
});

test('REVIEW: backward clock does not revive a prior pass after failed retry',t=>{
 const f=fixture(t),gate=path.join(f.root,'fail-now-clock');
 f.packet.verifier.args=['-e',`if(require('fs').existsSync(${JSON.stringify(gate)}))process.exit(9)`];
 assert.equal(f.verify().decision,'READY');fs.writeFileSync(gate,'fail');
 const NativeDate=Date;
 try {
  globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[NativeDate.now()-3600000]));}};
  assert.equal(f.verify().reason,'verifier_failed');
 }finally{globalThis.Date=NativeDate;}
 const r=f.inspect();
 assert.notEqual(r.verification.local,'passed');
});
