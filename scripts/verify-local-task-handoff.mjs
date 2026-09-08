import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { applyTaskEvents } from './apply-task-events.mjs';
import * as outbox from './task-event-outbox.mjs';
import * as validator from './validate-tasks.mjs';
import { acquireWorkbookClaim, commitWorkbookC1 } from './lib/workbook-coordination.mjs';
import { digest, contractFingerprint, loadWorkbook, runWorkbookAcceptance } from './lib/workbook-anchor.mjs';

function fixture() {
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mw-local-handoff-')));
  const root=path.join(base,'central'), product=path.join(base,'product');
  fs.mkdirSync(path.join(root,'milestones','demo'),{recursive:true}); fs.mkdirSync(product);
  const git=(...args)=>{ const r=spawnSync('git',args,{cwd:product,encoding:'utf8'}); assert.equal(r.status,0,r.stderr);return r.stdout.trim(); };
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  fs.writeFileSync(path.join(product,'input.txt'),'before\n');
  fs.writeFileSync(path.join(product,'verify.mjs'),"import fs from 'node:fs'; if(fs.readFileSync('input.txt','utf8')!=='ok\\n')process.exit(1);console.log('ok');\n");
  git('add','.');git('commit','-qm','fixture');fs.writeFileSync(path.join(product,'input.txt'),'ok\n');
  const goals={purpose:'測試本地交接'};
  const project={project_code:'DM',goals};
  const taskId=`work-${crypto.randomUUID()}`;
  const contract={schema_version:1,contract_revision:1,project_id:'demo',task_id:taskId,title:'測試交接工作',order_label:null,
    home:{repo_id:'product',path:'work.md'},repos:[{repo_id:'product',canonical_root:product,checkout_root:product,write_paths:['input.txt'],control_paths:['handoff.json']}],
    baseline_refs:[{ref:'product/HEAD',digest:git('rev-parse','HEAD')}],canonical_baseline:null,done_condition:'輸入驗證通過',
    acceptance:[{id:'A1',repo_id:'product',command:process.execPath,executable_sha256:digest(fs.readFileSync(process.execPath)),entrypoint:'verify.mjs',entrypoint_sha256:digest(fs.readFileSync(path.join(product,'verify.mjs'))),args:['verify.mjs'],source_paths:['input.txt','verify.mjs'],artifact_paths:['input.txt']}],
    dependencies:[],budget:{max_wall_time_ms:30000,max_attempts:2},allowed_actions:['implement','verify','handoff','integrate'],approval_refs:['user-message:fixture'],stop_resume:'從同一工作本恢復',formal_target:'demo'};
  const workbookPath=path.join(product,'work.md');
  const saveContract=()=>fs.writeFileSync(workbookPath,`<!-- morrowise:workbook:start -->\n\`\`\`json\n${JSON.stringify(contract,null,2)}\n\`\`\`\n<!-- morrowise:workbook:end -->\n`);
  saveContract();
  const approvalResolver=request=>({source_ref:'user-message:fixture',work_id:request.work_id,contract_fingerprint:contractFingerprint(contract),allowed_actions:contract.allowed_actions,operation_fingerprint:request.operation_fingerprint,revoked:false});
  const workbook=loadWorkbook(workbookPath);
  const evidence=runWorkbookAcceptance({workbook,approvalResolver,canonicalResolver:ref=>({task_ref:ref,exists:false})});assert.equal(evidence.decision,'allow',JSON.stringify(evidence));
  const verifiedDigest=digest(evidence.receipt);
  const candidate={id:taskId,title:contract.title,track:'dev',status:'completed',done_condition:contract.done_condition,order_label:null,acceptance_matrix:[{id:'A1',description:'輸入驗證通過'}],
    goal_alignment:{project_id:'demo',goal_ref:'$COLLAB/harness-mc/milestones/demo/project.json#/goals',goal_fingerprint:`sha256:${crypto.createHash('sha256').update(JSON.stringify(goals)).digest('hex')}`,contribution:'驗證交接流程',evidence_plan:['A1'],reviewed_at:'2026-09-07'},
    jv32_route:{workflows:['task-lifecycle','closeout-commit-routing']},
    task_lifecycle:{route:'JV-32/task-lifecycle',history:[{operation:'create',from_status:null,to_status:'todo',reason:'核准建立',evidence_refs:['user-message:fixture'],recorded_at:'2026-09-07'},{operation:'complete',from_status:'todo',to_status:'completed',reason:'驗收通過',evidence_refs:['A1'],recorded_at:'2026-09-07'}]},
    test_contract:{applicability:'exempt',behavior_cases:['輸入正確'],test_level:['integration'],fixture_refs:['fixture'],evidence_refs:['A1'],runtime_evidence_required:false,tdd_exemption_reason:'文件交接測試資料',alternative_verification_commands:['node verify.mjs']},
    completion_evidence:{regression_evidence:['A1'],verifier_refs:['A1'],fixture_runtime_boundary:'只有 fixture，未宣稱 runtime 上線'}};
  const handoff={schema_version:1,handoff_id:crypto.randomUUID(),project:'demo',task_id:taskId,contract_fingerprint:contractFingerprint(contract),result_version:1,outcome:'completed',expected:{definition_fingerprint:null,state_fingerprint:null},workbook_path:workbookPath,task_candidate:candidate,acceptance_receipt:evidence.receipt,evidence_refs:[{repo_id:'product',path:'input.txt',digest:digest(fs.readFileSync(path.join(product,'input.txt')))}],commit_receipts:[],reason:'驗收通過',next_action:'中央承接',created_at:'2026-09-07T00:00:00Z'};
  const tasksPath=path.join(root,'milestones','demo','tasks.json'),statePath=path.join(root,'milestones','demo','state.json');
  const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  json(path.join(root,'milestones','demo','project.json'),project);json(tasksPath,{tasks:[]});
  const context={canonicalResolver:ref=>({task_ref:ref,exists:false}),allowedWorkbookPaths:[workbookPath],approvalResolver,evidenceResolver:({receipt_digest})=>({verified:receipt_digest===verifiedDigest,receipt_digest:verifiedDigest,contract_fingerprint:contractFingerprint(contract),result_digest:handoffResultDigest(handoff),task_candidate_digest:digest(handoff.task_candidate),source_ref:'trusted-producer:fixture'}),semanticResolver:()=>({decision:'distinct',evidence_ref:'review:fixture'}),ownershipResolver:request=>({decision:'allow',file_fingerprints:request.file_fingerprints,paths:request.paths}),outputScopeResolver:request=>({owned:true,output_path:request.output_path,work_id:request.work_id,contract_fingerprint:request.contract_fingerprint})};
  return {base,root,product,contract,saveContract,workbookPath,handoff,context,tasksPath,statePath,json,cleanup:()=>fs.rmSync(base,{recursive:true,force:true}),readTasks:()=>JSON.parse(fs.readFileSync(tasksPath,'utf8')).tasks,run:(options={})=>applyTaskEvents({root,localHandoffs:[handoff],mode:'apply',authorizationContext:context,runGenerateData:false,...options})};
}
function tree(root) {const out={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else out[path.relative(root,p)]=digest(fs.readFileSync(p));}}walk(root);return out;}
function withFixture(fn){const f=fixture();try{return fn(f);}finally{f.cleanup();}}

