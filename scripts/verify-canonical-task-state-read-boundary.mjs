import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {mergeTaskDefinitionsWithState} from './task-state.mjs';
import {applyTaskEvents} from './apply-task-events.mjs';

const definitions=[
 {id:'cancelled',status:'cancelled',title:'Original',note:'Canonical note'},
 {id:'replaced',status:'done',replaced_by:'successor'},
 {id:'completed',status:'completed',completed_at:'2026-09-08',commits:['current'],summary:'Accepted'},
 {id:'active',status:'in_progress'},
];
const state={tasks:{
 cancelled:{status:'in_progress',title:'Stale',note:'Stale note'},
 replaced:{status:'todo',replaced_by:null},
 completed:{status:'in_progress',completed_at:'2020-01-01',commits:['historical'],summary:'Old'},
 active:{status:'todo',coordination:{active_claim:{id:'live-claim'}},external_refs:{heptabase:{card_id:'retained'}}},
}};
const before=JSON.stringify({definitions,state});
for(const projectId of ['morrowise','harness-mc']){
 const merged=mergeTaskDefinitionsWithState(definitions,state,{projectId});
 assert.equal(merged[0].status,'cancelled','canonical cancellation must not be resurrected by state');
 assert.equal(merged[0].title,'Original');
 assert.equal(merged[0].note,'Canonical note');
 assert.equal(merged[1].replaced_by,'successor');
 assert.equal(merged[2].status,'completed');
 assert.equal(merged[2].completed_at,'2026-09-08');
 assert.equal(merged[2].summary,'Accepted');
 assert.deepEqual(merged[2].commits,['current','historical']);
 assert.deepEqual(merged[3].coordination,state.tasks.active.coordination);
 assert.deepEqual(merged[3].external_refs,state.tasks.active.external_refs);
 assert.throws(()=>mergeTaskDefinitionsWithState(definitions,{tasks:{active:{unexpected_owner:{status:'done'}}}},{projectId}),/unknown_task_state_field/);
}
assert.equal(JSON.stringify({definitions,state}),before,'readers must not mutate either source');
assert.equal(mergeTaskDefinitionsWithState(definitions,state,{projectId:'legacy-project'})[0].status,'in_progress');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'mw-state-boundary-'));
try{
 const dir=path.join(root,'milestones/morrowise');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'tasks.json'),JSON.stringify({tasks:definitions}));
 fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify({id:'morrowise',name:'MorroWise'}));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));
 const pending=path.join(root,'task-events/pending');fs.mkdirSync(pending,{recursive:true});
 fs.writeFileSync(path.join(pending,'reopen.json'),JSON.stringify({event_id:'reopen-cancelled',project:'morrowise',task_id:'cancelled',type:'task.reopened',created_at:'2026-09-09T00:00:00Z'}));
 const r=applyTaskEvents({root,runGenerateData:false,writeLatestReport:false});
 assert.equal(r.applied.length,0,'legacy semantic event must not create another lifecycle writer');
 assert.equal(r.rejected[0].reason,'canonical_lifecycle_requires_reviewed_intake');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'state.json'))),state);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'tasks.json'))),{tasks:definitions});
}finally{fs.rmSync(root,{recursive:true,force:true});}


// A crash recovery must not replace unrelated state written after the event.
const crashRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mw-state-recovery-'));
try {
 const dir=path.join(crashRoot,'milestones/morrowise');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'tasks.json'),JSON.stringify({tasks:[{id:'active',status:'in_progress'},{id:'other',status:'todo'}]}));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({tasks:{active:{status:'todo',summary:'retain history'},other:{commits:['before']}}}));
 const pending=path.join(crashRoot,'task-events/pending');fs.mkdirSync(pending,{recursive:true});
 fs.writeFileSync(path.join(pending,'commit.json'),JSON.stringify({event_id:'commit',actor:'codex',session_id:'fixture-session',summary:'Attach reviewed commit receipt',project:'morrowise',task_id:'active',type:'task.commit_attached',commit:'new',created_at:'2026-09-09T00:00:00Z'}));
 assert.throws(()=>applyTaskEvents({root:crashRoot,runGenerateData:false,writeLatestReport:false,afterStatePersisted(){throw Error('simulated interruption');}}),/simulated interruption/);
 const post=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));post.tasks.other.commits.push('after');
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(post));
 applyTaskEvents({root:crashRoot,runGenerateData:false,writeLatestReport:false});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'state.json'))),post,'recovery must preserve later unrelated state');
}finally{fs.rmSync(crashRoot,{recursive:true,force:true});}

