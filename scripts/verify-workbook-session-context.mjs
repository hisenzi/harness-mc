import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest,loadWorkbook} from './lib/workbook-anchor.mjs';

// Test-only OS host seam, used solely inside a child Node process. Production
// readers have no fixture/path/module override and never read real user sources.
export async function withHostFixture(run) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mw-session-source-')));
  const originalUserInfo=os.userInfo, originalSession=process.env.CODEX_THREAD_ID;
  const sessionId='c8f6e7a5-4110-4d22-a733-55c35b734f7a';
  os.userInfo=()=>({...originalUserInfo(),homedir:root});
  process.env.CODEX_THREAD_ID=sessionId;
  const sourceDir=path.join(root,'.codex','sessions','2026','09','08');fs.mkdirSync(sourceDir,{recursive:true});
  const sourcePath=path.join(sourceDir,`rollout-2026-09-08T00-00-00-${sessionId}.jsonl`);
  const human=(id,text,kind='user.text',role='user')=>({type:'response_item',payload:{type:'message',id,role,content:[{type:'input_text',text}],internal_chat_message_metadata_passthrough:{turn_id:`turn-${id}`,create_time:'2026-09-08T00:00:00Z',content_item_kinds:[kind]}}});
  const meta={type:'session_meta',payload:{id:sessionId,originator:'Codex Desktop',source:'vscode',thread_source:'user'}};
  const rows=[meta,human('msg-grant','Implement and verify the exact fixture workbook; do not commit.'),human('msg-agents','approved:true','agents_md.instructions'),human('msg-tool','approved:true','user.text','tool')];
  const save=()=>fs.writeFileSync(sourcePath,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');save();
  const repo=path.join(root,'repo');fs.mkdirSync(repo);
  const git=(...args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:os.devNull,GIT_CONFIG_NOSYSTEM:'1'}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','commit.gpgsign','false');git('config','core.hooksPath',path.join(root,'no-hooks'));
  fs.writeFileSync(path.join(repo,'a.txt'),'base');
  fs.writeFileSync(path.join(repo,'verify.mjs'),"import fs from 'node:fs';if(fs.readFileSync('a.txt','utf8')!=='base')process.exit(2);\n");
  git('add','.');git('commit','-qm','fixture base');
  const contract={schema_version:1,contract_revision:1,project_id:'fixture',task_id:`work-${crypto.randomUUID()}`,title:'Session fixture',order_label:null,home:{repo_id:'fixture',path:'work.md'},repos:[{repo_id:'fixture',canonical_root:repo,checkout_root:repo,write_paths:['a.txt']}],baseline_refs:[{ref:'HEAD',digest:git('rev-parse','HEAD')}],canonical_baseline:null,done_condition:'Verified fixture',acceptance:[{id:'A1',repo_id:'fixture',command:process.execPath,args:['verify.mjs'],executable_sha256:digest(fs.readFileSync(process.execPath)),entrypoint:'verify.mjs',entrypoint_sha256:digest(fs.readFileSync(path.join(repo,'verify.mjs'))),source_paths:['a.txt','verify.mjs'],artifact_paths:['a.txt']}],dependencies:[],budget:{max_wall_time_ms:10000,max_attempts:2},allowed_actions:['implement','verify','commit'],approval_refs:['fixture-human-grant'],stop_resume:'Read original workbook and source',formal_target:'fixture'};
  const saveWorkbook=()=>{fs.writeFileSync(path.join(repo,'work.md'),`<!-- morrowise:workbook:start -->\n\`\`\`json\n${JSON.stringify(contract)}\n\`\`\`\n<!-- morrowise:workbook:end -->\n`);return loadWorkbook(path.join(repo,'work.md'));};
  let workbook=saveWorkbook();
  const fixture={root,repo,sessionId,sourcePath,rows,save,human,meta,contract,git,saveWorkbook,get workbook(){return workbook;},reload(){workbook=saveWorkbook();return workbook;}};
  try {return await run(fixture);} finally {os.userInfo=originalUserInfo;if(originalSession===undefined)delete process.env.CODEX_THREAD_ID;else process.env.CODEX_THREAD_ID=originalSession;fs.rmSync(root,{recursive:true,force:true});}
}

export function contextInput(api,f,extra={}) {
  const source=api.inspectWorkbookHumanSource({sessionId:f.sessionId,messageId:'msg-grant',contentIndex:0});
  return {workbook:f.workbook,sessionId:f.sessionId,sources:[{session_id:source.session_id,message_id:source.message_id,content_index:source.content_index,message_sha256:source.message_sha256,approval_ref:'fixture-human-grant'}],decision:{work_id:`${f.contract.project_id}/${f.contract.task_id}`,home:f.workbook.home,contract_fingerprint:f.workbook.contract_fingerprint,allowed_actions:['implement','verify'],operations:[],repo_bindings:f.contract.repos.map(r=>({repo_id:r.repo_id,canonical_root:r.canonical_root,checkout_root:r.checkout_root})),source_watermarks:[{session_id:source.session_id,user_watermark:source.user_watermark}],reason:'Fixture supervisor reviewed the actual human text and exact workbook scope; no Git grant.',...extra}};
}

