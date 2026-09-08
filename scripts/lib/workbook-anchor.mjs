import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const WORKBOOK_VERSION = 1;
const START = '<!-- morrowise:workbook:start -->';
const END = '<!-- morrowise:workbook:end -->';
const collaborationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const keys = ['schema_version','contract_revision','project_id','task_id','title','order_label','home','repos','baseline_refs','canonical_baseline','done_condition','acceptance','dependencies','budget','allowed_actions','approval_refs','stop_resume','formal_target'];
export const stableJson = value => JSON.stringify(value, function(k,v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])) : v;
});
export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stableJson(value)).digest('hex');
export const workId = c => `${c.project_id}/${c.task_id}`;
export function contractFingerprint(contract) {
  const {order_label, ...stable} = contract;
  return digest(stable);
}
const requireThat = (condition, reason) => { if (!condition) throw new Error(reason); };
const text = value => typeof value === 'string' && value.trim().length > 0;
export const safeRelative = value => text(value) && !path.isAbsolute(value) && !value.includes('\\') && !value.includes('\0') && !value.split('/').some(p=>!p || p==='.' || p==='..') && !value.split('/').includes('.git');
const unique = values => new Set(values).size === values.length;
const portableRoot = value => typeof value === 'string' && value.startsWith('$COLLAB/') && safeRelative(value.slice('$COLLAB/'.length));
const rootReference = value => typeof value === 'string' && (path.isAbsolute(value) || portableRoot(value));
// Shared contracts retain their portable bytes and fingerprints. Only IO uses
// roots resolved relative to the installed harness, never caller-supplied env.
export function resolveWorkbookLocation(value) {
  requireThat(rootReference(value),'workbook_location_invalid');
  return portableRoot(value) ? resolveRepoPath(collaborationRoot,value.slice('$COLLAB/'.length)) : value;
}
export function getResolvedRepos(workbook) {
  return workbook.contract.repos.map(repo=>({...repo,canonical_root:resolveWorkbookLocation(repo.canonical_root),checkout_root:resolveWorkbookLocation(repo.checkout_root)}));
}
export function getResolvedRepo(workbook,repoId) {
  const repo=getResolvedRepos(workbook).find(repo=>repo.repo_id===repoId);
  requireThat(repo,'repo_not_in_contract');return repo;
}

