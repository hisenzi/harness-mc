import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// Evidence only. This note is not a task registry, an owner lock or human approval.
const NOTES='refs/notes/jv37-session-verification';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const producerDigest=()=>hash(fs.readFileSync(fileURLToPath(import.meta.url)));
const sha=value=>typeof value==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const safeRef=value=>nonempty(value)&&!value.startsWith('-')&&!/[\s~^:?*\[\\]/.test(value)&&!value.includes('..')&&!value.includes('//')&&!value.includes('@{')&&!value.endsWith('/')&&!value.endsWith('.')&&!value.endsWith('.lock');
const safePath=value=>nonempty(value)&&!path.isAbsolute(value)&&value!=='.'&&path.posix.normalize(value)===value&&!value.split('/').some(p=>['..','.git'].includes(p))&&!/[\x00-\x1f*?\[\\]/.test(value);
function validPacket(p) {
  return p?.version===1&&nonempty(p.task_ref)&&/^[\w.-]+\/[\w.-]+$/.test(p.repository||'')&&safeRef(p.branch)&&safeRef(p.target_branch)&&p.branch!==p.target_branch&&sha(p.base_sha)
    &&Array.isArray(p.scope_paths)&&p.scope_paths.length>0&&p.scope_paths.every(safePath)&&new Set(p.scope_paths).size===p.scope_paths.length
    &&nonempty(p.handoff?.source_session)&&sha(p.handoff?.head_sha)
    &&(p.pr_number===undefined||(Number.isInteger(p.pr_number)&&p.pr_number>0))
    &&nonempty(p.verifier?.id)&&nonempty(p.verifier?.command)&&Array.isArray(p.verifier?.args)&&p.verifier.args.every(x=>typeof x==='string');
}
function context(repoPath,runner=spawnSync) {
  const cwd=fs.realpathSync(repoPath);
  const run=(command,args,timeout=20000)=>{
    const r=runner(command,args,{cwd,encoding:'utf8',timeout,maxBuffer:4*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}});
    return {status:r.status??1,stdout:r.stdout||'',stderr:r.stderr||''};
  };
  const git=(...args)=>run('git',['--no-optional-locks',...args]);
  return {cwd,run,git};
}
function githubRepository(url) {
  // Never return a remote URL: it may contain credentials.
  const m=/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url.trim());
  return m?.[1]||null;
}
function inspectLocal(c,p) {
  for(const rel of p.scope_paths) {
    let cursor=c.cwd;
    for(const segment of rel.split('/')) {
      cursor=path.join(cursor,segment);
      if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())return {error:'scope_symlink'};
    }
  }
  const head=c.git('rev-parse','HEAD').stdout.trim();
  const branch=c.git('symbolic-ref','--quiet','--short','HEAD').stdout.trim();
  const root=c.git('rev-parse','--show-toplevel').stdout.trim();
  if(!sha(head)||!root||fs.realpathSync(root)!==c.cwd)return {error:'checkout_unavailable'};
  const status=c.git('status','--porcelain=v1','-z','--untracked-files=all');
  if(status.status!==0)return {error:'status_unavailable'};
  const entries=status.stdout.split('\0').filter(Boolean),dirty=[];
  for(let i=0;i<entries.length;i++) {
    const entry=entries[i];dirty.push(entry.slice(3));
    if(/[RC]/.test(entry.slice(0,2)))dirty.push(entries[++i]);
  }
  const outside=dirty.filter(x=>!p.scope_paths.includes(x));
  const tree=c.git('rev-parse','HEAD^{tree}').stdout.trim();
  const local={head_sha:head,branch,tree_sha:tree,dirty_paths:dirty,outside_scope:outside};
  if(branch!==p.branch)return {local,error:'branch_mismatch'};
  if(githubRepository(c.git('remote','get-url','origin').stdout)!==p.repository)return {local,error:'repository_mismatch'};
  const tracked=c.git('ls-files','-v','-z');
  if(tracked.status!==0)return {local,error:'index_unavailable'};
  local.hidden_paths=tracked.stdout.split('\0').filter(x=>x&&(/[a-z]/.test(x[0])||x[0]==='S')).map(x=>x.slice(2));
  if(local.hidden_paths.length)return {local,error:'index_hides_worktree_changes'};
  if(c.git('cat-file','-e',`${p.base_sha}^{commit}`).status!==0)return {local,error:'base_unavailable'};
  if(c.git('merge-base','--is-ancestor',p.base_sha,head).status!==0)return {local,error:'base_not_ancestor'};
  const history=c.git('rev-list',`${p.base_sha}..${head}`);
  if(history.status!==0)return {local,error:'history_unavailable'};
  const allChanged=[];
  for(const commit of history.stdout.trim().split('\n').filter(Boolean)) {
    const delta=c.git('diff-tree','--no-commit-id','--name-only','--no-renames','-r','-z','--root','-m',commit);
    if(delta.status!==0)return {local,error:'history_unavailable'};
    allChanged.push(...delta.stdout.split('\0').filter(Boolean));
  }
  const changed=[...new Set(allChanged)];
  local.committed_paths=changed;
  if(changed.some(x=>!p.scope_paths.includes(x)))return {local,error:'commits_outside_scope'};
  if(c.git('ls-files','--unmerged').stdout)return {local,error:'unmerged_index'};
  if(outside.length)return {local,error:'dirty_outside_scope'};
  const staged=c.git('diff','--cached','HEAD','--binary','--',...p.scope_paths);
  const unstaged=c.git('diff','--binary','--',...p.scope_paths);
  if(staged.status!==0||unstaged.status!==0)return {local,error:'diff_unavailable'};
  const untracked=c.git('ls-files','--others','--exclude-standard','-z','--',...p.scope_paths).stdout.split('\0').filter(Boolean);
  const untrackedHashes=untracked.map(rel=>[rel,hash(fs.readFileSync(path.join(c.cwd,rel)))]);
  local.working_diff_sha256=hash(JSON.stringify([staged.stdout,unstaged.stdout,untrackedHashes]));
  return {local};
}
function readRemote(c,p) {
  const refs=c.git('ls-remote','--refs','origin',`refs/heads/${p.target_branch}`,`refs/heads/${p.branch}`);
  if(refs.status!==0)return {status:'unknown',reason:'remote_unavailable',pr:null};
  const map=new Map(refs.stdout.split(/\r?\n/).filter(Boolean).map(x=>{const [oid,ref]=x.split(/\s+/);return [ref,oid];}));
  const target=map.get(`refs/heads/${p.target_branch}`),head=map.get(`refs/heads/${p.branch}`)||null;
  if(!sha(target)||(head&&!sha(head)))return {status:'unknown',reason:'remote_ref_unavailable',pr:null};
  const prs=c.run('gh',['pr','list','--repo',p.repository,'--head',p.branch,'--state','all','--limit','100','--json','number,url,state,isDraft,headRefName,headRefOid,baseRefName,mergedAt,mergeCommit,isCrossRepository']);
  if(prs.status!==0)return {status:'unknown',reason:'pr_unavailable',target_sha:target,branch_sha:head,pr:null};
  try {
    const all=JSON.parse(prs.stdout);
    if(!Array.isArray(all))throw new Error();
    if(all.some(pr=>pr.isCrossRepository!==false))return {status:'unknown',reason:'pr_repository_unverified',target_sha:target,branch_sha:head,pr:null};
    const matching=all.filter(pr=>pr.headRefName===p.branch&&pr.baseRefName===p.target_branch&&(p.pr_number===undefined||pr.number===p.pr_number));
    if(matching.length>1||(!matching.length&&all.length))return {status:'unknown',reason:'pr_identity_ambiguous',target_sha:target,branch_sha:head,pr:null};
    if(p.pr_number!==undefined&&!matching.length)return {status:'unknown',reason:'pr_missing',target_sha:target,branch_sha:head,pr:null};
    return {status:'observed',target_sha:target,branch_sha:head,pr:matching[0]||null};
  } catch {return {status:'unknown',reason:'pr_invalid',target_sha:target,branch_sha:head,pr:null};}
}
function proofValid(c,p,proof) {
  return proof?.version===1&&proof.kind==='session_verification'&&['started','failed','passed'].includes(proof.status)&&sha(proof.commit_sha)&&sha(proof.tree_sha)&&nonempty(proof.session_id)
    &&proof.task_ref===p.task_ref&&proof.repository===p.repository&&proof.branch===p.branch
    &&/^[a-f0-9]{64}$/.test(proof.verifier_fingerprint||'')&&/^[a-f0-9]{64}$/.test(proof.producer_sha256||'')&&sha(proof.target_sha)
    &&/^[a-f0-9]{64}$/.test(proof.output_sha256||'')&&!Number.isNaN(Date.parse(proof.recorded_at||proof.verified_at))
    &&c.git('rev-parse',`${proof.commit_sha}^{tree}`).stdout.trim()===proof.tree_sha;
}
function verificationHistory(c,p,head) {
  const notes=c.git('notes',`--ref=${NOTES}`,'list');
  if(notes.status!==0)return [];
  const reachable=[];
  for(const line of notes.stdout.trim().split('\n').filter(Boolean)) {
    const commit=line.split(/\s+/)[1];
    if(!sha(commit)||c.git('merge-base','--is-ancestor',commit,head).status!==0)continue;
    const content=c.git('notes',`--ref=${NOTES}`,'show',commit);
    if(content.status!==0)continue;
    for(const value of content.stdout.split('\n').filter(Boolean))try {
      const proof=JSON.parse(value);
      if(proof.commit_sha===commit&&proofValid(c,p,proof))reachable.push({...proof,sequence:reachable.length});
    } catch { /* malformed local records never become a pass */ }
  }
  // Notes append order is authoritative within a commit, even after clock rollback.
  return reachable.sort((a,b)=>a.commit_sha===b.commit_sha?b.sequence-a.sequence:Number(b.commit_sha===head)-Number(a.commit_sha===head)||Date.parse(b.recorded_at||b.verified_at)-Date.parse(a.recorded_at||a.verified_at));
}

