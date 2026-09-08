import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
const shaFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const api = await import('./lib/workbook-anchor.mjs').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  return { parseWorkbook: () => { throw new Error('workbook_not_implemented'); } };
});
const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mw-workbook-')));
try {
  const run = (...args) => { const r=spawnSync('git',args,{cwd:fixture,encoding:'utf8'}); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
  run('init','-q'); run('config','user.name','Fixture'); run('config','user.email','fixture@example.invalid');
  fs.writeFileSync(path.join(fixture,'input.txt'),'one\n');
  fs.writeFileSync(path.join(fixture,'verify.mjs'),"import fs from 'node:fs'; if(fs.readFileSync('input.txt','utf8') !== 'one\\n') process.exit(1); console.log('verified');\n");
  run('add','.'); run('commit','-qm','fixture');
  const contract = {
    schema_version:1, contract_revision:1, project_id:'fixture', task_id:'work-9510dad5-490b-4b7c-9a90-32e9f7f33aec', title:'測試工作', order_label:null,
    home:{repo_id:'fixture',path:'work.md'}, repos:[{repo_id:'fixture',canonical_root:fixture,checkout_root:fixture,write_paths:['input.txt']}],
    baseline_refs:[{ref:'fixture/HEAD',digest:run('rev-parse','HEAD')}], canonical_baseline:null,
    done_condition:'輸入驗證通過', acceptance:[{id:'A1',repo_id:'fixture',command:process.execPath,args:['verify.mjs'],executable_sha256:shaFile(process.execPath),entrypoint:'verify.mjs',entrypoint_sha256:shaFile(path.join(fixture,'verify.mjs')),source_paths:['input.txt','verify.mjs'],artifact_paths:['input.txt']}],
    dependencies:[],budget:{max_wall_time_ms:30000,max_attempts:2},allowed_actions:['implement','verify'],approval_refs:['user-message:fixture'], stop_resume:'停止副作用，從原工作本接續',formal_target:'fixture'
  };
  const canonicalResolver=ref=>({task_ref:ref,exists:false});
  const md = c => `# 說明\n<!-- morrowise:workbook:start -->\n\`\`\`json\n${JSON.stringify(c,null,2)}\n\`\`\`\n<!-- morrowise:workbook:end -->\n進度\n`;
  const parsed=api.parseWorkbook(md(contract));
  assert.equal(parsed.contract.task_id,contract.task_id);
  assert.equal(api.parseWorkbook(md(contract)+'追加進度').contract_fingerprint,parsed.contract_fingerprint);
  assert.equal(api.contractFingerprint({...contract,order_label:'T-01'}),parsed.contract_fingerprint);
  for (const bad of ['ordinary markdown',md(contract)+md(contract),md(contract).replace('<!-- morrowise:workbook:end -->',''),md(contract).replace('"schema_version": 1','"schema_version": 1, "schema_version": 1')]) assert.throws(()=>api.parseWorkbook(bad));
  for (const mutate of [c=>c.repos[0].write_paths.push('../escape'),c=>c.acceptance.push(c.acceptance[0]),c=>c.approved=true,c=>c.schema_version=2,c=>c.canonical_baseline={required_ids:['MISSING'],task_ref:'fixture/existing',task_digest:'x'}]) {
    const bad=structuredClone(contract);mutate(bad);assert.throws(()=>api.parseWorkbook(md(bad)));
  }
  const resolver = req => ({source_ref:'user-message:fixture',work_id:req.work_id,contract_fingerprint:parsed.contract_fingerprint,allowed_actions:['implement','verify'],revoked:false});
  assert.equal(api.evaluateWorkbookGate({contract,event:'implement'}).decision,'requires_human_approval');
  assert.equal(api.evaluateWorkbookGate({contract,event:'implement'},{approvalResolver:resolver,canonicalResolver}).decision,'allow');
  assert.equal(api.evaluateWorkbookGate({contract,event:'implement'},{approvalResolver:resolver}).reason,'new_work_identity_unverified');
  assert.equal(api.evaluateWorkbookGate({contract,event:'implement'},{approvalResolver:resolver,canonicalResolver:ref=>({task_ref:ref,exists:true,status:'cancelled'})}).reason,'new_work_identity_unverified');
  assert.notEqual(api.evaluateWorkbookGate({contract,event:'commit'},{approvalResolver:resolver,canonicalResolver}).decision,'allow');
  const changed=structuredClone(contract);changed.budget.max_attempts++;
  assert.notEqual(api.evaluateWorkbookGate({contract:changed,event:'implement'},{approvalResolver:resolver,canonicalResolver}).decision,'allow');
  assert.notEqual(api.evaluateWorkbookGate({contract,event:'implement'},{approvalResolver:()=>({...resolver({work_id:'wrong'}),revoked:true})}).decision,'allow');
  const existing=structuredClone(contract),requirement={id:'A1',what:'真實要求',pass_condition:'不得減少必要成果'};
  existing.task_id='existing-task';existing.canonical_baseline={task_ref:'fixture/existing-task',task_digest:'canonical-version',acceptance:[requirement]};existing.acceptance[0].requirement_fingerprint=api.digest(requirement);
  const existingApproval=req=>({source_ref:'user-message:fixture',work_id:req.work_id,contract_fingerprint:api.contractFingerprint(existing),allowed_actions:['implement'],revoked:false});
  const canonical={task_ref:'fixture/existing-task',digest:'canonical-version',status:'todo',start_allowed:true,acceptance:[requirement]};
  assert.equal(api.evaluateWorkbookGate({contract:existing,event:'implement'},{approvalResolver:existingApproval,canonicalResolver:()=>canonical}).decision,'allow');
  for(const status of ['completed','deferred','cancelled','blocked'])assert.notEqual(api.evaluateWorkbookGate({contract:existing,event:'implement'},{approvalResolver:existingApproval,canonicalResolver:()=>({...canonical,status})}).decision,'allow');
  const weak=structuredClone(existing);weak.canonical_baseline.acceptance[0].pass_condition='永遠通過';weak.acceptance[0].requirement_fingerprint=api.digest(weak.canonical_baseline.acceptance[0]);
  assert.equal(api.evaluateWorkbookGate({contract:weak,event:'implement'},{approvalResolver:req=>({...existingApproval(req),contract_fingerprint:api.contractFingerprint(weak)}),canonicalResolver:()=>canonical}).reason,'canonical_acceptance_unverified');
  const workbookPath=path.join(fixture,'work.md');fs.writeFileSync(workbookPath,md(contract));
  const loaded=api.loadWorkbook(workbookPath);
  assert.equal(loaded.home,workbookPath);
  fs.writeFileSync(path.join(fixture,'copy.md'),md(contract)); assert.throws(()=>api.loadWorkbook(path.join(fixture,'copy.md')),/home/);
  const receipt=api.runWorkbookAcceptance({workbook:loaded,approvalResolver:resolver,canonicalResolver});
  assert.equal(receipt.decision,'allow',JSON.stringify(receipt));
  assert.equal(api.validateAcceptanceEvidence(loaded,receipt.receipt).decision,'allow');
  assert.notEqual(api.validateAcceptanceEvidence(loaded,{results:[{id:'A1',status:'pass'}]}).decision,'allow');
  const extra=structuredClone(receipt.receipt);extra.results.push(extra.results[0]);assert.notEqual(api.validateAcceptanceEvidence(loaded,extra).decision,'allow');
  fs.writeFileSync(path.join(fixture,'input.txt'),'changed\n');assert.notEqual(api.validateAcceptanceEvidence(loaded,receipt.receipt).decision,'allow');
  fs.writeFileSync(path.join(fixture,'verify.mjs'),'console.log("fake pass");\n');
  assert.equal(api.runWorkbookAcceptance({workbook:loaded,approvalResolver:resolver,canonicalResolver}).reason,'approved_verifier_changed');
  fs.writeFileSync(path.join(fixture,'verify.mjs'),"import fs from 'node:fs';fs.writeFileSync('report.json',JSON.stringify({ok:true}));\n");
  const outputContract=structuredClone(contract);outputContract.acceptance[0].entrypoint_sha256=shaFile(path.join(fixture,'verify.mjs'));outputContract.acceptance[0].artifact_paths=['report.json'];outputContract.repos[0].write_paths.push('report.json');
  const outputWorkbook={...api.parseWorkbook(md(outputContract)),home:workbookPath};
  const outputApproval=req=>({...resolver(req),contract_fingerprint:outputWorkbook.contract_fingerprint});
  const generated=api.runWorkbookAcceptance({workbook:outputWorkbook,approvalResolver:outputApproval,canonicalResolver});
  assert.equal(generated.decision,'allow',JSON.stringify(generated));assert.equal(api.validateAcceptanceEvidence(outputWorkbook,generated.receipt).decision,'allow');
  fs.writeFileSync(path.join(fixture,'verify.mjs'),"import fs from 'node:fs';fs.writeFileSync('input.txt','side effect');fs.writeFileSync('report.json','{}');\n");outputContract.acceptance[0].entrypoint_sha256=shaFile(path.join(fixture,'verify.mjs'));
  const mutator={...api.parseWorkbook(md(outputContract)),home:workbookPath};assert.equal(api.runWorkbookAcceptance({workbook:mutator,canonicalResolver,approvalResolver:req=>({...resolver(req),contract_fingerprint:mutator.contract_fingerprint})}).reason,'source_changed_during_verification');
  const python=spawnSync('python3',['-c','import sys; print(sys.executable)'],{encoding:'utf8'}).stdout.trim();
  const runner=path.join(fixture,'fixture-runner');
  fs.writeFileSync(runner,`#!${python}\nimport runpy,sys\nrunpy.run_path(sys.argv[1],run_name='__main__')\n`,{mode:0o755});
  fs.writeFileSync(path.join(fixture,'replace-runner.py'),"import os\nopen('report.json','w').write('{}')\nopen('next-runner','w').write('changed executable')\nos.replace('next-runner','fixture-runner')\n");
  const executableRace=structuredClone(outputContract);Object.assign(executableRace.acceptance[0],{command:runner,args:['replace-runner.py'],entrypoint:'replace-runner.py',entrypoint_sha256:shaFile(path.join(fixture,'replace-runner.py')),executable_sha256:shaFile(runner),source_paths:['input.txt','replace-runner.py']});
  const raceWorkbook={...api.parseWorkbook(md(executableRace)),home:workbookPath};
  assert.equal(api.runWorkbookAcceptance({workbook:raceWorkbook,canonicalResolver,approvalResolver:req=>({...resolver(req),contract_fingerprint:raceWorkbook.contract_fingerprint})}).reason,'verifier_executable_changed_during_run');
  console.log('PASS workbook contract, trusted approval boundary, unique home, exact evidence, source drift');
} finally { fs.rmSync(fixture,{recursive:true,force:true}); }