// JSON.parse discards duplicate keys. Detect them before parsing the contract.
function strictJson(source) {
  const tokens = source.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || [];
  let i=0;
  function visit() {
    const t=tokens[i++];
    if(t==='{') {
      const seen=new Set();
      if(tokens[i]==='}') {i++;return;}
      do {
        const key=JSON.parse(tokens[i++]);requireThat(!seen.has(key),'duplicate_json_key');seen.add(key);
        requireThat(tokens[i++]===':','invalid_json');visit();
        if(tokens[i]!==',') break;i++;
      } while(i<tokens.length);
      requireThat(tokens[i++]==='}','invalid_json');
    } else if(t==='[') {
      if(tokens[i]===']') {i++;return;}
      do {visit();if(tokens[i]!==',')break;i++;}while(i<tokens.length);
      requireThat(tokens[i++]===']','invalid_json');
    }
  }
  const parsed=JSON.parse(source);visit();return parsed;
}
export function validateWorkbookContract(c) {
  requireThat(c && typeof c==='object' && !Array.isArray(c),'contract_object_required');
  requireThat(Object.keys(c).every(k=>keys.includes(k)||k==='requirement_baseline') && keys.every(k=>Object.hasOwn(c,k)),'contract_fields_invalid');
  requireThat(c.schema_version===1 && Number.isInteger(c.contract_revision) && c.contract_revision>0,'unsupported_contract_version');
  requireThat([c.project_id,c.task_id,c.title,c.done_condition,c.stop_resume,c.formal_target].every(text),'contract_identity_required');
  requireThat(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(c.project_id) && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(c.task_id),'identity_invalid');
  requireThat(c.order_label===null || text(c.order_label),'order_label_invalid');
  if(c.canonical_baseline===null) requireThat(/^work-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(c.task_id),'new_work_requires_uuid_v4');
  requireThat(Array.isArray(c.repos)&&c.repos.length>0&&unique(c.repos.map(r=>r.repo_id)),'repos_invalid');
  for(const r of c.repos) {
    requireThat(text(r.repo_id)&&rootReference(r.canonical_root)&&rootReference(r.checkout_root),'repo_identity_invalid');
    requireThat(Array.isArray(r.write_paths)&&r.write_paths.length>0&&unique(r.write_paths)&&r.write_paths.every(safeRelative),'write_paths_invalid');
    if(r.control_paths!==undefined)requireThat(Array.isArray(r.control_paths)&&r.control_paths.every(safeRelative)&&unique([...r.write_paths,...r.control_paths]),'control_paths_invalid');
  }
  requireThat(c.home && c.repos.some(r=>r.repo_id===c.home.repo_id)&&safeRelative(c.home.path),'home_invalid');
  requireThat(Array.isArray(c.baseline_refs)&&c.baseline_refs.length>0&&c.baseline_refs.every(r=>text(r.ref)&&text(r.digest)),'baseline_required');
  requireThat(Array.isArray(c.acceptance)&&c.acceptance.length>0&&unique(c.acceptance.map(a=>a.id)),'acceptance_ids_invalid');
  for(const a of c.acceptance) {
    requireThat(text(a.id)&&c.repos.some(r=>r.repo_id===a.repo_id)&&path.isAbsolute(a.command||'')&&Array.isArray(a.args)&&a.args.every(v=>typeof v==='string'),'verifier_invalid');
    requireThat(Array.isArray(a.source_paths)&&a.source_paths.length>0&&a.source_paths.every(safeRelative)&&Array.isArray(a.artifact_paths)&&a.artifact_paths.length>0&&a.artifact_paths.every(safeRelative),'evidence_paths_invalid');
    requireThat(/^[0-9a-f]{64}$/.test(a.executable_sha256||'') && safeRelative(a.entrypoint) && a.source_paths.includes(a.entrypoint) && a.args[0]===a.entrypoint && /^[0-9a-f]{64}$/.test(a.entrypoint_sha256||''),'verifier_version_required');
    requireThat(!/^(?:ba|da|z|fi|c|tc|k)?sh$|^cmd(?:\.exe)?$|^powershell(?:\.exe)?$/i.test(path.basename(a.command)),'shell_verifier_rejected');
  }
  if(c.requirement_baseline!==undefined) {
    const b=c.requirement_baseline;
    requireThat(b&&typeof b==='object'&&Object.keys(b).length===4&&c.repos.some(r=>r.repo_id===b.repo_id)&&safeRelative(b.path)&&/^[0-9a-f]{64}$/.test(b.sha256||''),'requirement_baseline_invalid');
    requireThat(Array.isArray(b.ids)&&b.ids.length>0&&b.ids.every(text)&&unique(b.ids),'requirement_baseline_ids_invalid');
    requireThat(stableJson([...b.ids].sort())===stableJson(c.acceptance.map(a=>a.id).sort()),'requirement_ids_mismatch');
    requireThat(c.acceptance.every(a=>/^[0-9a-f]{64}$/.test(a.requirement_fingerprint||'')),'requirement_fingerprint_required');
  }
  for(const a of c.acceptance) if(Object.hasOwn(a,'pending_reason'))requireThat(text(a.pending_reason),'pending_reason_invalid');
  if(c.canonical_baseline!==null) {
    const b=c.canonical_baseline;
    requireThat(text(b.task_ref)&&text(b.task_digest)&&Array.isArray(b.acceptance)&&b.acceptance.length>0,'canonical_baseline_invalid');
    requireThat(unique(b.acceptance.map(a=>a.id)),'canonical_acceptance_ids_invalid');
    for(const a of b.acceptance) requireThat(c.acceptance.some(v=>v.id===a.id&&v.requirement_fingerprint===digest(a)),'canonical_acceptance_changed');
  }
  requireThat(Array.isArray(c.dependencies)&&c.dependencies.every(d=>text(d.ref)&&text(d.digest)),'dependencies_invalid');
  requireThat(c.budget && Number.isInteger(c.budget.max_wall_time_ms)&&c.budget.max_wall_time_ms>0&&Number.isInteger(c.budget.max_attempts)&&c.budget.max_attempts>0,'budget_invalid');
  requireThat(Array.isArray(c.allowed_actions)&&c.allowed_actions.length>0&&unique(c.allowed_actions)&&c.allowed_actions.every(a=>['implement','verify','commit','handoff','integrate'].includes(a)),'actions_invalid');
  requireThat(Array.isArray(c.approval_refs)&&c.approval_refs.length>0&&c.approval_refs.every(text),'approval_refs_required');
  return c;
}
export function parseWorkbook(markdown) {
  requireThat(typeof markdown==='string'&&markdown.split(START).length===2&&markdown.split(END).length===2,'unique_workbook_block_required');
  const start=markdown.indexOf(START)+START.length,end=markdown.indexOf(END);
  requireThat(end>start,'workbook_marker_order');
  const match=/^\s*```json\s*\n([\s\S]*?)\n```\s*$/.exec(markdown.slice(start,end));
  requireThat(match,'workbook_json_block_required');
  const contract=validateWorkbookContract(strictJson(match[1]));
  return {contract,contract_fingerprint:contractFingerprint(contract),source_digest:digest(markdown)};
}