test('preview validates a new local handoff without touching the central filesystem',()=>withFixture(f=>{
  const before=tree(f.root);const result=f.run({mode:'preview'});
  assert.equal(result.mode,'preview','explicit local handoff preview must be handled by the apply entrypoint');
  assert.equal(result.results[0].status,'preview_ready',JSON.stringify(result));assert.deepEqual(tree(f.root),before);
}));
test('new handoff applies full task evidence and assigns one central label',()=>withFixture(f=>{
  const result=f.run();assert.equal(result.results[0].status,'canonical_applied',JSON.stringify(result));
  const task=f.readTasks()[0];assert.equal(task.id,f.handoff.task_id);assert.equal(task.order_label,'DM-01');assert.equal(task.status,'completed');assert.deepEqual(task.completion_evidence,f.handoff.task_candidate.completion_evidence);assert.equal(f.handoff.task_candidate.order_label,null);
  const again=f.run();assert.equal(again.results[0].replayed,true);assert.equal(f.readTasks().length,1);
  assert.equal(again.results[0].receipt.order_label,'DM-01');
}));
test('missing trusted approval or producer evidence cannot complete a task',()=>withFixture(f=>{
  for(const context of [{approved:true},{...f.context,evidenceResolver:undefined},{...f.context,evidenceResolver:()=>({verified:true})}]) {
    const r=f.run({authorizationContext:context});assert.equal(r.results[0].status,'blocked');assert.equal(f.readTasks().length,0);
  }
}));
test('candidate validator rejects absent lifecycle or completion evidence before any formal mutation',()=>withFixture(f=>{
  for(const key of ['completion_evidence','task_lifecycle','jv32_route']) {
    const item=structuredClone(f.handoff);delete item.task_candidate[key];const r=f.run({localHandoffs:[item]});assert.equal(r.results[0].status,'blocked');assert.equal(f.readTasks().length,0);
  }
  assert.equal(typeof validator.validateTaskCandidate,'function');
}));
test('result identity prevents replay with another handoff id or changed payload',()=>withFixture(f=>{
  f.run();const retry=structuredClone(f.handoff);retry.handoff_id=crypto.randomUUID();
  assert.equal(f.run({localHandoffs:[retry]}).results[0].replayed,true);
  retry.reason='changed';assert.equal(f.run({localHandoffs:[retry]}).results[0].status,'blocked');assert.equal(f.readTasks().length,1);
}));
test('existing task and state compare-and-swap refuse stale mutation and retain unrelated data',()=>withFixture(f=>{
  f.run();const before=f.readTasks()[0];const h=structuredClone(f.handoff);h.handoff_id=crypto.randomUUID();h.result_version=2;
  h.expected={definition_fingerprint:digest(before),state_fingerprint:null};h.task_candidate.summary='第二次記錄';
  const data={tasks:[{...before,status:'cancelled'}, {id:'other',title:'他方工作',status:'todo',note:'保留'}]};f.json(f.tasksPath,data);
  assert.equal(f.run({localHandoffs:[h]}).results[0].status,'blocked');assert.deepEqual(f.readTasks(),data.tasks);
}));
test('cancelled outcome without a fabricated commit can be registered',()=>withFixture(f=>{
  f.handoff.outcome='cancelled';f.handoff.task_candidate.status='cancelled';delete f.handoff.acceptance_receipt;
  f.handoff.task_candidate.task_lifecycle.history[1]={operation:'cancel',from_status:'todo',to_status:'cancelled',reason:'需求取消',evidence_refs:['user-message:fixture'],recorded_at:'2026-09-07',no_replacement_reason:'停止工作'};
  const r=f.run();assert.equal(r.results[0].status,'canonical_applied',JSON.stringify(r));assert.equal(f.readTasks()[0].status,'cancelled');
}));
test('crash after definitions persists a journal and resumes without consuming a second label',()=>withFixture(f=>{
  assert.throws(()=>f.run({afterLocalHandoffPhase:phase=>{if(phase==='definition_written')throw new Error('simulated_crash');}}),/simulated_crash/);
  const data=JSON.parse(fs.readFileSync(f.tasksPath));data.tasks.push({id:'other',title:'其他工作',note:'保留'});f.json(f.tasksPath,data);
  const r=f.run();assert.equal(r.results[0].status,'canonical_applied',JSON.stringify(r));assert.equal(f.readTasks()[0].order_label,'DM-01');assert.equal(f.readTasks()[1].note,'保留');
}));
test('recovery refuses a changed target instead of replaying the whole state snapshot',()=>withFixture(f=>{
  assert.throws(()=>f.run({afterLocalHandoffPhase:phase=>{if(phase==='definition_written')throw new Error('simulated_crash');}}),/simulated_crash/);
  const data=JSON.parse(fs.readFileSync(f.tasksPath));data.tasks[0].status='cancelled';f.json(f.tasksPath,data);
  const r=f.run();assert.equal(r.results[0].status,'blocked');assert.equal(f.readTasks()[0].status,'cancelled');
}));
test('projection failure remains retryable without another task mutation',()=>withFixture(f=>{
  let fail=true;const projectionRunner=()=>({status:fail?1:0});
  const first=f.run({runGenerateData:true,projectionRunner});assert.equal(first.results[0].status,'projection_pending',JSON.stringify(first));
  const before=fs.readFileSync(f.tasksPath,'utf8');fail=false;
  const second=f.run({runGenerateData:true,projectionRunner});assert.equal(second.results[0].status,'canonical_applied',JSON.stringify(second));assert.equal(fs.readFileSync(f.tasksPath,'utf8'),before);
}));
test('unavailable dependency is retryable and does not consume a handoff identity',()=>withFixture(f=>{
  f.contract.dependencies=[{ref:'dep',digest:'expected'}];f.saveContract();f.handoff.contract_fingerprint=contractFingerprint(f.contract);f.handoff.outcome='cancelled';f.handoff.task_candidate.status='cancelled';f.handoff.task_candidate.task_lifecycle.history[1]={operation:'cancel',from_status:'todo',to_status:'cancelled',reason:'取消',evidence_refs:['user-message:fixture'],recorded_at:'2026-09-07',no_replacement_reason:'不再需要'};
  assert.equal(f.run().results[0].status,'blocked');
  const r=f.run({authorizationContext:{...f.context,dependencyResolver:()=>({digest:'expected'})}});assert.equal(r.results[0].status,'canonical_applied',JSON.stringify(r));
}));
test('writer is explicit local output and fails closed on a conflicting existing payload',()=>withFixture(f=>{
  assert.equal(typeof outbox.writeLocalTaskHandoff,'function');const outputPath=path.join(f.product,'handoff.json');
  const before=tree(f.root);outbox.writeLocalTaskHandoff({outputPath,handoff:f.handoff,authorizationContext:f.context});outbox.writeLocalTaskHandoff({outputPath,handoff:f.handoff,authorizationContext:f.context});
  assert.deepEqual(tree(f.root),before);assert.throws(()=>outbox.writeLocalTaskHandoff({outputPath,handoff:{...f.handoff,reason:'改過'},authorizationContext:f.context}));
}));