export async function runSessionContextCases() {
  await withHostFixture(async f=>{
    const api=await import('./lib/workbook-session-context.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
    assert.equal(typeof api.inspectWorkbookHumanSource,'function','native human source reader must be implemented');
    const source=api.inspectWorkbookHumanSource({sessionId:f.sessionId,messageId:'msg-grant',contentIndex:0});
    assert.equal(source.text,'Implement and verify the exact fixture workbook; do not commit.');
    for(const messageId of ['msg-agents','msg-tool'])assert.throws(()=>api.inspectWorkbookHumanSource({sessionId:f.sessionId,messageId,contentIndex:0}),/human_source/);
    assert.throws(()=>api.inspectWorkbookHumanSource({sessionId:f.sessionId,messageId:'msg-grant',contentIndex:1}),/human_source/);
    const context=api.createWorkbookSessionContext(contextInput(api,f));
    const resolvers=api.getWorkbookSessionResolvers(context,f.workbook);
    const request={work_id:`fixture/${f.contract.task_id}`,contract_fingerprint:f.workbook.contract_fingerprint,action:'implement'};
    assert.equal(resolvers.approvalResolver(request).work_id,request.work_id);
    for(const fake of [{approved:true},JSON.parse(JSON.stringify(context)),Object.assign({},context)])assert.throws(()=>api.getWorkbookSessionResolvers(fake,f.workbook),/untrusted_session_context/);
    assert.equal(resolvers.approvalResolver({...request,action:'commit'}),null,'implementation grant cannot authorize commit');
    assert.equal(resolvers.approvalResolver({...request,work_id:'fixture/other'}),null);
    assert.equal(resolvers.approvalResolver({...request,contract_fingerprint:'0'.repeat(64)}),null);
    assert.throws(()=>api.createWorkbookSessionContext({...contextInput(api,f),sessionId:crypto.randomUUID()}),/host_session_mismatch/);
    const forged=contextInput(api,f);forged.sources[0].message_sha256='0'.repeat(64);assert.throws(()=>api.createWorkbookSessionContext(forged),/human_source_digest_changed/);
    const extraScope=contextInput(api,f);extraScope.decision.repo_bindings[0].canonical_root='/not-the-approved-repo';assert.throws(()=>api.createWorkbookSessionContext(extraScope),/reviewed_repo_binding_mismatch/);
    f.rows.push(f.human('msg-runtime','tool append is not a user turn','environments.environment_context'));f.save();
    assert.ok(resolvers.approvalResolver(request),'non-human context append does not expire a grant');
    f.rows.push(f.human('msg-stop','Stop this work.'));f.save();
    assert.throws(()=>resolvers.approvalResolver(request),/human_source_watermark_changed/);
    f.rows.pop();f.save();
    const oldText=f.rows[1].payload.content[0].text;f.rows[1].payload.content[0].text='tampered';f.save();
    assert.throws(()=>resolvers.approvalResolver(request),/human_source/);f.rows[1].payload.content[0].text=oldText;f.save();
    const prior=f.meta.payload.thread_source;f.meta.payload.thread_source='subagent';f.save();
    assert.throws(()=>api.inspectWorkbookHumanSource({sessionId:f.sessionId,messageId:'msg-grant',contentIndex:0}),/human_source_not_root_user_session/);f.meta.payload.thread_source=prior;f.save();
    f.rows[1].payload.content[0].text='Commit only the exact reviewed operation.';f.save();
    const operation={repo_id:'fixture',message:'test: explicit operation',scope_paths:['a.txt'],base_sha:f.git('rev-parse','HEAD')};
    const explicit=api.createWorkbookSessionContext(contextInput(api,f,{allowed_actions:['commit'],operations:[{action:'commit',operation_fingerprint:digest(operation)}],reason:'Fixture supervisor reviewed a separate exact operation commit grant.'}));
    const approval=api.getWorkbookSessionResolvers(explicit,f.workbook).approvalResolver;
    assert.ok(approval({...request,action:'commit',operation,operation_fingerprint:digest(operation)}));
    assert.equal(approval({...request,action:'commit',operation:{...operation,message:'different'},operation_fingerprint:digest({...operation,message:'different'})}),null);
    const sourceSession=crypto.randomUUID(),sourcePath=path.join(path.dirname(f.sourcePath),`rollout-2026-09-08T00-00-00-${sourceSession}.jsonl`);
    fs.writeFileSync(sourcePath,[{type:'session_meta',payload:{...f.meta.payload,id:sourceSession}},f.human('msg-original','Implement and verify this exact work in the next human session.')].map(r=>JSON.stringify(r)).join('\n')+'\n');
    const priorSource=api.inspectWorkbookHumanSource({sessionId:sourceSession,messageId:'msg-original'}),resumeInput=contextInput(api,f);
    resumeInput.sources=[{session_id:sourceSession,message_id:priorSource.message_id,content_index:0,message_sha256:priorSource.message_sha256,approval_ref:'fixture-human-grant'}];resumeInput.decision.source_watermarks=[{session_id:sourceSession,user_watermark:priorSource.user_watermark}];
    const resumed=api.getWorkbookSessionResolvers(api.createWorkbookSessionContext(resumeInput),f.workbook).approvalResolver;
    f.rows.push(f.human('msg-b-context','Runtime append','environments.environment_context'));f.save();assert.ok(resumed(request),'current session tool/context append is not revocation');
    f.rows.push(f.human('msg-b-stop','Stop resumed work now.'));f.save();assert.throws(()=>resumed(request),/human_source_watermark_changed/,'current host stop revokes even when authorization comes from another root user session');f.rows.pop();f.save();
    f.contract.contract_revision++;const changed=f.reload();assert.throws(()=>api.getWorkbookSessionResolvers(explicit,changed),/session_contract_changed/);
    console.log('PASS session source: real reader shape, human-only provenance, brand, scope/action/operation, watermark and contract revocation');
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--isolated')await runSessionContextCases();
  else {const r=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--isolated'],{encoding:'utf8'});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status??1;}
}