// Refuse symlinks at every component, including dangling links, before reading evidence.
export function resolveRepoPath(root, relative, {allowMissing=false}={}) {
  requireThat(safeRelative(relative),'unsafe_repo_path');
  const base=fs.realpathSync(root);let current=base;
  for(const component of relative.split('/')) {
    current=path.join(current,component);
    try { requireThat(!fs.lstatSync(current).isSymbolicLink(),'symlink_path_rejected'); }
    catch(e) {if(!(allowMissing&&e.code==='ENOENT'))throw e;}
  }
  return current;
}
export function gitRead(repo,args) {
  const r=spawnSync('git',['--literal-pathspecs','--no-optional-locks',...args],{cwd:repo,encoding:'utf8',maxBuffer:16*1024*1024});
  requireThat(r.status===0,`git_read_failed:${args[0]}`);return r.stdout.trimEnd();
}
export function loadWorkbook(file) {
  file=resolveWorkbookLocation(typeof file==='string'&&!file.startsWith('$')?path.resolve(file):file);
  const parsed=parseWorkbook(fs.readFileSync(file,'utf8'));
  const c=parsed.contract;
  for(const r of getResolvedRepos(parsed)) {
    requireThat(fs.realpathSync(r.canonical_root)===r.canonical_root&&fs.realpathSync(r.checkout_root)===r.checkout_root,'repo_root_must_be_resolved');
    requireThat(gitRead(r.checkout_root,['rev-parse','--show-toplevel'])===r.checkout_root,'checkout_root_mismatch');
    const common=root=>fs.realpathSync(path.resolve(root,gitRead(root,['rev-parse','--git-common-dir'])));
    requireThat(common(r.canonical_root)===common(r.checkout_root),'checkout_identity_mismatch');
    for(const p of [...r.write_paths,...(r.control_paths||[])])resolveRepoPath(r.checkout_root,p,{allowMissing:true});
  }
  const homeRepo=getResolvedRepo(parsed,c.home.repo_id);
  // The home is pinned to its canonical repo; another checkout reads this same file.
  const home=resolveRepoPath(homeRepo.canonical_root,c.home.path);
  requireThat(path.resolve(file)===home,'workbook_home_mismatch');
  const workbook={...parsed,home};
  verifyRequirementBaseline(workbook);
  return workbook;
}

// This optional binding pins original requirements outside the contract block.
// Progress text remains editable; changing a requirement needs a new contract
// fingerprint and fresh source approval. Neither parsing nor pending is a pass.
export function verifyRequirementBaseline(workbook) {
  const b=workbook.contract.requirement_baseline;if(!b)return;
  const repo=getResolvedRepo(workbook,b.repo_id);
  const markdown=fs.readFileSync(resolveRepoPath(repo.checkout_root,b.path),'utf8');
  const start='<!-- morrowise:requirements:start -->',end='<!-- morrowise:requirements:end -->';
  requireThat(markdown.split(start).length===2&&markdown.split(end).length===2,'unique_requirement_block_required');
  const from=markdown.indexOf(start)+start.length,to=markdown.indexOf(end);
  requireThat(to>from,'requirement_marker_order');
  const rows=markdown.slice(from,to).trim().split('\n');
  requireThat(digest(rows.join('\n')+'\n')===b.sha256,'requirement_source_changed');
  const bindings=rows.map(row=>{
    const match=/^\|\s*([A-Za-z0-9_-]+)(?:[／/][^|]*)?\s*\|/.exec(row);
    requireThat(match,'requirement_row_invalid');return {id:match[1],fingerprint:digest(row)};
  });
  requireThat(unique(bindings.map(r=>r.id))&&stableJson(bindings.map(r=>r.id).sort())===stableJson([...b.ids].sort()),'requirement_source_ids_mismatch');
  for(const r of bindings)requireThat(workbook.contract.acceptance.some(a=>a.id===r.id&&a.requirement_fingerprint===r.fingerprint),'requirement_binding_changed');
}