function existingFixture(f) {
  const before=structuredClone(f.handoff.task_candidate);before.status='todo';before.order_label='DM-01';before.task_lifecycle.history=before.task_lifecycle.history.slice(0,1);f.contract.acceptance[0].requirement_fingerprint=digest(before.acceptance_matrix[0]);
  f.json(f.tasksPath,{tasks:[before]});const state={status:'todo',note:'目標原 metadata'};f.json(f.statePath,{tasks:{[before.id]:state}});
  f.contract.order_label=before.order_label;f.contract.canonical_baseline={task_ref:`demo/${before.id}`,task_digest:digest(before),acceptance:before.acceptance_matrix};f.saveContract();
  f.handoff.contract_fingerprint=contractFingerprint(f.contract);f.handoff.task_candidate.order_label=before.order_label;f.handoff.expected={definition_fingerprint:digest(before),state_fingerprint:digest(state)};
  const workbook=loadWorkbook(f.workbookPath);
  const approval=f.context.approvalResolver;
  const receipt=runWorkbookAcceptance({workbook,approvalResolver:approval,canonicalResolver:()=>({task_ref:`demo/${before.id}`,digest:digest(before),status:'todo',acceptance:before.acceptance_matrix,start_allowed:true})});assert.equal(receipt.decision,'allow');f.handoff.acceptance_receipt=receipt.receipt;
  f.context.evidenceResolver=req=>({verified:true,receipt_digest:digest(receipt.receipt),contract_fingerprint:contractFingerprint(f.contract),result_digest:handoffResultDigest(f.handoff),task_candidate_digest:digest(f.handoff.task_candidate),source_ref:'trusted-producer:fixture'});
}
function handoffResultDigest(h){const {handoff_id,created_at,...rest}=h;return digest(rest);}

