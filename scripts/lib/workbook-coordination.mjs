import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {loadWorkbook,workId,digest,stableJson,gitRead,resolveRepoPath,fileEvidence,workbookSource,evaluateWorkbookGate,runWorkbookAcceptance} from './workbook-anchor.mjs';

const blocked=(reason,details)=>({decision:'BLOCKED',reason,...(details?{details}: {})});
const ready=(reason,data={})=>({decision:'READY',reason,...data});
const check=(ok,reason)=>{if(!ok)throw Error(reason);};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function atomic(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${crypto.randomUUID()}.tmp`;
  const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,file);
}
const common=repo=>fs.realpathSync(path.resolve(repo,gitRead(repo,['rev-parse','--git-common-dir'])));
const metadata=repo=>path.join(common(repo),'morrowise-workbooks-v1');
function withLock(lock,session,action) {
  fs.mkdirSync(path.dirname(lock),{recursive:true});
  try{fs.mkdirSync(lock);}catch(e){if(e.code==='EEXIST')return blocked('local_lock_held');throw e;}
  const nonce=crypto.randomUUID();atomic(path.join(lock,'owner.json'),{session,session_id:session,pid:process.pid,hostname:os.hostname(),nonce,created_at:new Date().toISOString()});
  try{return action();}finally{if(read(path.join(lock,'owner.json')).nonce===nonce){fs.unlinkSync(path.join(lock,'owner.json'));fs.rmdirSync(lock);}}
}
function live(options) {
  const w=loadWorkbook(options.workbook.home);
  check(w.contract_fingerprint===options.workbook.contract_fingerprint,'workbook_contract_changed');return w;
}
function selected(options) {
  const r=options.workbook.contract.repos.find(r=>r.repo_id===options.repoId);check(r,'repo_not_in_contract');return r;
}
function authorization(options,action,operation) {
  const gate=evaluateWorkbookGate({contract:options.workbook.contract,event:action,operation},options);
  return gate.decision==='allow'?null:blocked(gate.reason);
}
export function inspectWorkbookClaims({repoPath}) {
  const dir=path.join(metadata(repoPath),'claims');if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>{
    try {const claim=read(path.join(dir,f));if(claim.version!==1)throw Error('unsupported');return claim;}
    catch {return {version:null,state:'unknown',home:null,source:path.join(dir,f)};}
  });
}
function dirtyPaths(repo) {
  // Name-only -z includes staged, unstaged, untracked, and both rename endpoints.
  const parts=[gitRead(repo,['diff','--name-only','--no-renames','-z']),gitRead(repo,['diff','--cached','--name-only','--no-renames','-z']),gitRead(repo,['ls-files','--others','--exclude-standard','-z'])];
  return [...new Set(parts.flatMap(s=>s.split('\0').filter(Boolean)))].sort();
}
const overlap=(a,b)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
export function inspectWorkbookRepo(options) {
  try {
    const r=selected(options),repo=r.checkout_root,claims=inspectWorkbookClaims({repoPath:repo}),scope=r.write_paths;
    const dirty=dirtyPaths(repo),head=gitRead(repo,['rev-parse','HEAD']);
    const symbolic=spawnSync('git',['--no-optional-locks','symbolic-ref','--quiet','HEAD'],{cwd:repo,encoding:'utf8'}),ref=symbolic.status===0?symbolic.stdout.trim():null;
    const data={head,ref,dirty_paths:dirty,scope_paths:scope,excluded_paths:dirty.filter(p=>!scope.some(s=>overlap(s,p))),claims};
    if(!ref)return {...blocked('detached_or_unknown_ref'),...data};
    if(gitRead(repo,['ls-files','--unmerged','-z']))return {...blocked('unmerged_index'),...data};
    if(claims.some(c=>c.state==='unknown'))return {...blocked('unknown_work_claim'),...data};
    for(const c of claims.filter(c=>c.state!=='released')) {
      if(c.work_id===workId(options.workbook.contract)) {
        if(c.home!==options.workbook.home||c.contract_fingerprint!==options.workbook.contract_fingerprint)return {...blocked('work_home_or_contract_conflict'),...data};
        if(c.session_id!==options.sessionId)return {...blocked('work_owned_by_other_session'),...data};
      }else if(c.home===options.workbook.home||[...c.scope_paths,...(c.control_paths||[])].some(p=>[...scope,...(r.control_paths||[])].some(s=>overlap(p,s))))return {...blocked('same_file_ownership_conflict'),...data};
    }
    return ready('local_repo_observed',data);
  }catch(e){return blocked(e.message);}
}
const claimFile=(repo,id)=>path.join(metadata(repo),'claims',digest(id)+'.json');
export function acquireWorkbookClaim(options) {
  try {
    options={...options,workbook:live(options)};check(options.sessionId&&options.owner,'owner_required');
    const denied=authorization(options,'implement');if(denied)return denied;
    const r=selected(options);
    return withLock(path.join(metadata(r.checkout_root),'claims.lock'),options.sessionId,()=>{
      const inspected=inspectWorkbookRepo(options);if(inspected.decision!=='READY')return inspected;
      const existing=inspected.claims.find(c=>c.work_id===workId(options.workbook.contract)&&c.state!=='released');
      if(existing)return ready('claim_already_owned',{claim:existing});
      const policyFile=path.join(metadata(r.checkout_root),'admission-policy.json');
      if(fs.existsSync(policyFile)) {const policy=read(policyFile);check(policy.version===1,'unsupported_admission_policy');if(policy.new_workbooks_enabled!==true)return blocked('new_workbook_admissions_disabled');}
      const dirtyOwned=inspected.dirty_paths.filter(p=>[...r.write_paths,...(r.control_paths||[])].some(s=>overlap(s,p)));
      if(dirtyOwned.length&&options.ownershipResolver?.({repo:r.checkout_root,paths:dirtyOwned,session_id:options.sessionId})!==true)return blocked('dirty_scope_requires_owner_handoff');
      const claim={version:1,work_id:workId(options.workbook.contract),home:options.workbook.home,contract_fingerprint:options.workbook.contract_fingerprint,contract_version:1,repo_id:r.repo_id,checkout_root:r.checkout_root,owner:options.owner,session_id:options.sessionId,scope_paths:r.write_paths,control_paths:r.control_paths||[],state:'active',next_action:'implement',updated_at:new Date().toISOString()};
      atomic(claimFile(r.checkout_root,claim.work_id),claim);return ready('work_claim_acquired',{claim});
    });
  }catch(e){return blocked(e.message);}
}
function updateClaim(options,change) {
  try {
    options={...options,workbook:live(options)};const r=selected(options);
    return withLock(path.join(metadata(r.checkout_root),'claims.lock'),options.sessionId,()=>{
      const file=claimFile(r.checkout_root,workId(options.workbook.contract));const claim=read(file);
      check(claim.session_id===options.sessionId&&claim.state!=='released','claim_owner_mismatch');
      check(claim.home===options.workbook.home&&claim.contract_fingerprint===options.workbook.contract_fingerprint,'claim_contract_mismatch');
      const updated={...claim,...change,updated_at:new Date().toISOString()};atomic(file,updated);return ready('claim_updated',{claim:updated});
    });
  }catch(e){return blocked(e.message);}
}
export function handoffWorkbookClaim(options) {
  if(!options.toSessionId||!options.toOwner)return blocked('handoff_target_required');
  return updateClaim(options,{session_id:options.toSessionId,owner:options.toOwner,previous_session:options.sessionId,next_action:options.nextAction||'resume_from_workbook'});
}
export const releaseWorkbookClaim=options=>updateClaim(options,{state:'released',next_action:options.nextAction||'inspect_receipts'});
export const markWorkbookPending=options=>updateClaim(options,{state:'pending_writeback',next_action:'integrate_local_handoff'});

export function setWorkbookAdmissionPolicy({repoPath,sessionId,enabled,policyResolver}) {
  try {
    check(typeof enabled==='boolean'&&sessionId,'admission_policy_input_required');
    const request={repo:fs.realpathSync(repoPath),session_id:sessionId,new_workbooks_enabled:enabled,version:1};
    check(policyResolver?.(request)===true,'admission_policy_authority_required');
    return withLock(path.join(metadata(repoPath),'claims.lock'),sessionId,()=>{atomic(path.join(metadata(repoPath),'admission-policy.json'),{...request,updated_at:new Date().toISOString()});return ready('admission_policy_updated');});
  }catch(e){return blocked(e.message);}
}

export function recoverWorkbookLocks(options) {
  try {
    options={...options,workbook:live(options)};const denied=authorization(options,'implement');if(denied)return denied;
    const r=selected(options),repo=r.checkout_root;
    check(options.stoppedSessionId&&options.sessionId,'recovery_sessions_required');
    return withLock(path.join(metadata(repo),'recovery.lock'),options.sessionId,()=>{
      const paths=[path.join(metadata(repo),'commit.lock'),path.join(metadata(repo),'claims.lock'),...['jv37-local-c1.lock','codex-commit.lock'].map(p=>path.resolve(repo,gitRead(repo,['rev-parse','--git-path',p])))];
      const locks=paths.filter(p=>fs.existsSync(p)).map(p=>({path:p,owner:read(path.join(p,'owner.json'))}));
      for(const {owner} of locks) {
        check(owner.session_id===options.stoppedSessionId&&owner.hostname===os.hostname()&&Number.isInteger(owner.pid)&&owner.nonce,'lock_owner_unverified');
        let stopped=false;try{process.kill(owner.pid,0);}catch(e){stopped=e.code==='ESRCH';}check(stopped,'lock_owner_still_running');
      }
      check(options.lockRecoveryResolver?.({work_id:workId(options.workbook.contract),stopped_session_id:options.stoppedSessionId,to_session_id:options.sessionId,locks})===true,'explicit_lock_recovery_required');
      const recovered=[];
      for(const lock of locks) {
        check(digest(read(path.join(lock.path,'owner.json')))===digest(lock.owner),'lock_owner_changed');
        const archived=path.join(metadata(repo),'recovered-locks',lock.owner.nonce);fs.mkdirSync(path.dirname(archived),{recursive:true});fs.renameSync(lock.path,archived);recovered.push({from:lock.path,to:archived});
      }
      return ready('stopped_owner_locks_archived',{recovered});
    });
  }catch(e){return blocked(e.message);}
}

function gitWrite(repo,args) {
  const r=spawnSync('git',['--literal-pathspecs',...args],{cwd:repo,encoding:'utf8',maxBuffer:16*1024*1024});check(r.status===0,`git_write_failed:${args[0]}:${r.stderr||''}`);return r.stdout.trim();
}
const entriesOutside=(repo,scope)=>gitRead(repo,['ls-files','--stage','-z']).split('\0').filter(x=>x&&!scope.includes(x.slice(x.indexOf('\t')+1))).sort();
function committedMatches(repo,sha,intent) {
  if(gitRead(repo,['rev-parse',`${sha}^`])!==intent.base_sha)return false;
  if(gitRead(repo,['show','-s','--format=%B',sha]).trimEnd()!==intent.message.trimEnd())return false;
  const files=gitRead(repo,['diff-tree','--no-commit-id','--name-only','--no-renames','-z','-r',sha]).split('\0').filter(Boolean).sort();
  if(stableJson(files)!==stableJson([...intent.scope_paths].sort()))return false;
  for(const file of files) {
    const expected=intent.files[file];
    const tree=gitRead(repo,['ls-tree','-z',sha,'--',file]);
    if(expected===null){if(tree)return false;continue;}
    if(!tree)return false;
    const blob=tree.split(' ')[2].split('\t')[0];
    const r=spawnSync('git',['cat-file','blob',blob],{cwd:repo,maxBuffer:64*1024*1024});
    if(r.status!==0||digest(r.stdout)!==expected.sha256)return false;
    if((tree.startsWith('100755')?0o111:0)!==expected.mode)return false;
  }
  return true;
}
export function commitWorkbookC1(options) {
  let intent,file,repo;
  try {
    options={...options,workbook:live(options)};
    const r=selected(options);repo=r.checkout_root;
    const scope=[...new Set(options.scopePaths||[])].sort();
    check(options.eventId&&options.message&&scope.length&&scope.every(p=>r.write_paths.includes(p)),'commit_scope_or_identity_invalid');
    const inspected=inspectWorkbookRepo(options);if(inspected.decision!=='READY')return inspected;
    check(inspected.claims.some(c=>c.work_id===workId(options.workbook.contract)&&c.session_id===options.sessionId&&c.state==='active'),'active_owned_claim_required');
    const key={work_id:workId(options.workbook.contract),contract_fingerprint:options.workbook.contract_fingerprint,event_id:options.eventId,message:options.message,scope_paths:scope};
    file=path.join(metadata(repo),'commits',digest({work_id:key.work_id,event_id:options.eventId})+'.json');
    // Verifiers run without shared mutation locks. Under the short lock, every
    // input and ownership observation is checked again before staging.
    const before=workbookSource(options.workbook),outside=entriesOutside(repo,scope);
    const existingIntent=fs.existsSync(file)?read(file):null;
    if(existingIntent) {check(existingIntent.version===1,'unsupported_commit_journal');check(existingIntent.key_fingerprint===digest(key),'commit_event_payload_conflict');}
    const operation=existingIntent?.operation || {repo_id:r.repo_id,ref:inspected.ref,base_sha:before[r.repo_id].head,scope_paths:scope,message:options.message,files:fileEvidence(repo,scope,{allowMissing:true}),diff_fingerprint:digest(gitRead(repo,['diff','HEAD','--binary','--',...scope])),verifier_fingerprint:digest(options.workbook.contract.acceptance)};
    const denied=authorization(options,'commit',operation);if(denied)return denied;
    const recoveryOnly=existingIntent&&(existingIntent.receipt||gitRead(repo,['rev-parse','HEAD'])!==existingIntent.base_sha);
    const acceptance=recoveryOnly?null:runWorkbookAcceptance(options);
    if(acceptance && acceptance.decision!=='allow')return blocked(acceptance.reason);
    if(acceptance)options.afterVerify?.();
    // Same common-dir serializes commits across linked checkouts. Legacy index lock
    // below also interoperates with local C1 in this checkout.
    return withLock(path.join(metadata(repo),'commit.lock'),options.sessionId,()=>withLock(path.join(metadata(repo),'claims.lock'),options.sessionId,()=>withLock(path.resolve(repo,gitRead(repo,['rev-parse','--git-path','jv37-local-c1.lock'])),options.sessionId,()=>withLock(path.resolve(repo,gitRead(repo,['rev-parse','--git-path','codex-commit.lock'])),options.sessionId,()=>{
      const locked=inspectWorkbookRepo(options);check(locked.decision==='READY'&&locked.claims.some(c=>c.work_id===workId(options.workbook.contract)&&c.session_id===options.sessionId&&c.state==='active'),'active_claim_changed_before_commit');
      const refreshed=authorization(options,'commit',operation);if(refreshed)return refreshed;
      if(fs.existsSync(file)) {
        intent=read(file);check(intent.version===1,'unsupported_commit_journal');check(intent.key_fingerprint===digest(key),'commit_event_payload_conflict');
        if(intent.receipt) {
          check(intent.receipt.c1_sha===intent.c1_sha&&intent.receipt.base_sha===intent.base_sha&&stableJson(intent.receipt.scope_paths)===stableJson(scope)&&digest(intent.receipt.acceptance)===digest(intent.acceptance),'recorded_receipt_conflict');
          return finish();
        }
        const head=gitRead(repo,['rev-parse','HEAD']);
        if(head!==intent.base_sha) {
          const candidates=gitRead(repo,['rev-list',`${intent.base_sha}..${head}`]).split('\n').filter(Boolean).filter(sha=>committedMatches(repo,sha,intent));
          check(candidates.length===1,'commit_recovery_ambiguous');intent.c1_sha=candidates[0];
          return finish();
        }
        check(digest(fileEvidence(repo,scope,{allowMissing:true}))===digest(intent.files),'interrupted_intent_source_changed');
      }
      // A prepared intent without a commit must be explicitly retried with a
      // fresh verifier; deleting the journal to reuse an event is never allowed.
      const verified=acceptance;
      check(verified,'fresh_verification_required');
      if(verified.decision!=='allow')return blocked(verified.reason);
      check(digest(before)===digest(workbookSource(options.workbook)),'source_changed_after_verifier');
      for(const result of verified.receipt.results) {
        const a=options.workbook.contract.acceptance.find(a=>a.id===result.id);
        check(fs.realpathSync(a.command)===result.executable.path&&digest(fs.readFileSync(a.command))===result.executable.sha256,'verified_executable_changed_before_commit');
      }
      check(stableJson(outside)===stableJson(entriesOutside(repo,scope)),'foreign_index_changed_after_verifier');
      check(digest(fileEvidence(repo,scope,{allowMissing:true}))===digest(operation.files),'approved_commit_files_changed');
      const afterInspect=inspectWorkbookRepo(options);check(afterInspect.decision==='READY','ownership_changed_after_verifier');
      check(afterInspect.ref===operation.ref,'approved_commit_ref_changed');
      check(live(options).contract_fingerprint===options.workbook.contract_fingerprint,'contract_changed_after_verifier');
      const changed=afterInspect.dirty_paths.filter(p=>scope.includes(p)).sort();check(stableJson(changed)===stableJson(scope),'commit_scope_has_unchanged_paths');
      intent={version:1,...key,key_fingerprint:digest(key),operation,base_sha:before[r.repo_id].head,files:fileEvidence(repo,scope,{allowMissing:true}),acceptance:verified.receipt,session_id:options.sessionId,owner:options.owner,state:'prepared',created_at:new Date().toISOString()};atomic(file,intent);
      // Exact path staging supports new files; --only excludes every foreign entry.
      gitWrite(repo,['add','--',...scope]);
      check(digest(before)===digest(workbookSource(options.workbook)),'source_changed_before_commit');
      gitWrite(repo,['commit','--only','-m',options.message,'--',...scope]);
      intent.c1_sha=gitRead(repo,['rev-parse','HEAD']);atomic(file,intent);
      options.afterCommit?.();
      check(stableJson(outside)===stableJson(entriesOutside(repo,scope)),'foreign_index_changed_by_commit');
      return finish();
      function finish() {
        check(committedMatches(repo,intent.c1_sha,intent),'post_commit_review_failed');
        const receipt={version:1,...key,base_sha:intent.base_sha,c1_sha:intent.c1_sha,acceptance:intent.acceptance,state:'committed_local',pending_delivery:true,review:'commit_object_matches_verified_source',verified_at:intent.acceptance.verified_at};
        // Git note is a portable optional reference; the durable intent remains if
        // notes fail. Never repeat an already matched commit to repair a receipt.
        const note=spawnSync('git',['notes','--ref=refs/notes/morrowise-workbook-v1','show',intent.c1_sha],{cwd:repo,encoding:'utf8'});
        if(note.status===0)check(stableJson(JSON.parse(note.stdout))===stableJson(receipt),'workbook_note_conflict');
        else gitWrite(repo,['notes','--ref=refs/notes/morrowise-workbook-v1','add','-m',JSON.stringify(receipt),intent.c1_sha]);
        intent.receipt=receipt;intent.state='committed_local';atomic(file,intent);return ready('workbook_committed_local',{receipt});
      }
    }))));
  }catch(e){return blocked(intent?.c1_sha?'committed_receipt_pending':e.message,intent?.c1_sha?{c1_sha:intent.c1_sha,reason:e.message,intent_ref:file}:undefined);}
}
