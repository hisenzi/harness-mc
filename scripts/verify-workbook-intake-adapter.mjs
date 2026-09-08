import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest,loadWorkbook} from './lib/workbook-anchor.mjs';
import {acquireWorkbookClaim,handoffWorkbookClaim,markWorkbookPending} from './lib/workbook-coordination.mjs';
import {withHostFixture,contextInput} from './verify-workbook-session-context.mjs';

// 只在隔離子程序建立合成 host／repo；不讀真正的人訊息或修改共享資料。
async function cases(){await withHostFixture(async f=>{
  const api=await import('./lib/workbook-intake-adapter.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
  assert.equal(typeof api.createWorkbookIntakeContext,'function','P5 人監督 intake adapter 尚未實作');
  const session=await import('./lib/workbook-session-context.mjs');
  const preflight=await import('./lib/workbook-preflight-adapter.mjs');
  const {applyTaskEvents}=await import('./apply-task-events.mjs');
  const {writeLocalTaskHandoff}=await import('./task-event-outbox.mjs');
  const h=path.join(f.root,'harness-mc'),dir=path.join(h,'milestones','fixture');fs.mkdirSync(dir,{recursive:true});
  const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value)+'\n');
  const tasksPath=path.join(dir,'tasks.json'),statePath=path.join(dir,'state.json');
  const goals={purpose:'驗證人監督承接'};json(path.join(dir,'project.json'),{project_code:'FX',goals});json(tasksPath,{tasks:[]});
  const registry=path.join(h,'system-workflow','registries','morrowise-project-topology.json');fs.mkdirSync(path.dirname(registry),{recursive:true});
  json(registry,{migration_state_vocabulary:['inventory_only'],records:[{id:'fixture',classification:'canonical_project',migration_state:'inventory_only',repo_ref:'$COLLAB/repo',project_home_ref:'$COLLAB/repo'}]});
  const centralGit=(...args)=>{const r=spawnSync('git',args,{cwd:h,encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  centralGit('init','-q');centralGit('config','user.name','Fixture');centralGit('config','user.email','fixture@example.invalid');centralGit('config','commit.gpgsign','false');centralGit('config','core.hooksPath',path.join(f.root,'no-hooks'));centralGit('add','.');centralGit('commit','-qm','fixture central');
  const verifier=path.join(f.repo,'verify.mjs');fs.appendFileSync(verifier,"console.log('實跑時間='+Date.now());\n");f.git('add','verify.mjs');f.git('commit','-qm','fixture verifier with nondeterministic stdout');f.contract.acceptance[0].entrypoint_sha256=digest(fs.readFileSync(verifier));
  f.contract.title='人監督承接驗證';f.contract.allowed_actions=['implement','verify','handoff','integrate'];f.contract.repos[0].control_paths=['handoff.json'];f.reload();
  f.rows[1].payload.content[0].text='核准此 fixture 精確 scope 的實作、驗收與中央承接；既有內容仍須逐項審閱。';f.save();
  const initial=session.createWorkbookSessionContext(contextInput(session,f));
  assert.throws(()=>api.inspectWorkbookIntake({workbook:f.workbook,sessionContext:{approved:true}},{harnessRoot:h}),/untrusted_session_context/);
  const owned={...preflight.getWorkbookRuntimeContext(initial,f.workbook,{harnessRoot:h}),workbook:f.workbook,repoId:'fixture',sessionId:f.sessionId,owner:'Fixture'};
  assert.equal(acquireWorkbookClaim(owned).decision,'READY');
  const produced=api.runWorkbookIntakeAcceptance({workbook:f.workbook,sessionContext:initial},{harnessRoot:h});
  assert.equal(produced.acceptance_receipt.results[0].status,'passed');
  const snapshot=api.inspectWorkbookIntake({workbook:f.workbook,sessionContext:initial},{harnessRoot:h});
  const candidate={id:f.contract.task_id,title:f.contract.title,track:'dev',status:'completed',done_condition:f.contract.done_condition,order_label:null,acceptance_matrix:[{id:'A1',description:'原完整驗收'}],goal_alignment:{project_id:'fixture',goal_ref:'$COLLAB/harness-mc/milestones/fixture/project.json#/goals',goal_fingerprint:`sha256:${digest(JSON.stringify(goals))}`,contribution:'驗證真實承接入口',evidence_plan:['A1'],reviewed_at:'2026-09-08'},jv32_route:{workflows:['task-lifecycle','closeout-commit-routing']},task_lifecycle:{route:'JV-32/task-lifecycle',history:[{operation:'create',from_status:null,to_status:'todo',reason:'核准 fixture',evidence_refs:['fixture-human-grant'],recorded_at:'2026-09-08'},{operation:'complete',from_status:'todo',to_status:'completed',reason:'實跑通過',evidence_refs:['A1'],recorded_at:'2026-09-08'}]},test_contract:{applicability:'exempt',behavior_cases:['原完整驗收'],test_level:['integration'],fixture_refs:['fixture'],evidence_refs:['A1'],runtime_evidence_required:false,tdd_exemption_reason:'隔離承接資料',alternative_verification_commands:['node verify.mjs']},completion_evidence:{regression_evidence:['A1'],verifier_refs:['A1'],fixture_runtime_boundary:'只有隔離 fixture，非真實 pilot'}};
  const review={kind:'workbook-intake-review-v1',snapshot_fingerprint:snapshot.fingerprint,source_ref:'fixture-human-grant',central_ownership:'clean',ownership_reason:'實讀中央目標檔 clean 且無 active owner',semantic:{decision:'distinct',canonical_tasks_fingerprint:snapshot.canonical_tasks_fingerprint,reviewed_task_ids:[],reason:'逐項確認現有 task 集合為空，此 ID 為具名新工作'}};
  const handoff={schema_version:1,handoff_id:'fixture-handoff',project:'fixture',task_id:f.contract.task_id,contract_fingerprint:f.workbook.contract_fingerprint,result_version:1,outcome:'completed',expected:snapshot.expected,workbook_path:f.workbook.home,task_candidate:candidate,acceptance_receipt:produced.acceptance_receipt,evidence_refs:[{repo_id:'fixture',path:'a.txt',digest:digest('base')}],commit_receipts:[],reason:'實跑完整驗收',next_action:'單一中央 writer 承接',created_at:'2026-09-08T00:00:00Z'};
  const operationFor=value=>{const {handoff_id,created_at,...result}=value;return {outcome:value.outcome,result_digest:digest(result),task_candidate_digest:digest(value.task_candidate),expected:value.expected};};
  const authorize=(value,reviewed=review)=>session.createWorkbookSessionContext(contextInput(session,f,{allowed_actions:f.contract.allowed_actions,operations:[{action:'integrate',operation_fingerprint:digest(operationFor(value))},{action:'handoff',operation_fingerprint:digest({handoff_digest:digest(value),output_path:path.join(f.repo,'handoff.json')})}],intake_reviews:[{operation_fingerprint:digest(operationFor(value)),review_fingerprint:digest(reviewed)}]}));
  const approved=authorize(handoff);
  const build=(extra={})=>api.createWorkbookIntakeContext({workbook:f.workbook,sessionContext:approved,handoff,producer:produced.producer,review,...extra},{harnessRoot:h});
  assert.throws(()=>build({sessionContext:{approved:true}}),/untrusted_session_context/);
  for(const producer of [null,{},JSON.parse(JSON.stringify(produced.producer)),{...produced.producer}])assert.throws(()=>build({producer}),/untrusted_acceptance_producer/);
  const before=fs.readFileSync(tasksPath,'utf8');const intake=build();
  const preview=()=>applyTaskEvents({root:h,mode:'preview',localHandoffs:[handoff],authorizationContext:intake});
  assert.equal(preview().results[0].status,'preview_ready',JSON.stringify(preview()));assert.equal(fs.readFileSync(tasksPath,'utf8'),before);assert.equal(fs.existsSync(statePath),false);assert.equal(fs.existsSync(path.join(h,'task-events')),false);
  const movedCentral=path.join(f.root,'central-before-replacement');fs.renameSync(h,movedCentral);fs.cpSync(movedCentral,h,{recursive:true});
  assert.throws(()=>build(),/central_identity_changed|snapshot_changed/,'相同路徑與bytes不能延用被替換中央repo的review');fs.rmSync(h,{recursive:true});fs.renameSync(movedCentral,h);
  const changed=structuredClone(review);changed.semantic.reason='另一個未核准判斷';assert.throws(()=>build({review:changed}),/intake_review_not_verified/);
  const missingSemantic=structuredClone(review);delete missingSemantic.semantic;assert.throws(()=>build({review:missingSemantic,sessionContext:authorize(handoff,missingSemantic)}),/intake_semantic_review_required/);
  const otherOp={...operationFor(handoff),outcome:'blocked'};
  const multi=session.createWorkbookSessionContext(contextInput(session,f,{allowed_actions:['verify','integrate'],operations:[{action:'integrate',operation_fingerprint:digest(operationFor(handoff))},{action:'integrate',operation_fingerprint:digest(otherOp)}],intake_reviews:[{operation_fingerprint:digest(operationFor(handoff)),review_fingerprint:digest(review)}]}));
  const multiIntake=build({sessionContext:multi});assert.equal(multiIntake.approvalResolver({work_id:`fixture/${handoff.task_id}`,contract_fingerprint:handoff.contract_fingerprint,action:'integrate',operation:otherOp,operation_fingerprint:digest(otherOp)}),null,'context 只能承接建立時綁定的 outcome/result');
  const forged=structuredClone(handoff);forged.acceptance_receipt.verified_at='2026-09-08T00:00:01Z';assert.throws(()=>build({handoff:forged,sessionContext:authorize(forged)}),/producer_receipt_mismatch/);
  for(const runtimeEvidence of [undefined,['fixture:does-not-prove-live']]){
    const needsRuntime=structuredClone(handoff);needsRuntime.task_candidate.test_contract.runtime_evidence_required=true;if(runtimeEvidence)needsRuntime.task_candidate.completion_evidence.runtime_evidence=runtimeEvidence;
    assert.throws(()=>build({handoff:needsRuntime,sessionContext:authorize(needsRuntime)}),/runtime_evidence_unverified/,'verifier producer不能升格成可信live producer');
    assert.throws(()=>build({purpose:'handoff',outputPath:path.join(f.repo,'handoff.json'),handoff:needsRuntime,sessionContext:authorize(needsRuntime),review:undefined}),/runtime_evidence_unverified/,'缺live也不能先產生completed本地包');
  }
  fs.writeFileSync(path.join(f.repo,'a.txt'),'changed');assert.equal(preview().results[0].status,'blocked');fs.writeFileSync(path.join(f.repo,'a.txt'),'base');
  json(tasksPath,{tasks:[{id:'unrelated',title:'真正新狀態',status:'todo'}]});assert.equal(preview().results[0].status,'blocked');fs.writeFileSync(tasksPath,before);
  const claimDir=path.join(h,'.git','morrowise-workbooks-v1','claims');fs.mkdirSync(claimDir,{recursive:true});const claim=path.join(claimDir,'foreign.json');
  json(claim,{version:1,work_id:'other/work',home:'other-home',contract_fingerprint:'f'.repeat(64),scope_paths:['milestones/fixture/tasks.json'],control_paths:[],session_id:'other-session',state:'active'});
  assert.throws(()=>build(),/central.*owner/,'clean 中央檔也不能略過 active 他方 claim');
  const outputPath=path.join(f.repo,'handoff.json'),handoffOperation={handoff_digest:digest(handoff),output_path:outputPath};
  const onlyHandoff=session.createWorkbookSessionContext(contextInput(session,f,{allowed_actions:['handoff'],operations:[{action:'handoff',operation_fingerprint:digest(handoffOperation)}]}));
  const local=build({purpose:'handoff',outputPath,sessionContext:onlyHandoff,review:undefined});
  const saved=writeLocalTaskHandoff({outputPath,handoff,authorizationContext:local});assert.equal(saved.digest,digest(handoff));assert.deepEqual(JSON.parse(fs.readFileSync(outputPath)),handoff);assert.equal(fs.readFileSync(tasksPath,'utf8'),before);assert.equal(fs.existsSync(path.join(h,'task-events')),false,'中央排隊時只保存本地包');
  assert.equal(applyTaskEvents({root:h,mode:'preview',localHandoffs:[handoff],authorizationContext:local}).results[0].status,'blocked','handoff用途不能取得integrate權限');
  assert.throws(()=>build({purpose:'approved'}),/intake_purpose_invalid/);
  fs.unlinkSync(claim);assert.equal(preview().results[0].status,'preview_ready','中央owner釋出後回原完整intake');
  fs.writeFileSync(tasksPath,before+' ');assert.throws(()=>build(),/snapshot_changed/);fs.writeFileSync(tasksPath,before);
  f.rows.push(f.human('msg-stop','停止本次承接'));f.save();assert.equal(preview().results[0].status,'blocked');f.rows.pop();f.save();
  assert.equal(preview().results[0].status,'preview_ready');
  const nextSession='11223344-4110-4d22-a733-55c35b734f7a';
  const nextSource=path.join(path.dirname(f.sourcePath),`rollout-2026-09-08T00-00-00-${nextSession}.jsonl`);fs.writeFileSync(nextSource,[{...f.meta,payload:{...f.meta.payload,id:nextSession}},f.human('msg-grant','接續原精確工作與中央交易；確認前一 owner 已移交，重跑驗收後恢復原 journal。')].map(r=>JSON.stringify(r)).join('\n')+'\n');
  const childData=path.join(f.root,'intake-resume-fixture.json');json(childData,{root:f.root,h,sessionId:nextSession,workbookPath:f.workbook.home,handoff});
  const resumeProcess=mode=>spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--resume-fixture',childData,mode],{encoding:'utf8'});
  assert.equal(markWorkbookPending(owned).decision,'READY');assert.equal(handoffWorkbookClaim({...owned,toSessionId:nextSession,toOwner:'下一位人啟動 fixture session'}).decision,'READY');
  const queued=resumeProcess('queued-preview');assert.equal(queued.status,0,queued.stderr||queued.stdout);assert.match(queued.stdout,/QUEUED preview_ready/);assert.equal(fs.readFileSync(tasksPath,'utf8'),before);assert.equal(fs.existsSync(path.join(h,'task-events')),false);
  fs.writeFileSync(path.join(f.repo,'a.txt'),'changed after queue');const staleQueue=resumeProcess('queued-preview');assert.notEqual(staleQueue.status,0,'排隊期間產品變更不能沿用原receipt');fs.writeFileSync(path.join(f.repo,'a.txt'),'base');
  assert.equal(handoffWorkbookClaim({...owned,sessionId:nextSession,toSessionId:f.sessionId,toOwner:'原 fixture session'}).decision,'READY');
  assert.throws(()=>applyTaskEvents({root:h,mode:'apply',localHandoffs:[handoff],authorizationContext:intake,afterLocalHandoffPhase:phase=>{if(phase==='definition_written')throw Error('simulated_crash');},runGenerateData:false}),/simulated_crash/);
  assert.equal(JSON.parse(fs.readFileSync(tasksPath)).tasks[0].status,'completed');assert.equal(fs.existsSync(statePath),false);
  const journalDir=path.join(h,'task-events','transactions','local-handoff'),journalFile=path.join(journalDir,fs.readdirSync(journalDir)[0]),originalJournal=JSON.parse(fs.readFileSync(journalFile));
  const tampered=structuredClone(originalJournal);tampered.after.state.status='cancelled';tampered.after_digest=digest(tampered.after);json(journalFile,tampered);
  assert.throws(()=>api.runWorkbookIntakeAcceptance({workbook:f.workbook,sessionContext:approved,handoff},{harnessRoot:h}),/recovery_state_projection_changed/);json(journalFile,originalJournal);
  const other={id:'other-preserved',title:'另一件已核准工作',status:'todo'};const afterCrash=JSON.parse(fs.readFileSync(tasksPath));afterCrash.tasks.push(other);json(tasksPath,afterCrash);
  assert.equal(handoffWorkbookClaim({...owned,toSessionId:nextSession,toOwner:'下一位人啟動 fixture session'}).decision,'READY');
  const firstResume=resumeProcess('fail-projection');assert.equal(firstResume.status,0,firstResume.stderr||firstResume.stdout);assert.match(firstResume.stdout,/RESUME projection_pending/);
  const pending=path.join(h,'sync-events','pending'),synced=path.join(h,'sync-events','synced');const events=fs.readdirSync(pending).filter(n=>n.endsWith('.json'));assert.equal(events.length,1);fs.mkdirSync(synced,{recursive:true});fs.renameSync(path.join(pending,events[0]),path.join(synced,events[0]));
  const secondResume=resumeProcess('finish');assert.equal(secondResume.status,0,secondResume.stderr||secondResume.stdout);assert.match(secondResume.stdout,/RESUME canonical_applied/);
  assert.deepEqual(JSON.parse(fs.readFileSync(tasksPath)).tasks.find(t=>t.id===other.id),other);assert.equal(fs.readdirSync(pending).filter(n=>n.endsWith('.json')).length,0,'terminal 同步不能重生');
  console.log('PASS intake adapter: 真 producer、偽造/複製 token、精確 operation、原來源/產品/中央變動、clean active owner、合法無副作用 preview');
  console.log('PASS intake recovery: definition 中斷、真正新程序/新 session 重新驗收、保留他方 task、projection_pending/terminal sync 恢復');
});}
async function resumeFixture(inputFile,mode){
  // 只有本 verifier 的隔離子程序使用此 OS seam；production 無任意 host reader。
  const input=JSON.parse(fs.readFileSync(inputFile));assert.ok(input.root.startsWith(fs.realpathSync(os.tmpdir())+path.sep));
  const original=os.userInfo;os.userInfo=()=>({...original(),homedir:input.root});process.env.CODEX_THREAD_ID=input.sessionId;
  const session=await import('./lib/workbook-session-context.mjs'),api=await import('./lib/workbook-intake-adapter.mjs');
  const {applyTaskEvents}=await import('./apply-task-events.mjs');const workbook=loadWorkbook(input.workbookPath),f={workbook,contract:workbook.contract,sessionId:input.sessionId};
  const {handoff_id,created_at,...result}=input.handoff,op={outcome:input.handoff.outcome,result_digest:digest(result),task_candidate_digest:digest(input.handoff.task_candidate),expected:input.handoff.expected};
  const base=contextInput(session,f,{allowed_actions:['verify','integrate'],operations:[{action:'integrate',operation_fingerprint:digest(op)}]});
  let context=session.createWorkbookSessionContext(base);
  const snapshot=api.inspectWorkbookIntake({workbook,sessionContext:context,handoff:input.handoff},{harnessRoot:input.h});
  const definitions=JSON.parse(fs.readFileSync(path.join(input.h,'milestones','fixture','tasks.json'))).tasks.filter(t=>t.id!==input.handoff.task_id);
  const review={kind:'workbook-intake-review-v1',source_ref:'fixture-human-grant',snapshot_fingerprint:snapshot.fingerprint,central_ownership:'handoff',ownership_reason:'上一個具名 session 已釋出並將原工作 claim 移交；逐項重讀本次中央變動',semantic:{decision:'distinct',reason:'比較原工作與現存其他 task 的問題/輸入輸出/生命週期，保留其他 task',canonical_tasks_fingerprint:digest(definitions),reviewed_task_ids:definitions.map(t=>t.id).sort()}};
  context=session.createWorkbookSessionContext({...base,decision:{...base.decision,intake_reviews:[{operation_fingerprint:digest(op),review_fingerprint:digest(review)}]}});
  assert.throws(()=>api.createWorkbookIntakeContext({workbook,sessionContext:context,handoff:input.handoff,review,producer:{kind:'executed_workbook_intake_acceptance',version:1}},{harnessRoot:input.h}),/untrusted_acceptance_producer/);
  const produced=api.runWorkbookIntakeAcceptance({workbook,sessionContext:context,handoff:input.handoff},{harnessRoot:input.h});
  assert.notEqual(produced.acceptance_receipt.results[0].output_sha256,produced.executed_receipt.results[0].output_sha256,'每次真實stdout時間可不同，但固定artifact與原驗收不變');
  const intake=api.createWorkbookIntakeContext({workbook,sessionContext:context,handoff:input.handoff,review,producer:produced.producer},{harnessRoot:input.h});
  const preview=applyTaskEvents({root:input.h,mode:'preview',localHandoffs:[input.handoff],authorizationContext:intake});assert.equal(preview.results[0].status,'preview_ready',JSON.stringify(preview));
  if(mode==='queued-preview'){console.log('QUEUED preview_ready');return;}
  const failProjection=mode==='fail-projection';
  const applied=applyTaskEvents({root:input.h,mode:'apply',localHandoffs:[input.handoff],authorizationContext:intake,projectionRunner:()=>({status:failProjection?1:0})});assert.equal(applied.results[0].status,failProjection?'projection_pending':'canonical_applied',JSON.stringify(applied));
  console.log(`RESUME ${applied.results[0].status}`);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='--resume-fixture')await resumeFixture(process.argv[3],process.argv[4]);
  else if(process.argv[2]==='--isolated')await cases();
  else {const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--isolated'],{encoding:'utf8'});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status??1;}
}
