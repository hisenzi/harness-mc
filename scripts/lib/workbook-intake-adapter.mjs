import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,stableJson,workId,loadWorkbook,resolveRepoPath,resolveWorkbookLocation,gitRead,getResolvedRepo,getResolvedRepos,workbookSource,fileEvidence,runWorkbookAcceptance,evaluateWorkbookGate,workbookRuntimeEvidence} from './workbook-anchor.mjs';
import {getWorkbookSessionResolvers} from './workbook-session-context.mjs';
import {getWorkbookRuntimeContext,runWorkbookPreflight,inspectWorkbookRegisteredRepos} from './workbook-preflight-adapter.mjs';
import {inspectWorkbookClaims,inspectWorkbookRepo} from './workbook-coordination.mjs';
import {resolveMilestoneProject} from './milestone-projects.mjs';
import {validateLocalTaskHandoff} from './local-task-handoff.mjs';
import {validateTaskCandidate} from '../validate-tasks.mjs';
import {TASK_STATE_FIELDS,stateFromTask} from '../task-state.mjs';
import {runPreflight as runCanonicalPreflight} from '../work-anchor-preflight.mjs';

// 人監督的固定接線，不是 JSON 簽章服務。副作用仍只走原 producer／apply 入口。
// producer 只能由本模組實跑取得；程序結束後要重新驗收，不能還原 JSON token。
const producers=new WeakMap();
const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const check=(ok,reason)=>{if(!ok)throw Error(reason);};
const text=v=>typeof v==='string'&&v.trim().length>0;
const same=(a,b)=>stableJson(a)===stableJson(b);
const overlap=(a,b)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
const nullableDigest=v=>v===null||v===undefined?null:digest(v);
function runtimeBoundary(h,original,run){
  if(h.outcome!=='completed')return;
  const required=h.task_candidate?.test_contract?.runtime_evidence_required===true||original?.test_contract?.runtime_evidence_required===true;
  if(!required&&!run?.workbook.contract.acceptance.some(a=>a.runtime_observation))return;
  check(run,'untrusted_acceptance_producer');
  check(run.workbook.contract_fingerprint===h.contract_fingerprint&&workId(run.workbook.contract)===`${h.project}/${h.task_id}`&&same(run.receipt,h.acceptance_receipt),'producer_receipt_mismatch');
  const refs=workbookRuntimeEvidence(run.workbook,run.executed);
  if(required)check(Array.isArray(h.task_candidate?.completion_evidence?.runtime_evidence)&&same([...h.task_candidate.completion_evidence.runtime_evidence].sort(),[...refs].sort()),'runtime_evidence_unverified');
  if(original?.test_contract?.runtime_evidence_required===true)check(h.task_candidate?.test_contract?.runtime_evidence_required===true,'runtime_requirement_downgraded');
}
function directoryIdentity(file){const real=fs.realpathSync(file),s=fs.statSync(real);check(s.isDirectory(),'intake_directory_required');return {path:real,dev:s.dev,ino:s.ino};}
function resultDigest(h){const {handoff_id,created_at,...result}=h;return digest(result);}
function operation(h){return {outcome:h.outcome,result_digest:resultDigest(h),task_candidate_digest:digest(h.task_candidate),expected:h.expected};}
function live(workbook){const current=loadWorkbook(workbook.home);check(current.contract_fingerprint===workbook.contract_fingerprint,'intake_contract_changed');return current;}
function bytes(root,file,optional=false){
  const safe=resolveRepoPath(root,path.relative(root,file),{allowMissing:optional});
  if(optional&&!fs.existsSync(safe))return null;
  const before=fs.statSync(safe),value=fs.readFileSync(safe),after=fs.statSync(resolveRepoPath(root,path.relative(root,file)));
  check(before.isFile()&&before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'intake_source_changed_while_reading');return value;
}
function central(root,workbook){
  check(fs.realpathSync(gitRead(root,['rev-parse','--show-toplevel']))===root,'central_repo_root_mismatch');
  const repo_identity={root:directoryIdentity(root),common_git_dir:directoryIdentity(path.resolve(root,gitRead(root,['rev-parse','--git-common-dir'])))};
  const descriptor=resolveMilestoneProject({repoRoot:root,projectId:workbook.contract.project_id});check(descriptor,'intake_unknown_project');
  const paths=[descriptor.tasksPath,descriptor.statePath],all=[descriptor.projectPath,...paths];
  const source=Object.fromEntries(all.map(file=>[file,bytes(root,file,file===descriptor.statePath)]));
  const definitions=JSON.parse(source[descriptor.tasksPath]),state=source[descriptor.statePath]?JSON.parse(source[descriptor.statePath]):{tasks:{}};
  check(Array.isArray(definitions.tasks)&&definitions.tasks.every(t=>text(t.id))&&new Set(definitions.tasks.map(t=>t.id)).size===definitions.tasks.length,'intake_canonical_tasks_invalid');
  check(state.tasks&&typeof state.tasks==='object'&&!Array.isArray(state.tasks),'intake_canonical_state_invalid');
  const target={definition:definitions.tasks.find(t=>t.id===workbook.contract.task_id)||null,state:state.tasks[workbook.contract.task_id]||null};
  const file_fingerprints=Object.fromEntries(all.map(file=>[file,source[file]===null?null:digest(source[file])]));
  const dirty=[...new Set([gitRead(root,['diff','--name-only','--no-renames','-z']),gitRead(root,['diff','--cached','--name-only','--no-renames','-z']),gitRead(root,['ls-files','--others','--exclude-standard','-z'])].flatMap(s=>s.split('\0').filter(Boolean)))];
  const relative=paths.map(p=>path.relative(root,p));
  const dirty_paths=dirty.filter(p=>relative.some(s=>overlap(p,s))).sort();
  const relevant=claim=>!Array.isArray(claim.scope_paths)||[...claim.scope_paths,...(claim.control_paths||[])].some(p=>relative.some(s=>overlap(p,s)));
  const claims=inspectWorkbookClaims({repoPath:root}).filter(relevant);
  const legacy_claims=[...definitions.tasks,...Object.values(state.tasks)].flatMap(t=>t?.coordination?.active_claim?[t.coordination.active_claim]:[]).filter(relevant);
  return {descriptor,paths,repo_identity,file_fingerprints,target,definitions,state,canonical_tasks:definitions.tasks,dirty_paths,claims,legacy_claims};
}
function ownerCheck(observation,workbook,sessionId){
  const scope=observation.relative_paths;
  for(const claim of [...observation.claims,...observation.legacy_claims]){
    if(['released','completed'].includes(claim.state))continue;
    check(claim.version!==null&&Array.isArray(claim.scope_paths),'central_owner_unknown');
    const paths=[...claim.scope_paths,...(claim.control_paths||[])];
    if(!paths.some(p=>scope.some(s=>overlap(p,s))))continue;
    check(claim.work_id===workId(workbook.contract)&&claim.home===workbook.home&&claim.contract_fingerprint===workbook.contract_fingerprint&&claim.session_id===sessionId,'central_owner_conflict');
  }
}
function snapshot(root,workbook,sessionId){
  const observed=central(root,workbook);observed.relative_paths=observed.paths.map(p=>path.relative(root,p));ownerCheck(observed,workbook,sessionId);
  const data={work_id:workId(workbook.contract),contract_fingerprint:workbook.contract_fingerprint,repo_identity:observed.repo_identity,paths:observed.paths,file_fingerprints:observed.file_fingerprints,expected:{definition_fingerprint:nullableDigest(observed.target.definition),state_fingerprint:nullableDigest(observed.target.state)},canonical_tasks_fingerprint:digest(observed.canonical_tasks),canonical_task_ids:observed.canonical_tasks.map(t=>t.id).sort(),dirty_paths:observed.dirty_paths,claims_fingerprint:digest([observed.claims,observed.legacy_claims])};
  return {data:{...data,fingerprint:digest(data)},observed};
}
export function inspectWorkbookIntake({workbook,sessionContext,handoff},{harnessRoot=defaultRoot}={}){
  workbook=live(workbook);const root=fs.realpathSync(harnessRoot),session=getWorkbookSessionResolvers(sessionContext,workbook);
  inspectWorkbookRegisteredRepos(workbook,{harnessRoot:root});
  if(handoff&&hasJournal(root,handoff))recovery(root,workbook,handoff);
  else {const runtime=getWorkbookRuntimeContext(sessionContext,workbook,{harnessRoot:root});runtime.canonicalResolver(workId(workbook.contract));if(handoff)check(same(snapshot(root,workbook,session.session_id).data.expected,handoff.expected),'intake_task_baseline_changed');}
  return snapshot(root,workbook,session.session_id).data;
}
function checkOperation(session,workbook,handoff){
  const op=operation(handoff),fp=digest(op),proof=session.approvalResolver({work_id:workId(workbook.contract),contract_fingerprint:workbook.contract_fingerprint,action:'integrate',operation:op,operation_fingerprint:fp});
  check(proof?.operation_fingerprint===fp,'intake_operation_not_verified');
}
function journalPath(root,h){return resolveRepoPath(root,`task-events/transactions/local-handoff/${digest([h.project,h.task_id,h.contract_fingerprint,h.result_version,h.outcome])}.json`,{allowMissing:true});}
function hasJournal(root,h){return fs.existsSync(journalPath(root,h));}
function recovery(root,workbook,h){
  validateLocalTaskHandoff(h);check(resolveWorkbookLocation(h.workbook_path)===workbook.home&&h.contract_fingerprint===workbook.contract_fingerprint&&`${h.project}/${h.task_id}`===workId(workbook.contract),'recovery_workbook_mismatch');
  const file=journalPath(root,h),j=JSON.parse(bytes(root,file));
  check(j.schema_version===1&&j.root===root&&j.result_digest===resultDigest(h)&&j.result_key===digest([h.project,h.task_id,h.contract_fingerprint,h.result_version,h.outcome]),'recovery_journal_identity_changed');
  check(j.handoff_id===h.handoff_id&&j.created_at===h.created_at&&j.handoff_digest===digest(h)&&j.project===h.project&&j.task_id===h.task_id,'recovery_handoff_changed');
  check(j.before_digest===digest(j.before)&&j.after_digest===digest(j.after),'recovery_journal_digest_changed');
  check(same(h.expected,{definition_fingerprint:nullableDigest(j.before?.definition),state_fingerprint:nullableDigest(j.before?.state)}),'recovery_before_changed');
  const original=j.before.definition,c=workbook.contract;
  check(original?c.canonical_baseline?.task_digest===digest(original)&&same(c.canonical_baseline.acceptance,original.acceptance_matrix):c.canonical_baseline===null,'recovery_canonical_baseline_changed');
  if(original)check(['todo','in_progress'].includes(original.status)&&!original.replaced_by&&!original.coordination?.active_claim,'recovery_original_task_not_startable');
  const candidate=structuredClone(h.task_candidate);
  if(h.outcome==='completed'&&!candidate.completed_at)candidate.completed_at=h.created_at;
  if(h.commit_receipts.length)candidate.commits=[...new Set([...(original?.commits||[]),...h.commit_receipts.map(r=>r.c1_sha)])];
  if(!original){check(candidate.order_label===null&&text(j.after?.definition?.order_label),'recovery_label_invalid');candidate.order_label=j.after.definition.order_label;}
  check(same(j.after.definition,candidate),'recovery_candidate_changed');
  const current=central(root,workbook);
  const projected={...(j.before.state||{}),...stateFromTask(candidate)};for(const key of Object.keys(candidate))if(!TASK_STATE_FIELDS.includes(key))delete projected[key];if(!Object.hasOwn(candidate,'completed_at'))delete projected.completed_at;
  check(same(j.after.state,projected),'recovery_state_projection_changed');
  const metadata=JSON.parse(bytes(root,current.descriptor.projectPath)),peers=current.canonical_tasks.filter(t=>t.id!==h.task_id);
  const goalAnchor=metadata.goals?{ref:`$COLLAB/harness-mc/${current.descriptor.relativeDir}/project.json#/goals`,fingerprint:`sha256:${digest(JSON.stringify(metadata.goals))}`}:null;
  const refs=new Map(peers.map(t=>[`${h.project}/${t.id}`,t]));if(original)refs.set(`${h.project}/${h.task_id}`,original);
  check(validateTaskCandidate({task:candidate,previousTask:original,project:h.project,projectMeta:metadata,projectGoalAnchor:goalAnchor,canonicalTaskRefs:refs,peerTasks:peers}).length===0,'recovery_candidate_invalid');
  const legacy=runCanonicalPreflight({project:h.project,tasks:current.descriptor.tasksPath,taskId:h.task_id,intent:'execution',proposedAcceptance:[]});
  check(legacy.hc_gate?.decision!=='blocked'&&legacy.weekly_core_gate?.decision!=='blocked','recovery_original_gate_blocked');
  for(const field of ['definition','state'])check([nullableDigest(j.before[field]),nullableDigest(j.after[field])].includes(nullableDigest(current.target[field])),'recovery_target_changed');
  return {journal:j,file,original,current};
}
function recoveryRuntime(root,workbook,sessionContext,handoff){
  const registered=inspectWorkbookRegisteredRepos(workbook,{harnessRoot:root}),session=getWorkbookSessionResolvers(sessionContext,workbook);checkOperation(session,workbook,handoff);
  const proof=recovery(root,workbook,handoff);
  const refresh=()=>{getWorkbookSessionResolvers(sessionContext,workbook);check(same(inspectWorkbookRegisteredRepos(workbook,{harnessRoot:root}),registered),'intake_topology_changed');return recovery(root,workbook,handoff);};
  return {session_id:session.session_id,approvalResolver:request=>{refresh();return session.approvalResolver(request);},canonicalResolver:ref=>{
    const {original}=refresh();check(ref===workId(workbook.contract),'recovery_task_ref_changed');return original?{task_ref:ref,digest:digest(original),status:original.status,replaced_by:original.replaced_by,start_allowed:true,acceptance:original.acceptance_matrix}:{task_ref:ref,exists:false};
  },dependencyResolver:ref=>{
    refresh();const parts=ref.split('/');check(parts.length===2,'recovery_dependency_ref_invalid');const d=resolveMilestoneProject({repoRoot:root,projectId:parts[0]});check(d,'recovery_dependency_missing');const defs=JSON.parse(bytes(root,d.tasksPath)),overlay=bytes(root,d.statePath,true);const task=defs.tasks?.find(t=>t.id===parts[1]),state=overlay?JSON.parse(overlay).tasks?.[parts[1]]:null;
    check(task&&['completed','done'].includes(task.status)&&!task.replaced_by,'recovery_dependency_not_completed');if(state)for(const key of ['status','replaced_by','dependencies','acceptance_matrix','done_condition'])check(!Object.hasOwn(state,key)||same(state[key],task[key]),'recovery_dependency_state_conflict');return {task_ref:ref,digest:digest(task),status:task.status};
  },proof};
}
function requireClaims(workbook,sessionId){for(const repo of getResolvedRepos(workbook)){
  const observed=inspectWorkbookRepo({workbook,repoId:repo.repo_id,sessionId});check(observed.decision==='READY',observed.reason);
  check(observed.claims.some(c=>c.work_id===workId(workbook.contract)&&c.home===workbook.home&&c.contract_fingerprint===workbook.contract_fingerprint&&c.session_id===sessionId&&['active','pending_writeback'].includes(c.state)),'intake_acceptance_claim_required');
}}
export function runWorkbookIntakeAcceptance({workbook,sessionContext,handoff},{harnessRoot=defaultRoot}={}){
  workbook=live(workbook);const root=fs.realpathSync(harnessRoot);getWorkbookSessionResolvers(sessionContext,workbook);
  let receipt,executed;
  if(handoff){
    const recovering=hasJournal(root,handoff),runtime=recovering?recoveryRuntime(root,workbook,sessionContext,handoff):getWorkbookRuntimeContext(sessionContext,workbook,{harnessRoot:root});
    checkOperation(getWorkbookSessionResolvers(sessionContext,workbook),workbook,handoff);
    if(!recovering)check(same(snapshot(root,workbook,runtime.session_id).data.expected,handoff.expected),'intake_task_baseline_changed');
    requireClaims(workbook,runtime.session_id);
    const original=handoff.acceptance_receipt,currentSource=workbookSource(workbook);check(original,'recovery_receipt_required');
    // 原受測 source 改變時在執行 verifier 前拒絕，不先執行另一份來源再補查。
    for(const repo of getResolvedRepos(workbook))check(same(original.source?.[repo.repo_id]?.files,currentSource[repo.repo_id]?.files),'recovery_tested_source_changed');
    const result=runWorkbookAcceptance({workbook,...runtime});check(result.decision==='allow',result.reason||'intake_acceptance_failed');requireClaims(workbook,runtime.session_id);if(recovering)recovery(root,workbook,handoff);else check(same(snapshot(root,workbook,runtime.session_id).data.expected,handoff.expected),'intake_task_baseline_changed');
    check(evaluateWorkbookGate({contract:workbook.contract,event:'verify'},runtime).decision==='allow','recovery_verify_authority_changed');
    check(original.work_id===result.receipt.work_id&&original.contract_fingerprint===result.receipt.contract_fingerprint&&original.matrix_fingerprint===result.receipt.matrix_fingerprint,'recovery_receipt_binding_changed');
    const conditions=rows=>rows.map(r=>({id:r.id,status:r.status,verifier_fingerprint:r.verifier_fingerprint,executable:r.executable,artifacts:r.artifacts}));
    check(Array.isArray(original.results)&&same(conditions(original.results),conditions(result.receipt.results)),'recovery_verifier_results_changed');
    // stdout 可含時間／耗時；保存原、新兩份 hash，證明現在同條件實跑通過，
    // 不宣稱這次重跑能證明舊 stdout 曾經產生。固定 artifacts 仍須逐 byte 相同。
    for(const repo of getResolvedRepos(workbook))check(same(original.source?.[repo.repo_id]?.files,result.receipt.source?.[repo.repo_id]?.files),'recovery_tested_source_changed');
    receipt=original;executed=result.receipt;
  }else{
    const result=runWorkbookPreflight({workbookPath:workbook.home,event:'acceptance'},sessionContext,{harnessRoot:root});check(result.decision==='allow',result.reason||'intake_acceptance_failed');receipt=result.acceptance_receipt;executed=receipt;
  }
  const producer=Object.freeze({kind:'executed_workbook_intake_acceptance',version:1});
  producers.set(producer,{workbook,sessionContext,receipt:structuredClone(receipt),executed:structuredClone(executed)});
  const runtime_evidence_refs=workbook.contract.acceptance.some(a=>a.runtime_observation)?workbookRuntimeEvidence(workbook,executed):[];
  return {acceptance_receipt:structuredClone(receipt),executed_receipt:structuredClone(executed),runtime_evidence_refs,producer};
}
function localHandoffContext({workbook,sessionContext,handoff,producer,outputPath},root){
  workbook=live(workbook);validateLocalTaskHandoff(handoff);handoff=structuredClone(handoff);
  check(resolveWorkbookLocation(handoff.workbook_path)===workbook.home&&handoff.contract_fingerprint===workbook.contract_fingerprint&&`${handoff.project}/${handoff.task_id}`===workId(workbook.contract),'intake_handoff_binding_mismatch');
  const output=resolveWorkbookLocation(outputPath),repo=getResolvedRepo(workbook,workbook.contract.home.repo_id);
  check(output!==workbook.home&&repo.control_paths?.includes(path.relative(repo.canonical_root,output)),'intake_output_not_declared');
  const op={handoff_digest:digest(handoff),output_path:output},fp=digest(op),run=producers.get(producer);
  const refresh=()=>{
    const runtime=getWorkbookRuntimeContext(sessionContext,workbook,{harnessRoot:root});
    const gate=evaluateWorkbookGate({contract:workbook.contract,event:'handoff',operation:op},runtime);check(gate.decision==='allow',gate.reason||'intake_handoff_operation_not_verified');
    runtimeBoundary(handoff,central(root,workbook).target.definition,run);
    requireClaims(workbook,runtime.session_id);
    if(handoff.outcome==='completed'){
      check(run,'untrusted_acceptance_producer');check(run.workbook.home===workbook.home&&run.workbook.contract_fingerprint===workbook.contract_fingerprint&&same(run.receipt,handoff.acceptance_receipt),'producer_receipt_mismatch');
      getWorkbookSessionResolvers(run.sessionContext,run.workbook);
      const source=workbookSource(workbook);for(const r of getResolvedRepos(workbook))check(same(source[r.repo_id]?.files,run.receipt.source[r.repo_id]?.files),'intake_handoff_source_changed');
      for(const a of workbook.contract.acceptance){const r=getResolvedRepo(workbook,a.repo_id),result=run.receipt.results.find(item=>item.id===a.id);check(same(result?.artifacts,fileEvidence(r.checkout_root,a.artifact_paths)),'intake_handoff_artifact_changed');}
    }
    return runtime;
  };
  refresh();
  // 此 context 沒有中央 ownership／semantic／integrate 能力；中央不可寫時仍可存包。
  return Object.freeze({allowedWorkbookPaths:Object.freeze([workbook.home,handoff.workbook_path]),
    approvalResolver(request){if(request?.action!=='handoff'||request.operation_fingerprint!==fp||!same(request.operation,op))return null;return refresh().approvalResolver(request);},
    canonicalResolver(ref){return refresh().canonicalResolver(ref);},dependencyResolver(ref){return refresh().dependencyResolver(ref);},
    outputScopeResolver(request){refresh();check(request.output_path===output&&request.work_id===workId(workbook.contract)&&request.contract_fingerprint===workbook.contract_fingerprint,'intake_output_binding_changed');return {owned:true,...request};},
  });
}
export function createWorkbookIntakeContext({workbook,sessionContext,handoff,producer,review,purpose='integrate',outputPath},{harnessRoot=defaultRoot}={}){
  check(['handoff','integrate'].includes(purpose),'intake_purpose_invalid');
  if(purpose==='handoff')return localHandoffContext({workbook,sessionContext,handoff,producer,outputPath},fs.realpathSync(harnessRoot));
  workbook=live(workbook);const root=fs.realpathSync(harnessRoot);
  let runtime=getWorkbookSessionResolvers(sessionContext,workbook);
  const topology=inspectWorkbookRegisteredRepos(workbook,{harnessRoot:root});
  validateLocalTaskHandoff(handoff);check(resolveWorkbookLocation(handoff.workbook_path)===workbook.home&&handoff.contract_fingerprint===workbook.contract_fingerprint&&`${handoff.project}/${handoff.task_id}`===workId(workbook.contract),'intake_handoff_binding_mismatch');
  handoff=structuredClone(handoff);const op=operation(handoff),opFingerprint=digest(op);
  const checkApproval=()=>{
    const session=getWorkbookSessionResolvers(sessionContext,workbook);
    const proof=session.approvalResolver({work_id:workId(workbook.contract),contract_fingerprint:workbook.contract_fingerprint,action:'integrate',operation:op,operation_fingerprint:opFingerprint});
    check(proof?.operation_fingerprint===opFingerprint,'intake_operation_not_verified');return session;
  };
  const session=checkApproval();
  check(review?.kind==='workbook-intake-review-v1','intake_review_required');review=structuredClone(review);
  check(session.source_evidence.sources.some(s=>s.approval_ref===review.source_ref),'intake_review_source_unverified');
  const reviewProof=()=>{const proof=getWorkbookSessionResolvers(sessionContext,workbook).intakeReviewResolver?.({operation_fingerprint:opFingerprint,review_fingerprint:digest(review)});check(proof?.decision==='allow'&&proof.operation_fingerprint===opFingerprint&&proof.review_fingerprint===digest(review)&&proof.source_ref===review.source_ref,'intake_review_not_verified');};reviewProof();
  check(['clean','owned','handoff'].includes(review.central_ownership)&&text(review.ownership_reason),'intake_ownership_review_required');
  let initial;
  const checkSnapshot=()=>{
    reviewProof();check(same(inspectWorkbookRegisteredRepos(workbook,{harnessRoot:root}),topology),'intake_topology_changed');
    const current=snapshot(root,workbook,checkApproval().session_id);
    if(current.data.fingerprint!==review.snapshot_fingerprint){
      check(initial,'intake_snapshot_changed');check(same(current.data.repo_identity,initial.data.repo_identity),'central_identity_changed');const recovered=recovery(root,workbook,handoff),after=recovered.journal.after;
      check(current.data.claims_fingerprint===initial.data.claims_fingerprint,'intake_claims_changed');
      for(const field of ['definitions','state']){
        const expected=structuredClone(initial.observed[field]);
        if(field==='definitions'){const i=expected.tasks.findIndex(t=>t.id===handoff.task_id);if(i<0)expected.tasks.push(after.definition);else expected.tasks[i]=after.definition;}
        else expected.tasks[handoff.task_id]=after.state;
        check(same(current.observed[field],initial.observed[field])||same(current.observed[field],expected),'intake_snapshot_changed');
      }
      check(current.data.file_fingerprints[current.observed.descriptor.projectPath]===initial.data.file_fingerprints[initial.observed.descriptor.projectPath],'intake_project_changed');
    }else if(review.central_ownership==='clean')check(current.data.dirty_paths.length===0,'central_dirty_requires_owner_handoff');
    return current;
  };
  initial=checkSnapshot();
  const isRecovery=!same(initial.data.expected,handoff.expected);
  if(isRecovery)recovery(root,workbook,handoff);
  const run=producers.get(producer);
  runtimeBoundary(handoff,isRecovery?recovery(root,workbook,handoff).original:initial.observed.target.definition,run);
  const originalRuntime=isRecovery?recoveryRuntime(root,workbook,sessionContext,handoff):getWorkbookRuntimeContext(sessionContext,workbook,{harnessRoot:root});
  const originalGate=evaluateWorkbookGate({contract:workbook.contract,event:'integrate',operation:op},originalRuntime);check(originalGate.decision==='allow',originalGate.reason||'intake_original_gate_blocked');
  if(!workbook.contract.canonical_baseline){
    const peers=initial.observed.canonical_tasks.filter(t=>t.id!==handoff.task_id);
    check(review.semantic?.decision==='distinct'&&text(review.semantic.reason)&&review.semantic.canonical_tasks_fingerprint===digest(peers)&&same(review.semantic.reviewed_task_ids,peers.map(t=>t.id).sort()),'intake_semantic_review_required');
  }
  if(handoff.outcome==='completed'){
    check(run,'untrusted_acceptance_producer');check(run.workbook.home===workbook.home&&run.workbook.contract_fingerprint===workbook.contract_fingerprint&&same(run.receipt,handoff.acceptance_receipt),'producer_receipt_mismatch');
    getWorkbookSessionResolvers(run.sessionContext,run.workbook);
  }
  const boundRequest=request=>check(request.work_id===workId(workbook.contract)&&request.contract_fingerprint===workbook.contract_fingerprint,'intake_request_binding_mismatch');
  return Object.freeze({
    allowedWorkbookPaths:Object.freeze([workbook.home,handoff.workbook_path]),session_id:runtime.session_id,sessionId:runtime.session_id,
    approvalResolver(request){
      checkApproval();
      if(request?.action==='integrate'){if(request.operation_fingerprint!==opFingerprint||!same(request.operation,op))return null;}
      else if(request?.action==='handoff'){if(request.operation?.handoff_digest!==digest(handoff))return null;}
      else return null;
      return getWorkbookSessionResolvers(sessionContext,workbook).approvalResolver(request);
    },
    canonicalResolver(ref){return (isRecovery?recoveryRuntime(root,workbook,sessionContext,handoff):getWorkbookRuntimeContext(sessionContext,workbook,{harnessRoot:root})).canonicalResolver(ref);},
    dependencyResolver(ref){return (isRecovery?recoveryRuntime(root,workbook,sessionContext,handoff):getWorkbookRuntimeContext(sessionContext,workbook,{harnessRoot:root})).dependencyResolver(ref);},
    outputScopeResolver(request){
      boundRequest(request);checkApproval();const repo=getResolvedRepo(workbook,workbook.contract.home.repo_id);
      check(repo.control_paths?.includes(path.relative(repo.canonical_root,request.output_path)),'intake_output_not_declared');
      const observed=inspectWorkbookRepo({workbook,repoId:repo.repo_id,sessionId:runtime.session_id});check(observed.decision==='READY',observed.reason);
      check(observed.claims.some(c=>c.work_id===workId(workbook.contract)&&c.home===workbook.home&&c.contract_fingerprint===workbook.contract_fingerprint&&c.session_id===runtime.session_id&&['active','pending_writeback'].includes(c.state)),'intake_output_claim_required');return {owned:true,...request};
    },
    ownershipResolver(request){const current=checkSnapshot();check(same(request.paths,current.data.paths)&&same(request.file_fingerprints,Object.fromEntries(request.paths.map(p=>[p,current.data.file_fingerprints[p]]))),'intake_central_request_changed');return {decision:'allow',...request};},
    semanticResolver(request){checkSnapshot();check(same(request.handoff,handoff)&&digest(request.canonical_tasks)===review.semantic.canonical_tasks_fingerprint,'intake_semantic_source_changed');return {decision:'distinct',evidence_ref:review.source_ref};},
    evidenceResolver(request){
      boundRequest(request);checkApproval();check(run,'untrusted_acceptance_producer');getWorkbookSessionResolvers(run.sessionContext,run.workbook);requireClaims(workbook,runtime.session_id);
      runtimeBoundary(handoff,isRecovery?recovery(root,workbook,handoff).original:initial.observed.target.definition,run);
      check(request.receipt_digest===digest(run.receipt)&&request.result_digest===resultDigest(handoff)&&request.handoff_digest===digest(handoff)&&request.task_candidate_digest===digest(handoff.task_candidate),'producer_result_binding_changed');
      return {verified:true,receipt_digest:request.receipt_digest,contract_fingerprint:request.contract_fingerprint,result_digest:request.result_digest,task_candidate_digest:request.task_candidate_digest,source_ref:`executed-workbook-acceptance:${digest(run.executed)}`};
    },
  });
}