export function inspectSessionHandoff({repoPath,packet:p,runner=spawnSync}) {
  const result={version:1,read_only:true,operation_authority:'external_approval_required',decision:'OBSERVED',reason:'session_observed',next_action:'verify_commit',delivery:'local_only',verification:{local:'not_recorded',verified_commit:null,integration:'not_recorded'}};
  const block=reason=>({...result,decision:'BLOCKED',reason,next_action:'resolve_'+reason});
  if(!validPacket(p))return block('invalid_packet');
  try {
    const c=context(repoPath,runner),snapshot=inspectLocal(c,p);
    result.task_ref=p.task_ref;result.handoff={...p.handoff};result.local=snapshot.local;
    if(snapshot.error)return block(snapshot.error);
    const local=snapshot.local,history=verificationHistory(c,p,local.head_sha);
    const proof=history.find(x=>x.status==='passed'),latest=history[0];
    if(proof)result.verification={local:proof.commit_sha===local.head_sha&&proof.verifier_fingerprint===hash(JSON.stringify(p.verifier))&&proof.producer_sha256===producerDigest()?'passed':'stale',verified_commit:proof.commit_sha,verified_at:proof.verified_at,integration:'not_recorded',recorded_target_sha:proof.target_sha};
    if(latest?.commit_sha===local.head_sha&&latest.status!=='passed') {
      result.verification.local=latest.status==='failed'?'failed':'incomplete';
      result.verification.last_attempt={status:latest.status,reason:latest.reason||'verification_interrupted',recorded_at:latest.recorded_at};
    }
    if(local.dirty_paths.length)result.verification.local='dirty';
    if(p.handoff.state!=='released')return block('handoff_not_released');
    if(p.handoff.head_sha!==local.head_sha)return block('handoff_head_changed');
    if(local.dirty_paths.length&&p.handoff.working_diff_sha256!==local.working_diff_sha256)return block('dirty_handoff_unbound');
    result.remote=readRemote(c,p);
    if(local.dirty_paths.length){result.next_action='review_and_commit_scope';return result;}
    if(result.verification.local!=='passed')return result;
    const remote=result.remote;
    if(remote.status!=='observed'){result.next_action='refresh_remote';return result;}
    const pr=remote.pr;
    if(pr?.state==='MERGED') {
      const merged=pr.mergeCommit?.oid;
      if(pr.headRefOid!==local.head_sha){result.next_action='review_post_merge_commits';return result;}
      // Squash requires separate mapped-patch evidence; do not assume ancestry.
      if(!pr.mergedAt||!sha(merged)||c.git('merge-base','--is-ancestor',merged,remote.target_sha).status!==0||c.git('merge-base','--is-ancestor',local.head_sha,remote.target_sha).status!==0){result.next_action='fetch_and_verify_merge';return result;}
      result.delivery='merged_observed';result.verification.integration='merged_target_requires_verification';result.next_action='verify_merged_target';return result;
    }
    if(pr?.state==='CLOSED'){result.delivery='closed_unmerged';result.next_action='resolve_closed_pr';return result;}
    if(proof.target_sha!==remote.target_sha){result.verification.integration='stale';result.next_action='refresh_target_and_verify_integration';return result;}
    result.verification.integration=c.git('merge-base','--is-ancestor',remote.target_sha,local.head_sha).status===0?'passed_on_target_descendant':'required';
    if(result.verification.integration==='required'){result.next_action='refresh_target_and_verify_integration';return result;}
    if(remote.branch_sha!==local.head_sha){result.next_action='push_reviewed_commit';return result;}
    result.delivery='branch_pushed';
    if(!pr){result.next_action='create_draft_pr';return result;}
    if(pr.headRefOid!==local.head_sha){result.next_action='refresh_pr_head';return result;}
    if(pr.state!=='OPEN'){result.next_action='refresh_remote';return result;}
    result.delivery=pr.isDraft?'draft_pr':'pr_open';result.next_action='request_merge_review';return result;
  }catch{return block('inspection_failed');}
}

