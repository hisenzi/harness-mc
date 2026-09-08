import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getResolvedRepos,resolveWorkbookLocation,loadWorkbook,workId,digest,stableJson,resolveRepoPath,evaluateWorkbookGate,runWorkbookAcceptance} from './workbook-anchor.mjs';
import {getWorkbookSessionResolvers} from './workbook-session-context.mjs';
import {inspectWorkbookRepo} from './workbook-coordination.mjs';
import {resolveMilestoneProject} from './milestone-projects.mjs';
import {runPreflight as runCanonicalPreflight} from '../work-anchor-preflight.mjs';

// Production source roots are module-relative. The harnessRoot argument is an
// embedding/test seam, never a CLI tasks/registry/resolver override. This module
// and the public entry may import each other: canonical preflight is invoked
// only inside a function and never receives a workbook argument.
const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const check=(ok,reason)=>{if(!ok)throw Error(reason);};
const present=v=>Array.isArray(v)?v.length>0:v!==null&&v!==undefined&&v!==''&&v!==false;
const overlap=(a,b)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
const taskRef=(ref,project)=>ref.includes('/')?ref:`${project}/${ref}`;
const statuses=new Set(['completed','done']);

function readJson(root,relative) {
  const file=resolveRepoPath(root,relative),before=fs.statSync(file),bytes=fs.readFileSync(file);
  check(before.isFile(),'registered_source_not_file');
  const after=fs.statSync(resolveRepoPath(root,relative));
  check(before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'registered_source_changed_while_reading');
  return {file,digest:digest(bytes),value:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))};
}
function readProject(root,projectId) {
  const d=resolveMilestoneProject({repoRoot:root,projectId});check(d,'unknown_registered_project');
  const project=readJson(root,path.relative(root,d.projectPath));
  const tasks=readJson(root,path.relative(root,d.tasksPath));
  check(Array.isArray(tasks.value.tasks)&&tasks.value.tasks.every(t=>typeof t.id==='string'&&t.id)&&new Set(tasks.value.tasks.map(t=>t.id)).size===tasks.value.tasks.length,'canonical_tasks_invalid_or_duplicate');
  const state=fs.existsSync(d.statePath)?readJson(root,path.relative(root,d.statePath)):null;
  check(!state||state.value.tasks&&typeof state.value.tasks==='object'&&!Array.isArray(state.value.tasks),'canonical_state_invalid');
  return {descriptor:d,project,tasks,state};
}
function readTask(root,ref) {
  check(typeof ref==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*\/[^/\s#]+$/.test(ref),'unsupported_canonical_dependency_ref');
  const [projectId,taskId]=ref.split('/'),p=readProject(root,projectId);
  const task=p.tasks.value.tasks.find(t=>t.id===taskId),overlay=p.state?.value.tasks?.[taskId];
  check(task||!overlay,'canonical_state_without_definition');
  // Runtime overlays may add receipts, but must not silently resurrect a task
  // or replace requirements frozen in its canonical definition.
  if(task&&overlay)for(const key of ['status','replaced_by','dependencies','acceptance_matrix','done_condition']) {
    check(!Object.hasOwn(overlay,key)||stableJson(overlay[key])===stableJson(task[key]),'canonical_state_definition_conflict');
  }
  return {...p,task,task_ref:ref};
}
function topology(root,workbook) {
  const source=readJson(root,'system-workflow/registries/morrowise-project-topology.json'),registry=source.value;
  check(Array.isArray(registry.records)&&Array.isArray(registry.migration_state_vocabulary),'topology_registry_invalid');
  for(const r of getResolvedRepos(workbook)) {
    const records=registry.records.filter(row=>row.id===r.repo_id);check(records.length===1,'repo_not_uniquely_registered');
    const row=records[0];check(row.classification==='canonical_project'&&registry.migration_state_vocabulary.includes(row.migration_state)&&row.migration_state!=='blocked','registered_repo_unavailable');
    check(typeof row.repo_ref==='string'&&row.repo_ref.startsWith('$COLLAB/'),'registered_repo_ref_unsupported');
    const canonical=resolveRepoPath(path.dirname(root),row.repo_ref.slice('$COLLAB/'.length));
    check(fs.realpathSync(canonical)===r.canonical_root,'registered_repo_binding_mismatch');
  }
  return source;
}
export function inspectWorkbookRegisteredRepos(workbook,{harnessRoot=defaultRoot}={}) {
  const source=topology(fs.realpathSync(harnessRoot),workbook);
  return {source_ref:source.file,source_fingerprint:source.digest};
}

function dependenciesOf(task,project) {
  check(task.dependencies===undefined||Array.isArray(task.dependencies),'canonical_dependencies_unsupported');
  return (task.dependencies||[]).map(ref=>{check(typeof ref==='string'&&ref,'canonical_dependencies_unsupported');return taskRef(ref,project);});
}

export function getWorkbookRuntimeContext(context,workbook,{harnessRoot=defaultRoot}={}) {
  const root=fs.realpathSync(harnessRoot);
  const session=getWorkbookSessionResolvers(context,workbook);
  const registered=topology(root,workbook);readTask(root,workId(workbook.contract));
  const dependencyResolver=ref=>{
    const current=readTask(root,ref);
    check(current.task&&statuses.has(current.task.status)&&!current.task.replaced_by,'dependency_not_completed');
    return {task_ref:ref,digest:digest(current.task),status:current.task.status};
  };
  let canonicalObservation=null;
  const canonicalResolver=ref=>{
    topology(root,workbook);
    check(ref===workId(workbook.contract),'canonical_identity_mismatch');
    const current=readTask(root,ref),task=current.task;
    const preserved=task?dependenciesOf(task,workbook.contract.project_id):[];
    const declared=new Set(workbook.contract.dependencies.map(d=>d.ref));
    check(preserved.every(dep=>declared.has(dep)),'canonical_dependency_omitted');
    for(const dep of preserved)dependencyResolver(dep);
    const legacy=runCanonicalPreflight({project:workbook.contract.project_id,tasks:current.descriptor.tasksPath,taskId:workbook.contract.task_id,intent:'execution',proposedAcceptance:[]});
    const after=readTask(root,ref);
    check(after.tasks.digest===current.tasks.digest&&after.project.digest===current.project.digest&&after.state?.digest===current.state?.digest,'canonical_changed_during_preflight');
    canonicalObservation={weekly_core_gate:legacy.weekly_core_gate,legacy_anchor_decision:legacy.decision};
    if(!task) {
      // An absent UUID is not a legacy active task. Only the existing project
      // weekly gate applies here; never turn legacy's missing-task result into
      // a fabricated canonical allow. Its noncore overdue warning stays allow.
      check(legacy.weekly_core_gate?.decision!=='blocked','project_weekly_core_blocked');
      return {task_ref:ref,exists:false};
    }
    return {task_ref:ref,exists:true,digest:digest(task),status:task.status,replaced_by:task.replaced_by,start_allowed:legacy.decision==='allow',acceptance:task.acceptance_matrix,legacy_gate:legacy};
  };
  return {
    sessionId:session.session_id,session_id:session.session_id,
    source_evidence:{...session.source_evidence,topology_ref:registered.file,topology_fingerprint:registered.digest},
    get canonical_observation(){return structuredClone(canonicalObservation);},
    approvalResolver(request){topology(root,workbook);return session.approvalResolver(request);},
    canonicalResolver,dependencyResolver,
  };
}

function inspectOwnership(workbook,runtime,{required=false}={}) {
  const observations=[];
  for(const repo of getResolvedRepos(workbook)) {
    const observed=inspectWorkbookRepo({workbook,repoId:repo.repo_id,sessionId:runtime.session_id});
    check(observed.decision==='READY',observed.reason);
    const claim=observed.claims.find(c=>c.work_id===workId(workbook.contract)&&c.state==='active'&&c.home===workbook.home&&c.contract_fingerprint===workbook.contract_fingerprint&&c.session_id===runtime.session_id);
    if(required)check(claim,'active_owned_claim_required_before_verifier');
    const owned=[...repo.write_paths,...(repo.control_paths||[])];
    check(claim||!observed.dirty_paths.some(p=>owned.some(s=>overlap(s,p))),'dirty_scope_requires_owner_handoff');
    if(required) {
      const inputs=workbook.contract.acceptance.filter(a=>a.repo_id===repo.repo_id).flatMap(a=>[a.entrypoint,...a.source_paths]);
      check(!observed.dirty_paths.some(p=>inputs.some(s=>overlap(s,p))&&!owned.some(s=>overlap(s,p))),'dirty_verifier_input_not_owned');
    }
    observations.push({repo_id:repo.repo_id,head:observed.head,ref:observed.ref,claim_state:claim?.state??null,excluded_paths:observed.excluded_paths});
  }
  return observations;
}

export function runWorkbookPreflight(args,context,{harnessRoot=defaultRoot}={}) {
  const result={source_kind:'workbook',supported_versions:{contract:1,session_context:1,acceptance_receipt:1},decision:'blocked',reason:null,read_only:true,next_required_step:'Resolve the named workbook source and rerun preflight.'};
  try {
    check(args&&typeof args==='object','workbook_arguments_required');
    check(args.intent!=='proposal','workbook_proposal_intent_unsupported');
    check(!['tasks','proposedId','proposedTitle','proposedTrack','proposedDoneCondition','proposedAcceptance'].some(k=>present(args[k])),'workbook_and_canonical_override_mutually_exclusive');
    check(!present(args.acceptanceResults)&&!present(args.matrixFingerprint),'workbook_requires_executed_acceptance');
    const file=args.workbookPath||args.workbook;check(typeof file==='string'&&file,'named_workbook_required');
    check(!args.workbookPath||!args.workbook||resolveWorkbookLocation(args.workbookPath.startsWith('$')?args.workbookPath:path.resolve(args.workbookPath))===resolveWorkbookLocation(args.workbook.startsWith('$')?args.workbook:path.resolve(args.workbook)),'workbook_source_conflict');
    const workbook=loadWorkbook(file),c=workbook.contract;
    Object.assign(result,{workbook:workbook.home,work_id:workId(c),contract_fingerprint:workbook.contract_fingerprint,project:c.project_id,active_task:{id:c.task_id,title:c.title,done_condition:c.done_condition,acceptance_matrix:c.acceptance}});
    check(!present(args.project)||args.project===c.project_id,'workbook_project_mismatch');
    check(!present(args.taskId)||args.taskId===c.task_id,'workbook_task_mismatch');
    const event=args.event||(['implementation','acceptance'].includes(args.intent)?args.intent:'implementation');
    check(['implementation','acceptance'].includes(event),'unsupported_workbook_event');
    if(present(args.scope)) {
      check(Array.isArray(args.scope)&&args.scope.every(s=>typeof s==='string'&&getResolvedRepos(workbook).some(r=>r.write_paths.some(p=>s===p||s===path.join(r.checkout_root,p)))),'workbook_scope_mismatch');
    }
    let runtime;
    try {runtime=getWorkbookRuntimeContext(context,workbook,{harnessRoot});}
    catch(e){if(e.message==='untrusted_session_context'||e.message.startsWith('human_source')||e.message==='session_contract_changed')return {...result,decision:'requires_human_approval',reason:e.message,next_required_step:'The human-supervised host session must reread the original human source and bind a fresh in-memory context.'};throw e;}
    const action=event==='acceptance'?'verify':'implement';
    let gate;
    try {gate=evaluateWorkbookGate({contract:c,event:action},runtime);}
    finally {result.weekly_core_gate=runtime.canonical_observation?.weekly_core_gate??null;}
    if(gate.decision!=='allow')return {...result,...gate,next_required_step:'Resolve the reported source, original canonical gate, or dependency before proceeding.'};
    const ownership=inspectOwnership(workbook,runtime,{required:event==='acceptance'});
    Object.assign(result,{ownership,source_evidence:runtime.source_evidence});
    if(event==='acceptance') {
      result.read_only=false;
      const verified=runWorkbookAcceptance({workbook,...runtime});
      if(verified.decision!=='allow')return {...result,...verified,next_required_step:'Resolve the failed original acceptance requirement and rerun the real verifier.'};
      const fresh=evaluateWorkbookGate({contract:c,event:'verify'},runtime);
      if(fresh.decision!=='allow')return {...result,...fresh,next_required_step:'Acceptance source changed during verification; review the current source and rerun.'};
      inspectOwnership(workbook,runtime,{required:true});
      return {...result,decision:'allow',reason:'workbook_acceptance_executed',acceptance_receipt:verified.receipt,next_required_step:'Record this local acceptance receipt in the same workbook. Commit and formal writeback require their own exact authorized operations.'};
    }
    return {...result,decision:'allow',reason:'trusted_workbook_preflight',execution_ready:ownership.every(r=>r.claim_state==='active'),next_required_step:ownership.every(r=>r.claim_state==='active')?'Continue within the owned workbook scope; execute its full acceptance before closeout.':'Acquire the named workbook claim in every checkout before editing; resolve dirty ownership through the existing owner handoff.'};
  }catch(e){return {...result,decision:'blocked',reason:e.message};}
}