const reconcileModule=await import('./reconcile-task-state.mjs').catch(()=>null);
assert.ok(reconcileModule?.planTaskStateReconciliation,'the original STATE-A02 exact-field reconciliation interface must exist');
const {planTaskStateReconciliation, applyTaskStateReconciliation}=reconcileModule;
const reconcileRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mw-state-reconcile-'));
try {
 const dir=path.join(reconcileRoot,'milestones/morrowise');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'tasks.json'),JSON.stringify({tasks:definitions}));
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));
 const selection=[{task_id:'cancelled',field:'status'}];
 const plan=planTaskStateReconciliation({root:reconcileRoot,projectId:'morrowise',selection});
 assert.equal(plan.changes.length,1);
 assert.deepEqual(plan.changes[0],{task_id:'cancelled',field:'status',before:'in_progress',after:'cancelled'});
 const stateBefore=fs.readFileSync(path.join(dir,'state.json'));
 const backup=path.join(reconcileRoot,'before.json');
 applyTaskStateReconciliation({root:reconcileRoot,plan,backupPath:backup});
 const after=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));
 assert.equal(after.tasks.cancelled.status,'cancelled');
 assert.deepEqual(after.tasks.active,state.tasks.active);
 assert.deepEqual(fs.readFileSync(backup),stateBefore);
 const rerun=planTaskStateReconciliation({root:reconcileRoot,projectId:'morrowise',selection});
 assert.equal(rerun.changes.length,0);
 const mtime=fs.statSync(path.join(dir,'state.json')).mtimeMs;
 assert.equal(applyTaskStateReconciliation({root:reconcileRoot,plan:rerun,backupPath:backup}).changed,false);
 assert.equal(fs.statSync(path.join(dir,'state.json')).mtimeMs,mtime);
 assert.throws(()=>applyTaskStateReconciliation({root:reconcileRoot,plan,backupPath:backup}),/reconciliation_source_changed/);
 fs.writeFileSync(path.join(dir,'state.json'),fs.readFileSync(backup));
 assert.deepEqual(fs.readFileSync(path.join(dir,'state.json')),stateBefore,'reviewed backup can restore exact original bytes');
}finally{fs.rmSync(reconcileRoot,{recursive:true,force:true});}

const {spawnSync}=await import('node:child_process');
const {fileURLToPath}=await import('node:url');
const {createHash}=await import('node:crypto');
const codeRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const consumerRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mw-state-consumers-'));
try {
 for(const rel of ['scripts/generate-data.mjs','scripts/generate-visual-sync-coverage.mjs','scripts/task-state.mjs','scripts/lib/milestone-projects.mjs','lib/taskOrdering.mjs']) {
  fs.mkdirSync(path.dirname(path.join(consumerRoot,rel)),{recursive:true});
  fs.copyFileSync(path.join(codeRoot,rel),path.join(consumerRoot,rel));
 }
 for(const projectId of ['morrowise','harness-mc','legacy-project']) {
  const dir=path.join(consumerRoot,'milestones',projectId);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify({name:projectId}));
  fs.writeFileSync(path.join(dir,'tasks.json'),JSON.stringify({tasks:definitions.map(t=>({...t,title:'MorroWise '+t.id,external_refs:{heptabase:{card_id:t.id==='active'?'retained':t.id}}}))}));
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));
 }
 const run=spawnSync(process.execPath,[path.join(consumerRoot,'scripts/generate-data.mjs')],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const projects=JSON.parse(fs.readFileSync(path.join(consumerRoot,'public/data/projects.json')));
 assert.deepEqual(projects.find(p=>p.project==='legacy-project').tasks.find(t=>t.id==='active').coordination,state.tasks.active.coordination,'legacy overlay coordination must remain visible');
 const {generateVisualSyncCoverage}=await import('./generate-visual-sync-coverage.mjs');
 const visual=generateVisualSyncCoverage({root:consumerRoot,write:false});
 for(const projectId of ['morrowise','harness-mc']) {
  const project=projects.find(p=>p.project===projectId);
  const tasks=project.tasks;
  const sourceHash=createHash('sha256').update(fs.readFileSync(path.join(consumerRoot,'milestones',projectId,'tasks.json'))).digest('hex');
  for(const original of definitions){
   assert.equal(tasks.find(t=>t.id===original.id).status,original.status);
   const row=visual.tracked_tasks.find(t=>t.project===projectId&&t.task_id===original.id);
   assert.equal(row.status,original.status);
   assert.equal(row.task_authority.definitions_sha256,sourceHash);
  }
  assert.equal(tasks.find(t=>t.id==='replaced').replaced_by,'successor');
  assert.deepEqual(tasks.find(t=>t.id==='active').coordination,state.tasks.active.coordination);
  assert.equal(project.task_authority.definitions_sha256,sourceHash);
 }
} finally {fs.rmSync(consumerRoot,{recursive:true,force:true});}


