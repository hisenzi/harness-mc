import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolveMilestoneProject} from './lib/milestone-projects.mjs';
import {usesCanonicalTaskLifecycle, mergeTaskDefinitionsWithState} from './task-state.mjs';
import {withTaskEventApplyLock} from './apply-task-events.mjs';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function readSources(root,projectId) {
  if (!usesCanonicalTaskLifecycle(projectId)) throw Error('canonical_project_required');
  const descriptor=resolveMilestoneProject({repoRoot:fs.realpathSync(root),projectId});
  if (!descriptor) throw Error('unknown_reconciliation_project');
  for(const file of [descriptor.tasksPath,descriptor.statePath]) {
    if(fs.realpathSync(file)!==path.resolve(file)) throw Error('reconciliation_symlink_rejected');
  }
  const definitionsBytes=fs.readFileSync(descriptor.tasksPath),stateBytes=fs.readFileSync(descriptor.statePath);
  const definitions=JSON.parse(definitionsBytes.toString('utf8')).tasks,state=JSON.parse(stateBytes.toString('utf8'));
  mergeTaskDefinitionsWithState(definitions,state,{projectId});
  return {descriptor,definitionsBytes,stateBytes,definitions,state};
}

// This migration only corrects reviewed lifecycle status shadows. Coordination,
// receipts, summaries, and event histories are not reconciliation write targets.
export function planTaskStateReconciliation({root,projectId,selection}) {
  if (!Array.isArray(selection)||!selection.length) throw Error('exact_reconciliation_selection_required');
  const source=readSources(root,projectId),seen=new Set(),changes=[];
  for(const row of selection) {
    if(!row||Object.keys(row).sort().join(',')!=='field,task_id'||row.field!=='status'||typeof row.task_id!=='string'||seen.has(row.task_id)) throw Error('unsupported_reconciliation_selection');
    seen.add(row.task_id);
    const definition=source.definitions.find(t=>t.id===row.task_id),overlay=source.state.tasks[row.task_id];
    if(!definition||typeof definition.status!=='string'||!overlay||!Object.hasOwn(overlay,'status')) throw Error('reconciliation_status_source_missing');
    if(overlay.status!==definition.status) changes.push({task_id:row.task_id,field:'status',before:overlay.status,after:definition.status});
  }
  return {schema_version:1,project_id:projectId,selection:structuredClone(selection),definitions_sha256:hash(source.definitionsBytes),state_sha256:hash(source.stateBytes),changes};
}

// The caller must first review the returned exact plan under its named work's
// authorization. This function supplies CAS/backup/central-lock mechanics only.
export function applyTaskStateReconciliation({root,plan,backupPath}) {
  return withTaskEventApplyLock(root,()=>{
    const current=planTaskStateReconciliation({root,projectId:plan?.project_id,selection:plan?.selection});
    if(JSON.stringify(current)!==JSON.stringify(plan)) throw Error('reconciliation_source_changed');
    if(!current.changes.length) return {changed:false,changes:[]};
    const source=readSources(root,current.project_id);
    if(!path.isAbsolute(backupPath)||path.resolve(backupPath)===source.descriptor.statePath||path.resolve(backupPath)===source.descriptor.tasksPath) throw Error('independent_reconciliation_backup_required');
    fs.writeFileSync(backupPath,source.stateBytes,{flag:'wx',mode:0o600});
    for(const row of current.changes)source.state.tasks[row.task_id].status=row.after;
    const temp=path.join(os.tmpdir(),'morrowise-state-'+crypto.randomUUID()+'.tmp');
    try {
      fs.writeFileSync(temp,JSON.stringify(source.state,null,2)+'\n',{flag:'wx',mode:fs.statSync(source.descriptor.statePath).mode&0o777});
      // Recheck both sources immediately before the one projection replacement.
      if(hash(fs.readFileSync(source.descriptor.tasksPath))!==current.definitions_sha256||hash(fs.readFileSync(source.descriptor.statePath))!==current.state_sha256) throw Error('reconciliation_source_changed');
      fs.renameSync(temp,source.descriptor.statePath);
    } finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
    return {changed:true,changes:current.changes,backup_sha256:hash(source.stateBytes),result_sha256:hash(fs.readFileSync(source.descriptor.statePath))};
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [projectId,...taskIds]=process.argv.slice(2);
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  console.log(JSON.stringify(planTaskStateReconciliation({root,projectId,selection:taskIds.map(task_id=>({task_id,field:'status'}))}),null,2));
}