export function evaluateWorkbookGate({contract,event='implement',operation}, {approvalResolver,dependencyResolver,canonicalResolver}={}) {
  try {validateWorkbookContract(contract);}catch(e){return {decision:'blocked',reason:e.message};}
  const request={work_id:workId(contract),contract_fingerprint:contractFingerprint(contract),action:event,approval_refs:contract.approval_refs};
  if(operation) {request.operation=operation;request.operation_fingerprint=digest(operation);}
  if(!contract.allowed_actions.includes(event))return {decision:'blocked',reason:'action_not_in_contract'};
  if(typeof approvalResolver!=='function')return {decision:'requires_human_approval',reason:'trusted_source_unavailable'};
  let proof;try{proof=approvalResolver(request);}catch{return {decision:'requires_human_approval',reason:'approval_source_unavailable'};}
  if(!proof || proof.revoked!==false || !contract.approval_refs.includes(proof.source_ref)||proof.work_id!==request.work_id||proof.contract_fingerprint!==request.contract_fingerprint||!proof.allowed_actions?.includes(event))return {decision:'requires_human_approval',reason:'approval_not_verified'};
  if(['commit','handoff','integrate'].includes(event) && (!operation || proof.operation_fingerprint!==request.operation_fingerprint))return {decision:'requires_human_approval',reason:'exact_operation_not_verified'};
  if(contract.canonical_baseline) {
    const current=canonicalResolver?.(contract.canonical_baseline.task_ref);
    if(!current || current.digest!==contract.canonical_baseline.task_digest || !['todo','in_progress'].includes(current.status) || current.replaced_by || current.start_allowed!==true)return {decision:'blocked',reason:'canonical_baseline_unverified_or_changed'};
    if(current.task_ref!==contract.canonical_baseline.task_ref || stableJson(current.acceptance)!==stableJson(contract.canonical_baseline.acceptance))return {decision:'blocked',reason:'canonical_acceptance_unverified'};
  } else {
    const current=canonicalResolver?.(request.work_id);
    if(current?.task_ref!==request.work_id||current.exists!==false)return {decision:'blocked',reason:'new_work_identity_unverified'};
  }
  for(const dep of contract.dependencies) if(dependencyResolver?.(dep.ref)?.digest!==dep.digest)return {decision:'blocked',reason:'dependency_unverified_or_changed',ref:dep.ref};
  return {decision:'allow',reason:'trusted_workbook_contract',...request,source_ref:proof.source_ref};
}
export function fileEvidence(root,files,{allowMissing=false}={}) {
  return Object.fromEntries([...new Set(files)].sort().map(p=>{
    const file=resolveRepoPath(root,p,{allowMissing});
    try {const s=fs.statSync(file);requireThat(s.isFile(),'evidence_must_be_file');return [p,{sha256:digest(fs.readFileSync(file)),mode:s.mode&0o111}];}
    catch(e){if(allowMissing&&e.code==='ENOENT')return[p,null];throw e;}
  }));
}
export function workbookSource(workbook) {
  return Object.fromEntries(getResolvedRepos(workbook).map(r=>{
    const acceptance=workbook.contract.acceptance.filter(a=>a.repo_id===r.repo_id);
    const inputs=new Set(acceptance.flatMap(a=>a.source_paths));
    const baseline=workbook.contract.requirement_baseline;
    if(baseline?.repo_id===r.repo_id)inputs.add(baseline.path);
    const outputs=new Set(acceptance.flatMap(a=>a.artifact_paths).filter(p=>!inputs.has(p)));
    for(const output of outputs)requireThat(r.write_paths.includes(output),'artifact_output_outside_scope');
    return [r.repo_id,{head:gitRead(r.checkout_root,['rev-parse','HEAD']),files:fileEvidence(r.checkout_root,[...r.write_paths.filter(p=>!outputs.has(p)),...inputs],{allowMissing:true})}];
  }));
}
export function runWorkbookAcceptance({workbook,...context}) {
  const gate=evaluateWorkbookGate({contract:workbook.contract,event:'verify'},context);if(gate.decision!=='allow')return gate;
  try {verifyRequirementBaseline(workbook);}catch(e){return {decision:'blocked',reason:e.message};}
  const pending=workbook.contract.acceptance.filter(a=>a.pending_reason);
  if(pending.length)return {decision:'blocked',reason:'requirements_not_ready',results:workbook.contract.acceptance.map(a=>({id:a.id,status:'not_run',reason:a.pending_reason||'other_required_evidence_pending'}))};
  const started=Date.now(),source=workbookSource(workbook),results=[];
  for(const a of workbook.contract.acceptance) {
    const repo=getResolvedRepo(workbook,a.repo_id);
    const remaining=workbook.contract.budget.max_wall_time_ms-(Date.now()-started);
    if(remaining<=0)return {decision:'blocked',reason:'verification_budget_exhausted'};
    const executable={path:fs.realpathSync(a.command),sha256:digest(fs.readFileSync(a.command))};
    if(executable.sha256!==a.executable_sha256 || digest(fs.readFileSync(resolveRepoPath(repo.checkout_root,a.entrypoint)))!==a.entrypoint_sha256)return {decision:'blocked',reason:'approved_verifier_changed',id:a.id};
    const result=spawnSync(a.command,a.args,{cwd:repo.checkout_root,encoding:'utf8',shell:false,timeout:remaining,maxBuffer:4*1024*1024});
    if(result.status!==0)return {decision:'blocked',reason:'verifier_failed',id:a.id,exit_code:result.status};
    results.push({id:a.id,status:'passed',verifier_fingerprint:digest(a),executable,output_sha256:digest(`${result.stdout||''}${result.stderr||''}`),artifacts:fileEvidence(repo.checkout_root,a.artifact_paths)});
  }
  if(digest(source)!==digest(workbookSource(workbook)))return {decision:'blocked',reason:'source_changed_during_verification'};
  for(const result of results) {
    const a=workbook.contract.acceptance.find(a=>a.id===result.id);
    if(fs.realpathSync(a.command)!==result.executable.path||digest(fs.readFileSync(a.command))!==result.executable.sha256)return {decision:'blocked',reason:'verifier_executable_changed_during_run'};
  }
  return {decision:'allow',receipt:{version:1,work_id:workId(workbook.contract),contract_fingerprint:workbook.contract_fingerprint,source,results,verified_at:new Date().toISOString()}};
}
export function validateAcceptanceEvidence(workbook,receipt) {
  // Consistency only. A consumer must also resolve trusted producer provenance or
  // rerun runWorkbookAcceptance; a JSON file is never proof that a verifier ran.
  try {
    validateWorkbookContract(workbook.contract);
    verifyRequirementBaseline(workbook);
    requireThat(!workbook.contract.acceptance.some(a=>a.pending_reason),'requirements_not_ready');
    requireThat(receipt?.version===1&&receipt.work_id===workId(workbook.contract)&&receipt.contract_fingerprint===contractFingerprint(workbook.contract),'receipt_contract_mismatch');
    requireThat(Number.isFinite(Date.parse(receipt.verified_at)),'receipt_time_invalid');
    requireThat(digest(receipt.source)===digest(workbookSource(workbook)),'receipt_source_changed');
    const ids=workbook.contract.acceptance.map(a=>a.id).sort();
    requireThat(stableJson(receipt.results?.map(r=>r.id).sort())===stableJson(ids),'receipt_ids_mismatch');
    for(const a of workbook.contract.acceptance) {
      const r=receipt.results.find(r=>r.id===a.id),repo=getResolvedRepo(workbook,a.repo_id);
      requireThat(r.status==='passed'&&r.verifier_fingerprint===digest(a)&&/^[0-9a-f]{64}$/.test(r.output_sha256||''),'receipt_verifier_invalid');
      requireThat(r.executable?.path===fs.realpathSync(a.command)&&r.executable.sha256===digest(fs.readFileSync(a.command)),'verifier_executable_changed');
      requireThat(digest(r.artifacts)===digest(fileEvidence(repo.checkout_root,a.artifact_paths)),'artifact_changed');
    }
    return {decision:'allow',reason:'acceptance_matches_current_source'};
  }catch(e){return {decision:'blocked',reason:e.message};}
}