const refsMerged=mergeTaskDefinitionsWithState([{id:'receipt',status:'todo',external_refs:{heptabase:{whiteboard:'MC'}}}],{tasks:{receipt:{external_refs:{heptabase:{card_id:'existing-card',synced_at:'2026-09-08'}}}}},{projectId:'morrowise'});
assert.deepEqual(refsMerged[0].external_refs.heptabase,{card_id:'existing-card',synced_at:'2026-09-08',whiteboard:'MC'},'canonical reference metadata must not delete state-only receipts at the same destination');

const doneRoot=fs.mkdtempSync(path.join(os.tmpdir(),'mw-state-done-'));
try {
 const dir=path.join(doneRoot,'milestones/morrowise');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'tasks.json'),JSON.stringify({tasks:[{id:'done-task',status:'done'}]}));
 const claim={claim_id:'claim-a',repo_class:'shared_core_multi_writer',branch:'main',base_sha:'a'.repeat(40),claimed_at:'2026-09-08T00:00:00Z',owner_role:'integrator',actor:'codex',session_id:'fixture',remote_claim_ref:'refs/jv37/claims/morrowise/done-task',remote_claim_sha:'1'.repeat(40),state:'remote_synced',remote_commit:'abc1234'};
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({tasks:{'done-task':{coordination:{active_claim:claim}}}}));
 const pending=path.join(doneRoot,'task-events/pending');fs.mkdirSync(pending,{recursive:true});
 for(const [i,type,remote_state] of [[1,'task.completed','canonical_applied'],[2,'task.released','released']]){
  fs.writeFileSync(path.join(pending,i+'.json'),JSON.stringify({event_id:'done-'+i,project:'morrowise',task_id:'done-task',type,actor:'codex',session_id:'fixture',summary:'Fixture completion receipt',created_at:'2026-09-09T00:00:00Z',coordination:{...claim,remote_state}}));
 }
 const r=applyTaskEvents({root:doneRoot,runGenerateData:false,writeLatestReport:false,coordinationProofVerifier:()=>({decision:'READY'})});
 assert.equal(r.rejected.length,0,JSON.stringify(r.rejected));
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'state.json'))).tasks['done-task'].coordination.active_claim,null,'canonical done completion must permit valid terminal release');
}finally{fs.rmSync(doneRoot,{recursive:true,force:true});}


assert.throws(()=>mergeTaskDefinitionsWithState([{id:'receipt',status:'todo',external_refs:{heptabase:{card_id:'new-card',whiteboard:'MC'}}}],{tasks:{receipt:{external_refs:{heptabase:{card_id:'old-card',whiteboard:'MC',synced_at:'2026-09-08'}}}}},{projectId:'morrowise'}),/task_reference_identity_conflict/,'old-card receipt must not be attributed to a new card');


assert.throws(()=>mergeTaskDefinitionsWithState(definitions,{tasks:{ghost:{status:'todo'}}},{projectId:'morrowise'}),/state_without_task_definition/);
assert.throws(()=>mergeTaskDefinitionsWithState(definitions,{tasks:null},{projectId:'morrowise'}),/invalid_task_state_source/);

console.log('MW-STATE-01 scoped engineering fixtures passed; real reconciliation and fresh-session acceptance require their own receipts.');
