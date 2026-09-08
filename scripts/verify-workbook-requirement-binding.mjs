import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as api from './lib/workbook-anchor.mjs';
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mw-requirements-')));
try {
  const run=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  run('init','-q');run('config','user.name','Fixture');run('config','user.email','fixture@example.invalid');
  fs.writeFileSync(path.join(root,'input.txt'),'ok');
  fs.writeFileSync(path.join(root,'verify.mjs'),"import fs from 'node:fs';if(fs.readFileSync('input.txt','utf8')!=='ok')process.exit(1);\n");
  run('add','.');run('commit','-qm','fixture');
  const row='| A1／P2 | actual input must be ok | independently verify input |';
  const requirements=`<!-- morrowise:requirements:start -->\n${row}\n<!-- morrowise:requirements:end -->\n`;
  const fileHash=p=>api.digest(fs.readFileSync(p));
  const c={schema_version:1,contract_revision:1,project_id:'fixture',task_id:'work-9510dad5-490b-4b7c-9a90-32e9f7f33aec',title:'requirement fixture',order_label:null,
    home:{repo_id:'fixture',path:'work.md'},repos:[{repo_id:'fixture',canonical_root:root,checkout_root:root,write_paths:['input.txt']}],baseline_refs:[{ref:'fixture/HEAD',digest:run('rev-parse','HEAD')}],canonical_baseline:null,done_condition:'original A1',
    acceptance:[{id:'A1',repo_id:'fixture',command:process.execPath,args:['verify.mjs'],executable_sha256:fileHash(process.execPath),entrypoint:'verify.mjs',entrypoint_sha256:fileHash(path.join(root,'verify.mjs')),source_paths:['input.txt','verify.mjs'],artifact_paths:['input.txt'],requirement_fingerprint:api.digest(row)}],
    dependencies:[],budget:{max_wall_time_ms:10000,max_attempts:1},allowed_actions:['implement','verify'],approval_refs:['user-message:fixture'],stop_resume:'retain source',formal_target:'fixture',
    requirement_baseline:{repo_id:'fixture',path:'work.md',sha256:api.digest(row+'\n'),ids:['A1']}};
  const md=c=>`<!-- morrowise:workbook:start -->\n\`\`\`json\n${JSON.stringify(c)}\n\`\`\`\n<!-- morrowise:workbook:end -->\n${requirements}`;
  const write=c=>fs.writeFileSync(path.join(root,'work.md'),md(c));write(c);
  assert.doesNotThrow(()=>api.loadWorkbook(path.join(root,'work.md')),'valid original requirement binding must load');
  let w=api.loadWorkbook(path.join(root,'work.md'));
  const context={canonicalResolver:ref=>({task_ref:ref,exists:false}),approvalResolver:req=>({source_ref:'user-message:fixture',work_id:req.work_id,contract_fingerprint:req.contract_fingerprint,allowed_actions:['implement','verify'],revoked:false})};
  const good=api.runWorkbookAcceptance({workbook:w,...context});assert.equal(good.decision,'allow');assert.equal(api.validateAcceptanceEvidence(w,good.receipt).decision,'allow');
  for(const mutate of [x=>x.acceptance=[],x=>x.acceptance.push({...x.acceptance[0],id:'A2'}),x=>x.requirement_baseline.ids.push('A1'),x=>x.acceptance[0].requirement_fingerprint='0'.repeat(64)]){
    const bad=structuredClone(c);mutate(bad);write(bad);assert.throws(()=>api.loadWorkbook(path.join(root,'work.md')));
  }
  write(c);w=api.loadWorkbook(path.join(root,'work.md'));
  fs.appendFileSync(path.join(root,'work.md'),'progress only\n');assert.doesNotThrow(()=>api.loadWorkbook(path.join(root,'work.md')));
  fs.writeFileSync(path.join(root,'work.md'),md(c).replace('actual input must be ok','weaker requirement'));
  assert.throws(()=>api.loadWorkbook(path.join(root,'work.md')),/requirement/);
  assert.notEqual(api.runWorkbookAcceptance({workbook:w,...context}).decision,'allow','cached workbook must not bypass changed original');
  assert.notEqual(api.validateAcceptanceEvidence(w,good.receipt).decision,'allow');
  write(c);fs.appendFileSync(path.join(root,'work.md'),requirements);assert.throws(()=>api.loadWorkbook(path.join(root,'work.md')),/requirement/);
  const pending=structuredClone(c);pending.acceptance[0].pending_reason='real human session observation unavailable';write(pending);
  w=api.loadWorkbook(path.join(root,'work.md'));const result=api.runWorkbookAcceptance({workbook:w,...context});
  assert.equal(result.decision,'blocked');assert.equal(result.reason,'requirements_not_ready');assert.deepEqual(result.results.map(x=>[x.id,x.status]),[['A1','not_run']]);
  assert.notEqual(api.validateAcceptanceEvidence(w,{...good.receipt,contract_fingerprint:w.contract_fingerprint}).decision,'allow','copying local fixture receipt cannot fulfill pending live requirement');
  const invalid=structuredClone(pending);invalid.acceptance[0].pending_reason='';write(invalid);assert.throws(()=>api.loadWorkbook(path.join(root,'work.md')));
  // A different source file must also be version-bound, protected from symlinks,
  // and included in run-time evidence rather than trusted only at initial load.
  const external=structuredClone(c);external.requirement_baseline.path='requirements.md';
  fs.writeFileSync(path.join(root,'requirements.md'),requirements);write(external);
  w=api.loadWorkbook(path.join(root,'work.md'));assert.ok(api.workbookSource(w).fixture.files['requirements.md']);
  fs.unlinkSync(path.join(root,'requirements.md'));fs.symlinkSync('work.md',path.join(root,'requirements.md'));assert.throws(()=>api.loadWorkbook(path.join(root,'work.md')),/symlink/);
  console.log('PASS original requirement binding: valid source, exact IDs, drift, duplicate markers, pending live rejection, copied receipt rejection, external source and symlink');
} finally {fs.rmSync(root,{recursive:true,force:true});}