test('existing canonical work completes through the local route',()=>withFixture(f=>{
  existingFixture(f);const r=f.run();assert.equal(r.results[0].status,'canonical_applied',JSON.stringify(r));assert.equal(f.readTasks()[0].status,'completed');
}));
test('existing task recovers the definition-after/state-before crash window',()=>withFixture(f=>{
  existingFixture(f);assert.throws(()=>f.run({afterLocalHandoffPhase:phase=>{if(phase==='definition_written')throw new Error('simulated_crash');}}),/simulated_crash/);
  const state=JSON.parse(fs.readFileSync(f.statePath));state.tasks.other={status:'in_progress',note:'他方新增'};f.json(f.statePath,state);
  const r=f.run();assert.equal(r.results[0].status,'canonical_applied',JSON.stringify(r));assert.equal(JSON.parse(fs.readFileSync(f.statePath)).tasks.other.note,'他方新增');
}));
test('a verified working tree can close out from its real commit after an unrelated commit',()=>withFixture(f=>{
  const run=(...args)=>{const r=spawnSync('git',args,{cwd:f.product,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  fs.writeFileSync(path.join(f.product,'input.txt'),'ok\n');run('add','input.txt');run('commit','--allow-empty','-qm','reviewed fixture');
  const c1=run('rev-parse','HEAD');f.handoff.commit_receipts=[{repo_id:'product',c1_sha:c1}];
  fs.writeFileSync(path.join(f.product,'unrelated.txt'),'other\n');run('add','unrelated.txt');run('commit','-qm','unrelated');
  const r=f.run();assert.equal(r.results[0].status,'canonical_applied',JSON.stringify(r));
}));
test('a consumed sync request is not recreated during projection retry',()=>withFixture(f=>{
  const first=f.run({runGenerateData:true,projectionRunner:()=>({status:1})});assert.equal(first.results[0].status,'projection_pending');
  const pending=path.join(f.root,'sync-events','pending');const file=fs.readdirSync(pending)[0];const event=JSON.parse(fs.readFileSync(path.join(pending,file)));
  const synced=path.join(f.root,'sync-events','synced');fs.mkdirSync(synced,{recursive:true});f.json(path.join(synced,file),{...event,type:'synced',status:'synced'});fs.unlinkSync(path.join(pending,file));
  const r=f.run({runGenerateData:true,projectionRunner:()=>({status:0})});assert.equal(r.results[0].status,'canonical_applied',JSON.stringify(r));assert.equal(fs.readdirSync(pending).length,0,'terminal sync must not be enqueued again');
}));
test('complete evidence proof must bind the whole candidate and result, not only receipt JSON',()=>withFixture(f=>{
  const r=f.run({authorizationContext:{...f.context,evidenceResolver:req=>({verified:true,receipt_digest:req.receipt_digest,contract_fingerprint:req.contract_fingerprint,source_ref:'producer-without-result-binding'})}});
  assert.equal(r.results[0].status,'blocked');assert.equal(f.readTasks().length,0);
}));

test('central ownership conflict blocks a handoff even when its task CAS still matches',()=>withFixture(f=>{
  f.json(f.tasksPath,{tasks:[{id:'other',status:'in_progress',note:'他方未提交'}]});const before=fs.readFileSync(f.tasksPath,'utf8');
  const r=f.run({authorizationContext:{...f.context,ownershipResolver:()=>({decision:'blocked',reason:'other_owner'})}});
  assert.equal(r.results[0].status,'blocked');assert.equal(fs.readFileSync(f.tasksPath,'utf8'),before);
}));
test('local producer requires trusted handoff authority and an exact declared control path',()=>withFixture(f=>{
  assert.throws(()=>outbox.writeLocalTaskHandoff({outputPath:path.join(f.product,'handoff.json'),handoff:f.handoff}));
  assert.throws(()=>outbox.writeLocalTaskHandoff({outputPath:path.join(f.product,'unowned.json'),handoff:f.handoff,authorizationContext:f.context}));
  assert.equal(fs.existsSync(path.join(f.product,'unowned.json')),false);
}));
test('a journal cannot promote a cancelled payload by rewriting its cached candidate and digests',()=>withFixture(f=>{
  f.handoff.outcome='cancelled';f.handoff.task_candidate.status='cancelled';f.handoff.task_candidate.task_lifecycle.history[1]={operation:'cancel',from_status:'todo',to_status:'cancelled',reason:'取消',evidence_refs:['user-message:fixture'],recorded_at:'2026-09-07',no_replacement_reason:'無替代'};
  assert.throws(()=>f.run({afterLocalHandoffPhase:phase=>{if(phase==='definition_written')throw new Error('simulated_crash');}}),/simulated_crash/);
  const dir=path.join(f.root,'task-events','transactions','local-handoff'),file=path.join(dir,fs.readdirSync(dir)[0]);const journal=JSON.parse(fs.readFileSync(file));
  journal.after.definition.status='completed';journal.after.state.status='completed';journal.after_digest=digest(journal.after);f.json(file,journal);f.json(f.tasksPath,{tasks:[]});
  const r=f.run();assert.equal(r.results[0].status,'blocked');assert.equal(f.readTasks().length,0);
}));


test('P4 producer receipt integrates after its own real C1 object review',()=>withFixture(f=>{
  f.contract.allowed_actions.push('commit');f.saveContract();f.handoff.contract_fingerprint=contractFingerprint(f.contract);
  const workbook=loadWorkbook(f.workbookPath),options={workbook,repoId:'product',sessionId:'p5-fixture',owner:'fixture',ownershipResolver:()=>true,canonicalResolver:f.context.canonicalResolver,approvalResolver:req=>({...f.context.approvalResolver(req),operation_fingerprint:req.operation_fingerprint})};
  assert.equal(acquireWorkbookClaim(options).decision,'READY');
  const committed=commitWorkbookC1({...options,eventId:'p5-c1',message:'test: local handoff C1',scopePaths:['input.txt']});assert.equal(committed.decision,'READY',JSON.stringify(committed));
  const receipt=committed.receipt;f.handoff.commit_receipts=[{repo_id:'product',...receipt}];f.handoff.acceptance_receipt=receipt.acceptance;
  f.context.evidenceResolver=req=>({verified:req.receipt_digest===digest(receipt.acceptance),receipt_digest:digest(receipt.acceptance),contract_fingerprint:receipt.contract_fingerprint,result_digest:handoffResultDigest(f.handoff),task_candidate_digest:digest(f.handoff.task_candidate),source_ref:'controlled-runtime:commitWorkbookC1'});
  const result=f.run();assert.equal(result.results[0].status,'canonical_applied',JSON.stringify(result));assert.deepEqual(f.readTasks()[0].commits,[receipt.c1_sha]);
}));
test('a commit whose tree differs from verified source cannot complete the task',()=>withFixture(f=>{
  fs.writeFileSync(path.join(f.product,'input.txt'),'wrong\n');
  for(const args of [['add','input.txt'],['commit','-qm','wrong source']])assert.equal(spawnSync('git',args,{cwd:f.product}).status,0);
  const sha=spawnSync('git',['rev-parse','HEAD'],{cwd:f.product,encoding:'utf8'}).stdout.trim();f.handoff.commit_receipts=[{repo_id:'product',c1_sha:sha}];
  const result=f.run();assert.equal(result.results[0].status,'blocked');assert.equal(f.readTasks().length,0);
}));
test('recovery validates cached receipt and sync intents before touching canonical state',()=>withFixture(f=>{
  assert.throws(()=>f.run({afterLocalHandoffPhase:phase=>{if(phase==='definition_written')throw new Error('simulated_crash');}}),/simulated_crash/);
  const dir=path.join(f.root,'task-events','transactions','local-handoff'),file=path.join(dir,fs.readdirSync(dir)[0]);const saved=JSON.parse(fs.readFileSync(file));
  for(const mutate of [j=>{j.receipt.outcome='cancelled';},j=>{j.sync_intents[0].payload.whiteboard='wrong destination';}]) {
    const changed=structuredClone(saved);mutate(changed);f.json(file,changed);const before=tree(f.root);assert.equal(f.run().results[0].status,'blocked');assert.deepEqual(tree(f.root),before);
  }
}));
test('sync delivery before its checkpoint is found across terminal queues on recovery',()=>withFixture(f=>{
  assert.equal(f.run({runGenerateData:true,projectionRunner:()=>({status:1})}).results[0].status,'projection_pending');
  const dir=path.join(f.root,'task-events','transactions','local-handoff'),file=path.join(dir,fs.readdirSync(dir)[0]);const journal=JSON.parse(fs.readFileSync(file));journal.sync_released=[];journal.phase='canonical_applied';f.json(file,journal);
  const pending=path.join(f.root,'sync-events','pending'),name=fs.readdirSync(pending)[0],event=JSON.parse(fs.readFileSync(path.join(pending,name)));const terminal=path.join(f.root,'sync-events','failed');fs.mkdirSync(terminal,{recursive:true});f.json(path.join(terminal,name),{...event,type:'sync_failed',status:'failed'});fs.unlinkSync(path.join(pending,name));
  assert.equal(f.run().results[0].status,'canonical_applied');assert.equal(fs.readdirSync(pending).length,0);
}));
test('one blocked event does not prevent an independent selected handoff',()=>withFixture(f=>{
  const invalid=structuredClone(f.handoff);invalid.handoff_id=crypto.randomUUID();invalid.task_id='bad';
  const r=f.run({localHandoffs:[invalid,f.handoff]});assert.deepEqual(r.results.map(x=>x.status),['blocked','canonical_applied']);
}));

test('a central file changed during evidence review is not overwritten from a stale in-memory snapshot',()=>withFixture(f=>{
  let calls=0;const producer=f.context.evidenceResolver;f.context.evidenceResolver=req=>{
    const proof=producer(req);if(++calls===2)f.json(f.tasksPath,{tasks:[{id:'other',status:'todo',note:'並行新增'}]});return proof;
  };
  const result=f.run();assert.equal(result.results[0].status,'blocked');assert.equal(f.readTasks()[0].note,'並行新增');
}));
test('retry with another event ID and timestamp resumes the original semantic result',()=>withFixture(f=>{
  assert.throws(()=>f.run({afterLocalHandoffPhase:phase=>{if(phase==='definition_written')throw new Error('simulated_crash');}}),/simulated_crash/);
  const retry=structuredClone(f.handoff);retry.handoff_id=crypto.randomUUID();retry.created_at='2026-09-08T00:00:00Z';
  const result=f.run({localHandoffs:[retry]});assert.equal(result.results[0].status,'canonical_applied',JSON.stringify(result));assert.equal(f.readTasks()[0].completed_at,f.handoff.created_at);
}));

test('a new result waits for the same work pending transaction even before canonical writes',()=>withFixture(f=>{
  assert.throws(()=>f.run({afterLocalHandoffPhase:phase=>{if(phase==='definition_written')throw new Error('simulated_crash');}}),/simulated_crash/);
  f.json(f.tasksPath,{tasks:[]});f.handoff.handoff_id=crypto.randomUUID();f.handoff.result_version=2;
  const result=f.run();assert.equal(result.results[0].status,'blocked');assert.equal(f.readTasks().length,0);
}));
test('semantic retries retain each accepted event ID payload binding',()=>withFixture(f=>{
  f.run();const retry=structuredClone(f.handoff);retry.handoff_id=crypto.randomUUID();assert.equal(f.run({localHandoffs:[retry]}).results[0].replayed,true);
  retry.result_version=2;const result=f.run({localHandoffs:[retry]});assert.equal(result.results[0].reason,'handoff_id_payload_conflict');
}));


test('an applied receipt repairs the final journal cleanup crash without repeating the task or sync',()=>withFixture(f=>{
  assert.throws(()=>f.run({afterLocalHandoffPhase:phase=>{if(phase==='projection_verified')throw new Error('simulated_crash');}}),/simulated_crash/);
  const dir=path.join(f.root,'task-events','transactions','local-handoff'),file=path.join(dir,fs.readdirSync(dir)[0]),journal=fs.readFileSync(file);
  assert.equal(f.run().results[0].status,'canonical_applied');fs.writeFileSync(file,journal);
  const before=fs.readFileSync(f.tasksPath,'utf8'),pending=tree(path.join(f.root,'sync-events'));
  const replay=f.run();assert.equal(replay.results[0].replayed,true);assert.equal(fs.existsSync(file),false);assert.equal(fs.readFileSync(f.tasksPath,'utf8'),before);assert.deepEqual(tree(path.join(f.root,'sync-events')),pending);
}));

test('candidate validation retains the MorroWise weekly core project invariant',()=>withFixture(f=>{
  const task={...f.handoff.task_candidate,weekly_core:true,review_date:'2099-01-01'};
  const issues=validator.validateTaskCandidate({task,project:'morrowise'});
  assert.ok(issues.some(issue=>issue.includes('weekly_core=true requires status in_progress')),JSON.stringify(issues));
}));
