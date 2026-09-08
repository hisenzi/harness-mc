import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getResolvedRepo, getResolvedRepos, resolveWorkbookLocation, stableJson, digest, loadWorkbook, contractFingerprint, evaluateWorkbookGate, workbookSource, fileEvidence, resolveRepoPath, gitRead } from './workbook-anchor.mjs';
import { resolveMilestoneProject } from './milestone-projects.mjs';
import { validateTaskCandidate } from '../validate-tasks.mjs';
import { TASK_STATE_FIELDS, stateFromTask } from '../task-state.mjs';
import { writeSyncEvent } from '../sync-event-queue.mjs';

const ensure = (condition, reason) => { if (!condition) throw new Error(reason); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const uuidTask = /^work-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = ['schema_version','handoff_id','project','task_id','contract_fingerprint','result_version','outcome','expected','workbook_path','task_candidate','acceptance_receipt','evidence_refs','commit_receipts','reason','next_action','created_at'];
const fingerprint = value => value === null || value === undefined ? null : digest(value);
const read = file => JSON.parse(fs.readFileSync(file,'utf8'));

export function validateLocalTaskHandoff(h) {
  ensure(h && typeof h === 'object' && !Array.isArray(h),'handoff_object_required');
  ensure(Object.keys(h).every(k=>fields.includes(k)) && h.schema_version===1,'handoff_schema_invalid');
  ensure(['handoff_id','project','task_id','workbook_path','reason','next_action','created_at'].every(k=>text(h[k])),'handoff_identity_required');
  ensure(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(h.project) && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(h.task_id),'handoff_identity_invalid');
  ensure(hex(h.contract_fingerprint) && Number.isInteger(h.result_version) && h.result_version>0,'handoff_version_invalid');
  ensure(['completed','cancelled','deferred','blocked'].includes(h.outcome),'handoff_outcome_invalid');
  ensure(h.expected && ['definition_fingerprint','state_fingerprint'].every(k=>Object.hasOwn(h.expected,k)&&(h.expected[k]===null||hex(h.expected[k]))),'handoff_baseline_required');
  ensure((path.isAbsolute(h.workbook_path)||h.workbook_path.startsWith('$COLLAB/')) && Number.isFinite(Date.parse(h.created_at)),'handoff_source_invalid');
  resolveWorkbookLocation(h.workbook_path);
  ensure(h.task_candidate && h.task_candidate.id===h.task_id && h.task_candidate.status===h.outcome,'handoff_candidate_identity_mismatch');
  ensure(Array.isArray(h.evidence_refs)&&h.evidence_refs.length>0 && Array.isArray(h.commit_receipts),'handoff_evidence_required');
  if(h.outcome==='completed') ensure(h.acceptance_receipt,'handoff_acceptance_required');
  return h;
}

export function writeLocalTaskHandoff({outputPath,handoff,authorizationContext={}}) {
  validateLocalTaskHandoff(handoff);
  ensure(authorizationContext.allowedWorkbookPaths?.map(resolveWorkbookLocation).includes(resolveWorkbookLocation(handoff.workbook_path)),'workbook_path_not_authorized');
  const workbook=loadWorkbook(handoff.workbook_path);
  ensure(workbook.contract_fingerprint===handoff.contract_fingerprint,'handoff_contract_changed');
  const home=getResolvedRepo(workbook,workbook.contract.home.repo_id);
  ensure(path.isAbsolute(outputPath||''),'local_output_required');
  const relative=path.relative(home.canonical_root,outputPath);
  const target=resolveRepoPath(home.canonical_root,relative,{allowMissing:true});
  ensure(target!==workbook.home,'handoff_must_not_overwrite_workbook');
  ensure(home.control_paths?.includes(relative),'handoff_control_path_not_declared');
  const gate=evaluateWorkbookGate({contract:workbook.contract,event:'handoff',operation:{handoff_digest:digest(handoff),output_path:target}},authorizationContext);
  ensure(gate.decision==='allow',gate.reason);
  ensure(typeof authorizationContext.outputScopeResolver==='function','output_ownership_unverified');
  const request={output_path:target,work_id:`${handoff.project}/${handoff.task_id}`,contract_fingerprint:handoff.contract_fingerprint};
  const proof=authorizationContext.outputScopeResolver(request);
  ensure(proof?.owned===true&&Object.keys(request).every(k=>proof[k]===request[k]),'output_ownership_conflict');
  const serialized=stableJson(handoff)+'\n';
  fs.mkdirSync(path.dirname(target),{recursive:true});
  try { fs.writeFileSync(target,serialized,{flag:'wx'}); }
  catch(error) { if(error.code!=='EEXIST'||fs.readFileSync(target,'utf8')!==serialized) throw new Error('local_handoff_payload_conflict'); }
  return {path:target,digest:digest(handoff),handoff_id:handoff.handoff_id};
}

function pathsFor(root,h) {
  const resultKey=digest([h.project,h.task_id,h.contract_fingerprint,h.result_version,h.outcome]);
  return {key:resultKey,journal:resolveRepoPath(root,`task-events/transactions/local-handoff/${resultKey}.json`,{allowMissing:true}),receipt:resolveRepoPath(root,`task-events/applied/local-handoff/${resultKey}.json`,{allowMissing:true})};
}
function resultDigest(h) { const {handoff_id,created_at,...result}=h;return digest(result); }
function atomic(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.tmp-${crypto.randomUUID()}`;
  try { const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,stableJson(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,file); }
  finally { if(fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function loadProject(root,project) {
  const descriptor=resolveMilestoneProject({repoRoot:root,projectId:project});ensure(descriptor,'unknown_project');
  for(const file of [descriptor.tasksPath,descriptor.statePath,descriptor.projectPath]) resolveRepoPath(root,path.relative(root,file),{allowMissing:true});
  const sources=Object.fromEntries([descriptor.tasksPath,descriptor.statePath,descriptor.projectPath].map(file=>[file,fs.existsSync(file)?fs.readFileSync(file):null]));
  ensure(sources[descriptor.tasksPath],'canonical_tasks_missing');
  const definitions=JSON.parse(sources[descriptor.tasksPath]);ensure(Array.isArray(definitions.tasks),'local_handoff_requires_tasks_array');
  const state=sources[descriptor.statePath]?JSON.parse(sources[descriptor.statePath]):{tasks:{}};
  ensure(state.tasks && typeof state.tasks==='object'&&!Array.isArray(state.tasks),'invalid_project_state');
  const meta=sources[descriptor.projectPath]?JSON.parse(sources[descriptor.projectPath]):{};
  const source_fingerprints=Object.fromEntries(Object.entries(sources).map(([file,bytes])=>[file,bytes===null?null:digest(bytes)]));
  return {descriptor,definitions,state,meta,source_fingerprints};
}
function targetOf(project,id) {
  const matches=project.definitions.tasks.filter(t=>t.id===id);ensure(matches.length<=1,'duplicate_task_id');
  return {definition:matches[0]||null,state:project.state.tasks[id]||null};
}
function canonicalTarget(target) {
  // 新入口以定義擁有任務契約；既有投影若有不同 status，必須先明確裁決。
  if(target.definition && target.state?.status && target.state.status!==target.definition.status) throw new Error('canonical_state_authority_conflict');
  return target.definition;
}
function approved(workbook,h,context,canonical,root) {
  const dependencies=[...(canonical?.depends_on||[]),...(canonical?.dependencies||[])];
  const ready=dependencies.every(dep=>{
    const ref=typeof dep==='string'?dep:dep?.task_ref||dep?.ref;
    if(!text(ref))return false;
    const parts=ref.split('/'),projectId=parts.length===1?h.project:parts[0],taskId=parts.at(-1);
    try { const task=canonicalTarget(targetOf(loadProject(root,projectId),taskId));return ['completed','done','fixed'].includes(task?.status); }
    catch { return false; }
  });
  const gate=evaluateWorkbookGate({contract:workbook.contract,event:'integrate',operation:{outcome:h.outcome,result_digest:resultDigest(h),task_candidate_digest:digest(h.task_candidate),expected:h.expected}},{...context,canonicalResolver:ref=>{
    if(ref!==`${h.project}/${h.task_id}`) return null;
    if(!canonical)return {task_ref:ref,exists:false};
    return {task_ref:ref,digest:digest(canonical),status:canonical.status,replaced_by:canonical.replaced_by,
      start_allowed:ready&&!canonical.replaced_by&&['todo','in_progress'].includes(canonical.status),acceptance:canonical.acceptance_matrix};
  }});
  ensure(gate.decision==='allow',gate.reason);
}
function owned(project,context) {
  ensure(typeof context.ownershipResolver==='function','central_ownership_unverified');
  const paths=[project.descriptor.tasksPath,project.descriptor.statePath];
  ensure(Object.entries(project.source_fingerprints).every(([file,sha])=>(fs.existsSync(file)?digest(fs.readFileSync(file)):null)===sha),'central_snapshot_changed');
  const file_fingerprints=Object.fromEntries(paths.map(file=>[file,project.source_fingerprints[file]]));
  const proof=context.ownershipResolver({paths,file_fingerprints});
  ensure(proof?.decision==='allow'&&stableJson(proof.paths)===stableJson(paths)&&stableJson(proof.file_fingerprints)===stableJson(file_fingerprints),'central_ownership_conflict');
  // resolver 回傳期間也不能換成另一份檔案。
  ensure(paths.every(file=>(fs.existsSync(file)?digest(fs.readFileSync(file)):null)===file_fingerprints[file]),'central_ownership_source_changed');
}
function treeEvidence(repo,sha,relative) {
  resolveRepoPath(repo.checkout_root,relative,{allowMissing:true});
  const entry=gitRead(repo.checkout_root,['ls-tree','-z',sha,'--',relative]);
  if(!entry)return null;
  const match=/^(100644|100755) blob ([0-9a-f]{40,64})\t([^\0]+)\0$/.exec(entry);
  ensure(match&&match[3]===relative,'commit_evidence_must_be_regular_file');
  const blob=spawnSync('git',['--no-optional-locks','cat-file','blob',match[2]],{cwd:repo.checkout_root,maxBuffer:16*1024*1024});
  ensure(blob.status===0,'commit_blob_unavailable');return {sha256:digest(blob.stdout),mode:match[1]==='100755'?0o111:0};
}
function sourcePaths(c,repo) {
  const acceptance=c.acceptance.filter(a=>a.repo_id===repo.repo_id),inputs=new Set(acceptance.flatMap(a=>a.source_paths));
  if(c.requirement_baseline?.repo_id===repo.repo_id)inputs.add(c.requirement_baseline.path);
  const outputs=new Set(acceptance.flatMap(a=>a.artifact_paths).filter(p=>!inputs.has(p)));
  return [...new Set([...repo.write_paths.filter(p=>!outputs.has(p)),...inputs])].sort();
}
function evidence(workbook,h,context) {
  const c=workbook.contract,commits=new Map();
  for(const receipt of h.commit_receipts) {
    const repo=getResolvedRepos(workbook).find(r=>r.repo_id===receipt.repo_id);ensure(repo&&/^[0-9a-f]{40,64}$/.test(receipt.c1_sha||''),'commit_receipt_invalid');
    gitRead(repo.checkout_root,['cat-file','-e',`${receipt.c1_sha}^{commit}`]);
    const changed=gitRead(repo.checkout_root,['diff-tree','--no-commit-id','--name-only','--no-renames','-z','-r',receipt.c1_sha]).split('\0').filter(Boolean);
    ensure(changed.length>0&&changed.every(p=>[...repo.write_paths,...(repo.control_paths||[])].includes(p)),'commit_scope_mismatch');
    if(commits.has(repo.repo_id))gitRead(repo.checkout_root,['merge-base','--is-ancestor',commits.get(repo.repo_id),receipt.c1_sha]);
    commits.set(repo.repo_id,receipt.c1_sha);
  }
  for(const ref of h.evidence_refs) {
    const repo=getResolvedRepos(workbook).find(r=>r.repo_id===ref.repo_id);ensure(repo&&hex(ref.digest),'evidence_ref_invalid');
    const declared=new Set([...sourcePaths(c,repo),...c.acceptance.filter(a=>a.repo_id===repo.repo_id).flatMap(a=>a.artifact_paths)]);
    ensure(declared.has(ref.path),'evidence_path_not_declared');
    const sha=commits.get(repo.repo_id),value=sha&&sourcePaths(c,repo).includes(ref.path)?treeEvidence(repo,sha,ref.path):fileEvidence(repo.checkout_root,[ref.path])[ref.path];
    ensure(value?.sha256===ref.digest,'evidence_changed');
  }
  if(h.outcome!=='completed')return;
  ensure(!c.acceptance.some(a=>a.pending_reason),'requirements_not_ready');
  const receipt=h.acceptance_receipt;
  ensure(receipt?.version===1&&receipt.work_id===`${h.project}/${h.task_id}`&&receipt.contract_fingerprint===h.contract_fingerprint,'receipt_contract_mismatch');
  ensure(Number.isFinite(Date.parse(receipt.verified_at)),'receipt_time_invalid');
  ensure(stableJson(Object.keys(receipt.source||{}).sort())===stableJson(c.repos.map(r=>r.repo_id).sort()),'receipt_source_repos_mismatch');
  let current;
  for(const repo of getResolvedRepos(workbook)) {
    const source=receipt.source[repo.repo_id],paths=sourcePaths(c,repo),sha=commits.get(repo.repo_id);
    ensure(stableJson(Object.keys(source?.files||{}).sort())===stableJson(paths),'receipt_source_paths_mismatch');
    if(sha) {
      ensure(/^[0-9a-f]{40,64}$/.test(source.head||''),'receipt_source_head_invalid');
      gitRead(repo.checkout_root,['merge-base','--is-ancestor',source.head,sha]);
      for(const relative of paths)ensure(stableJson(treeEvidence(repo,sha,relative))===stableJson(source.files[relative]),'commit_source_mismatch');
    } else {
      current ||= workbookSource(workbook);
      ensure(stableJson(source)===stableJson(current[repo.repo_id]),'receipt_source_changed');
    }
  }
  ensure(stableJson(receipt.results?.map(r=>r.id).sort())===stableJson(c.acceptance.map(a=>a.id).sort()),'receipt_ids_mismatch');
  for(const a of c.acceptance) {
    const result=receipt.results.find(r=>r.id===a.id),repo=getResolvedRepo(workbook,a.repo_id),sha=commits.get(repo.repo_id);
    ensure(result.status==='passed'&&result.verifier_fingerprint===digest(a)&&hex(result.output_sha256),'receipt_verifier_invalid');
    ensure(result.executable?.path===fs.realpathSync(a.command)&&result.executable.sha256===a.executable_sha256,'verifier_executable_changed');
    const expected=Object.fromEntries(a.artifact_paths.map(relative=>[relative,sha&&sourcePaths(c,repo).includes(relative)?treeEvidence(repo,sha,relative):fileEvidence(repo.checkout_root,[relative])[relative]]));
    ensure(stableJson(result.artifacts)===stableJson(expected),'artifact_changed');
  }
  ensure(typeof context.evidenceResolver==='function','trusted_acceptance_source_unavailable');
  // 雜湊只證明內容一致，實際 producer/run 仍由可信程式來源核驗。
  const request={work_id:`${h.project}/${h.task_id}`,contract_fingerprint:h.contract_fingerprint,receipt_digest:digest(receipt),result_digest:resultDigest(h),handoff_digest:digest(h),task_candidate_digest:digest(h.task_candidate),handoff:h,workbook};
  const proof=context.evidenceResolver(request);
  ensure(proof?.verified===true&&['receipt_digest','contract_fingerprint','result_digest','task_candidate_digest'].every(k=>proof[k]===request[k])&&text(proof.source_ref),'acceptance_producer_unverified');
  if(c.allowed_actions.includes('commit'))ensure(h.commit_receipts.length>0,'required_commit_receipt_missing');
}
function allocateLabel(project,candidate,context) {
  const metadata=project.meta;
  const projectInit=['why_opened','mvp_goal','final_goal'].every(k=>text(metadata[k]));
  let policy=context.labelPolicyResolver?.({project:project.descriptor.projectId,metadata,task:candidate});
  if(!policy&&text(metadata.project_code))policy={prefix:`${metadata.project_code}${projectInit&&candidate.track!=='formal'?'-MVP':''}`,width:2};
  ensure(policy&&/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(policy.prefix)&&Number.isInteger(policy.width)&&policy.width>0&&policy.width<=8,'label_policy_unavailable');
  const escaped=policy.prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const pattern=new RegExp(`^${escaped}-(\\d+)$`);
  const numbers=project.definitions.tasks.map(t=>pattern.exec(t.order_label||'')).filter(Boolean).map(m=>Number(m[1]));
  const next=Math.max(0,...numbers)+1;ensure(Number.isSafeInteger(next),'label_sequence_exhausted');
  return `${policy.prefix}-${String(next).padStart(policy.width,'0')}`;
}
function prepare(root,h,context,existingJournal=null) {
  ensure(context.allowedWorkbookPaths?.map(resolveWorkbookLocation).includes(resolveWorkbookLocation(h.workbook_path)),'workbook_path_not_authorized');
  const workbook=loadWorkbook(h.workbook_path),c=workbook.contract;
  ensure(c.project_id===h.project&&c.task_id===h.task_id&&c.formal_target===h.project&&contractFingerprint(c)===h.contract_fingerprint,'handoff_contract_mismatch');
  const project=loadProject(root,h.project),liveTarget=targetOf(project,h.task_id);
  const target=existingJournal?existingJournal.before:liveTarget,canonical=canonicalTarget(target);
  owned(project,context);
  // 恢復時以原 before 核對授權，現在的逐欄狀態另作 CAS。
  approved(workbook,h,context,canonical,root);evidence(workbook,h,context);
  ensure(fingerprint(target.definition)===h.expected.definition_fingerprint&&fingerprint(target.state)===h.expected.state_fingerprint,'task_baseline_conflict');
  if(canonical) {
    ensure(c.canonical_baseline&&c.canonical_baseline.task_digest===digest(canonical),'existing_task_requires_canonical_baseline');
    ensure(!['cancelled','archived','superseded'].includes(canonical.status),'terminal_task_changed');
    ensure(!canonical.coordination?.active_claim,'active_remote_claim_requires_handoff');
  } else { ensure(c.canonical_baseline===null&&uuidTask.test(h.task_id),'new_task_requires_uuid'); }
  const candidate=structuredClone(h.task_candidate);
  if(h.outcome==='completed'&&!candidate.completed_at)candidate.completed_at=h.created_at;
  const verifiedCommits=new Set([...(canonical?.commits||[]),...h.commit_receipts.map(r=>r.c1_sha)]);
  ensure((candidate.commits||[]).every(sha=>verifiedCommits.has(sha)),'unverified_candidate_commit');
  if(h.commit_receipts.length)candidate.commits=[...verifiedCommits];
  ensure(candidate.title===c.title&&candidate.done_condition===c.done_condition,'candidate_contract_changed');
  const candidateIds=(candidate.acceptance_matrix||[]).map(a=>a.id).sort();
  ensure(stableJson(candidateIds)===stableJson(c.acceptance.map(a=>a.id).sort()),'candidate_acceptance_mismatch');
  if(canonical) {
    ensure(candidate.title===canonical.title&&candidate.order_label===canonical.order_label,'existing_identity_changed');
    for(const row of canonical.acceptance_matrix||[])ensure(candidate.acceptance_matrix.some(a=>stableJson(a)===stableJson(row)),'canonical_acceptance_changed');
    for(const [field,value] of Object.entries(canonical)) {
      if(['status','completed_at','commits','summary','task_lifecycle','completion_evidence','jv32_route','goal_alignment','test_contract','acceptance_matrix','revision','previous_revision','architecture_decision','weekly_core','review_date'].includes(field))continue;
      ensure(stableJson(candidate[field])===stableJson(value),`unauthorized_field_change:${field}`);
    }
  } else {
    ensure(candidate.order_label===null,'new_label_must_be_unassigned');
    ensure(typeof context.semanticResolver==='function','semantic_intake_unverified');
    const decision=context.semanticResolver({handoff:h,workbook,canonical_tasks:structuredClone(project.definitions.tasks.filter(t=>t.id!==h.task_id))});
    ensure(decision?.decision==='distinct'&&text(decision.evidence_ref),'semantic_identity_conflict');
    candidate.order_label=existingJournal?existingJournal.after?.definition?.order_label:allocateLabel(project,candidate,context);
  }
  const goalAnchor=project.meta.goals?{ref:`$COLLAB/harness-mc/${project.descriptor.relativeDir}/project.json#/goals`,fingerprint:`sha256:${crypto.createHash('sha256').update(JSON.stringify(project.meta.goals)).digest('hex')}`}:null;
  const refs=new Map(project.definitions.tasks.map(t=>[`${h.project}/${t.id}`,t]));
  const diagnostics=validateTaskCandidate({task:candidate,previousTask:canonical,project:h.project,projectMeta:project.meta,projectGoalAnchor:goalAnchor,canonicalTaskRefs:refs,peerTasks:project.definitions.tasks.filter(t=>t.id!==h.task_id)});
  ensure(diagnostics.length===0,`candidate_invalid:${diagnostics.join('; ')}`);
  const projected={...(target.state||{}),...stateFromTask(candidate)};
  for(const key of Object.keys(candidate))if(!TASK_STATE_FIELDS.includes(key))delete projected[key];
  if(!Object.hasOwn(candidate,'completed_at'))delete projected.completed_at;
  if(existingJournal)ensure(stableJson(existingJournal.after)===stableJson({definition:candidate,state:projected}),'journal_candidate_changed');
  return {project,workbook,target:liveTarget,candidate,projected};
}
function receiptFor(h,candidate,projected) {
  return {version:1,work_id:`${h.project}/${h.task_id}`,contract_fingerprint:h.contract_fingerprint,canonical_ref:`${h.project}/${h.task_id}`,order_label:candidate.order_label,definition_fingerprint:digest(candidate),state_fingerprint:digest(projected),outcome:h.outcome,canonical_applied:true};
}
function syncIntents(h,key,candidate) {
  return [{sync_event_id:`local-handoff-${key}-canvas`,type:'sync_requested',target:'obsidian_canvas',source_event_id:`local-handoff-${key}`,project:h.project,task_id:h.task_id,reason:'task_state_changed',actor:'local-handoff-integrator',session_id:h.handoff_id,created_at:h.created_at,payload:{whiteboard:candidate.external_refs?.heptabase?.whiteboard||'MC 儀表版'}}];
}
function releaseSync(root,intent,released) {
  const immutable=['sync_event_id','target','source_event_id','project','task_id','reason','payload','created_at','actor','session_id'];
  const found=[];
  for(const queue of ['pending','synced','failed']) {
    const dir=resolveRepoPath(root,`sync-events/${queue}`,{allowMissing:true});if(!fs.existsSync(dir))continue;
    for(const name of fs.readdirSync(dir).filter(name=>name.endsWith('.json'))) {
      const event=read(resolveRepoPath(root,`sync-events/${queue}/${name}`));
      if(event.sync_event_id!==intent.sync_event_id)continue;
      ensure(immutable.every(k=>stableJson(event[k])===stableJson(intent[k])),'sync_intent_payload_conflict');found.push(event);
    }
  }
  ensure(found.length<=1,'sync_intent_duplicate_state');
  if(found.length)return;
  ensure(!released,'sync_release_evidence_missing');
  writeSyncEvent({...intent,root});
}
function validateJournal(journal,h,root) {
  ensure(journal?.root===root,'journal_root_changed');
  ensure(journal?.schema_version===1&&journal.result_digest===resultDigest(h)&&journal.result_key===pathsFor(journal.root,h).key,'journal_payload_mismatch');
  ensure(Number.isFinite(Date.parse(journal.created_at))&&journal.handoff_digest===digest({...h,handoff_id:journal.handoff_id,created_at:journal.created_at}),'journal_original_handoff_changed');
  ensure(journal.project===h.project&&journal.task_id===h.task_id&&journal.after?.definition?.id===h.task_id,'journal_identity_mismatch');
  ensure(journal.after_digest===digest(journal.after)&&journal.before_digest===digest(journal.before),'journal_corrupt');
}
function resume(root,h,journal,files,options) {
  validateJournal(journal,h,root);
  const original={...h,handoff_id:journal.handoff_id,created_at:journal.created_at};
  const prepared=prepare(root,original,options.authorizationContext||{},journal);
  const {project,target,candidate,projected}=prepared;
  ensure(stableJson(journal.receipt)===stableJson(receiptFor(h,candidate,projected)),'journal_receipt_changed');
  ensure(stableJson(journal.sync_intents)===stableJson(syncIntents(original,files.key,candidate)),'journal_sync_intents_changed');
  for(const field of ['definition','state'])ensure([fingerprint(journal.before[field]),fingerprint(journal.after[field])].includes(fingerprint(target[field])),'recovery_target_conflict');
  if(options.mode==='preview')return {handoff_id:h.handoff_id,status:'preview_ready',recoverable:true,receipt:journal.receipt};
  owned(project,options.authorizationContext||{});
  if(fingerprint(target.definition)!==fingerprint(journal.after.definition)) {
    const tasks=project.definitions.tasks;const index=tasks.findIndex(t=>t.id===h.task_id);
    if(index<0)tasks.push(journal.after.definition);else tasks[index]=journal.after.definition;
    atomic(project.descriptor.tasksPath,project.definitions);
  }
  options.afterLocalHandoffPhase?.('definition_written');
  // 寫 state 前再讀一次，保留其他工作剛產生的資料。
  const latest=loadProject(root,h.project),latestTarget=targetOf(latest,h.task_id);
  ensure(fingerprint(latestTarget.definition)===fingerprint(journal.after.definition),'recovery_target_conflict');
  ensure([fingerprint(journal.before.state),fingerprint(journal.after.state)].includes(fingerprint(latestTarget.state)),'recovery_state_conflict');
  owned(latest,options.authorizationContext||{});
  if(fingerprint(latestTarget.state)!==fingerprint(journal.after.state)) {
    latest.state.tasks[h.task_id]=journal.after.state;atomic(latest.descriptor.statePath,latest.state);
  }
  options.afterLocalHandoffPhase?.('state_written');
  if(journal.phase==='prepared'){journal.phase='canonical_applied';atomic(files.journal,journal);}
  // 跨 pending/synced/failed 查同 ID，填補發送成功但 checkpoint 尚未落盤的窗口。
  journal.sync_released ||= [];
  for(const intent of journal.sync_intents) {
    releaseSync(root,intent,journal.sync_released.includes(intent.sync_event_id));
    if(!journal.sync_released.includes(intent.sync_event_id)){journal.sync_released.push(intent.sync_event_id);atomic(files.journal,journal);}
  }
  journal.phase='projection_pending';atomic(files.journal,journal);
  options.afterLocalHandoffPhase?.('sync_released');
  if(options.runGenerateData!==false) {
    let generated;
    try { generated=options.projectionRunner?options.projectionRunner({root,project:h.project,task_id:h.task_id}):spawnSync(process.execPath,[path.join(root,'scripts/generate-data.mjs')],{cwd:root,encoding:'utf8'}); }
    catch { generated={status:1}; }
    if(generated?.status!==0)return {handoff_id:h.handoff_id,status:'projection_pending',receipt:journal.receipt};
  }
  options.afterLocalHandoffPhase?.('projection_verified');
  const receipt={...journal.receipt,projection:options.runGenerateData===false?'not_requested':'verified'};
  atomic(files.receipt,{schema_version:1,result_key:files.key,result_digest:resultDigest(h),handoff_id:journal.handoff_id,handoff_digest:journal.handoff_digest,receipt,after:journal.after});
  fs.unlinkSync(files.journal);
  return {handoff_id:h.handoff_id,status:'canonical_applied',receipt};
}
function aliasPath(root,h) {return resolveRepoPath(root,`task-events/applied/local-handoff/aliases/${digest(h.handoff_id)}.json`,{allowMissing:true});}
function retainAlias(root,h) {
  const file=aliasPath(root,h),value={handoff_id:h.handoff_id,handoff_digest:digest(h)};
  if(fs.existsSync(file))ensure(stableJson(read(file))===stableJson(value),'handoff_id_payload_conflict');else atomic(file,value);
}
function priorById(root,h) {
  const alias=aliasPath(root,h);if(fs.existsSync(alias))ensure(read(alias).handoff_digest===digest(h),'handoff_id_payload_conflict');
  for(const relative of ['task-events/transactions/local-handoff','task-events/applied/local-handoff']) {
    const directory=resolveRepoPath(root,relative,{allowMissing:true});if(!fs.existsSync(directory))continue;
    for(const name of fs.readdirSync(directory).filter(n=>/^[0-9a-f]{64}\.json$/.test(n))) {
      const record=read(resolveRepoPath(root,`${relative}/${name}`));
      if(record.handoff_id===h.handoff_id)ensure(record.handoff_digest===digest(h),'handoff_id_payload_conflict');
      if(relative.startsWith('task-events/transactions/')&&record.project===h.project&&record.task_id===h.task_id&&record.result_key!==pathsFor(root,h).key) {
        const completedPath=resolveRepoPath(root,`task-events/applied/local-handoff/${name}`,{allowMissing:true});
        const completed=fs.existsSync(completedPath)?read(completedPath):null;
        ensure(completed&&completed.result_digest===record.result_digest&&stableJson(completed.after)===stableJson(record.after),'work_transaction_pending');
      }
    }
  }
}
export function processLocalTaskHandoffs(options={}) {
  const root=fs.realpathSync(options.root||process.cwd());
  ensure(Array.isArray(options.localHandoffs)&&options.localHandoffs.length>0,'local_handoffs_required');
  const results=[];
  for(const h of options.localHandoffs) {
    let files,journal;
    try {
      validateLocalTaskHandoff(h);files=pathsFor(root,h);priorById(root,h);
      if(fs.existsSync(files.receipt)) {
        const stored=read(files.receipt);ensure(stored.result_digest===resultDigest(h),'result_payload_conflict');
        if(options.mode==='apply') {
          retainAlias(root,h);
          if(fs.existsSync(files.journal)) {
            const finished=read(files.journal);validateJournal(finished,h,root);
            const {projection,...receipt}=stored.receipt;
            ensure(stableJson(finished.after)===stableJson(stored.after)&&stableJson(finished.receipt)===stableJson(receipt),'final_receipt_journal_conflict');
            fs.unlinkSync(files.journal);
          }
        }
        results.push({handoff_id:h.handoff_id,status:'canonical_applied',replayed:true,receipt:stored.receipt});continue;
      }
      if(fs.existsSync(files.journal)) { journal=read(files.journal);validateJournal(journal,h,root); }
      else {
        const prepared=prepare(root,h,options.authorizationContext||{});
        const receipt=receiptFor(h,prepared.candidate,prepared.projected);
        if(options.mode==='preview') {results.push({handoff_id:h.handoff_id,status:'preview_ready',candidate:prepared.candidate,receipt:{...receipt,canonical_applied:false}});continue;}
        const sync_intents=syncIntents(h,files.key,prepared.candidate);
        journal={schema_version:1,created_at:h.created_at,root,project:h.project,task_id:h.task_id,handoff_id:h.handoff_id,handoff_digest:digest(h),result_key:files.key,result_digest:resultDigest(h),phase:'prepared',before:prepared.target,after:{definition:prepared.candidate,state:prepared.projected},receipt,sync_intents};
        journal.before_digest=digest(journal.before);journal.after_digest=digest(journal.after);atomic(files.journal,journal);
      }
    } catch(error) { results.push({handoff_id:h?.handoff_id||null,status:'blocked',reason:error.message});continue; }
    // 故障注入及真正 I/O 失敗保留 journal；不假裝已回寫完成。
    try { if(options.mode==='apply')retainAlias(root,h);results.push(resume(root,h,journal,files,options)); }
    catch(error) {
      if(error.message==='simulated_crash')throw error;
      results.push({handoff_id:h.handoff_id,status:'blocked',reason:error.message});
    }
  }
  return {mode:options.mode,results};
}