export function verifySessionCommit({repoPath,packet:p,sessionId,runner=spawnSync}) {
  const block=(reason,extra={})=>({decision:'BLOCKED',reason,read_only:false,...extra});
  if(!validPacket(p)||!nonempty(sessionId))return block('invalid_packet');
  try {
  const c=context(repoPath,runner),before=inspectLocal(c,p);
  if(before.error)return block(before.error);
  if(before.local.dirty_paths.length)return block('dirty_checkout');
  if(p.handoff.state!=='released'||p.handoff.head_sha!==before.local.head_sha)return block('handoff_head_changed');
  const remote=readRemote(c,p);
  if(remote.status!=='observed')return block('remote_unavailable');
  const attempt={version:1,kind:'session_verification',task_ref:p.task_ref,repository:p.repository,branch:p.branch,commit_sha:before.local.head_sha,tree_sha:before.local.tree_sha,target_sha:remote.target_sha,session_id:sessionId,attempt_id:crypto.randomUUID(),verifier_fingerprint:hash(JSON.stringify(p.verifier)),producer_sha256:producerDigest()};
  const record=(status,output='',reason=null)=>{
    const time=new Date().toISOString();
    const proof={...attempt,status,recorded_at:time,...(status==='passed'?{verified_at:time}:{}),output_sha256:hash(output),...(reason?{reason}:{})};
    const note=c.git('notes',`--ref=${NOTES}`,'append','-m',JSON.stringify(proof),proof.commit_sha);
    return {proof,ok:note.status===0};
  };
  // Persist before execution so a crash/failed retry cannot reuse an older pass.
  if(!record('started').ok)return block('verification_note_failed');
  const fail=(reason,extra={})=>{
    const saved=record('failed','',reason);
    return block(reason,{...extra,...(!saved.ok?{evidence_reason:'verification_note_failed'}:{})});
  };
  const run=c.run(p.verifier.command,p.verifier.args,120000);
  const after=inspectLocal(c,p);
  if(after.error||after.local.head_sha!==before.local.head_sha||after.local.tree_sha!==before.local.tree_sha||after.local.dirty_paths.length)return fail('verifier_changed_source');
  if(run.status!==0)return fail('verifier_failed',{exit_code:run.status});
  const remoteAfter=readRemote(c,p);
  if(remoteAfter.status!=='observed'||JSON.stringify(remoteAfter)!==JSON.stringify(remote))return fail('remote_changed_during_verification');
  const saved=record('passed',run.stdout+run.stderr);
  if(!saved.ok)return block('verification_note_failed');
  return {decision:'READY',reason:'committed_source_verified',read_only:false,proof:saved.proof,note_ref:NOTES,operation_authority:'external_approval_required'};
  }catch{return block('verification_unavailable');}
}
