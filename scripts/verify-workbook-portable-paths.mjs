import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {withHostFixture} from './verify-workbook-session-context.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
const expectedFingerprint=contract=>{const copy=structuredClone(contract);delete copy.order_label;return sha(JSON.stringify(sorted(copy)));};
const modules=['scripts/lib/workbook-anchor.mjs','scripts/lib/workbook-session-context.mjs','scripts/lib/workbook-preflight-adapter.mjs','scripts/lib/workbook-coordination.mjs','scripts/lib/milestone-projects.mjs','scripts/work-anchor-preflight.mjs','lib/taskOrdering.mjs'];

async function cases() {
  await withHostFixture(async f=>{
    // Copy the actual module closure into a disposable $COLLAB-shaped host.
    // Only the isolated child mocks OS userInfo for its native source fixture;
    // production resolution has no injected COLLAB root or trusted test reader.
    const h=path.join(f.root,'harness-mc'),sourceHashes={};
    for(const relative of modules) {
      const bytes=fs.readFileSync(path.join(root,relative)),to=path.join(h,relative);
      fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,bytes);sourceHashes[relative]=sha(bytes);
    }
    const api=await import(pathToFileURL(path.join(h,'scripts/lib/workbook-anchor.mjs')).href);
    assert.equal(typeof api.getResolvedRepo,'function','portable repo resolver must exist');
    assert.equal(typeof api.getResolvedRepos,'function','portable repo list resolver must exist');
    assert.equal(typeof api.resolveWorkbookLocation,'function','named portable home resolver must exist');
    const home=path.join(f.repo,'work.md'),portableHome='$COLLAB/repo/work.md';
    const write=contract=>fs.writeFileSync(home,'<!-- morrowise:workbook:start -->\n```json\n'+JSON.stringify(contract)+'\n```\n<!-- morrowise:workbook:end -->\n');
    const absolute=structuredClone(f.contract),absoluteFingerprint=expectedFingerprint(absolute);
    assert.equal(api.contractFingerprint(absolute),absoluteFingerprint);
    write(absolute);const legacy=api.loadWorkbook(home);
    assert.deepEqual(legacy.contract,absolute);assert.equal(legacy.contract_fingerprint,absoluteFingerprint);
    assert.deepEqual(api.getResolvedRepo(legacy,'fixture'),absolute.repos[0]);
    assert.equal(api.contractFingerprint(legacy.contract),absoluteFingerprint,'legacy absolute fingerprint survives resolution');
    const contract=structuredClone(absolute);contract.repos[0].canonical_root='$COLLAB/repo';contract.repos[0].checkout_root='$COLLAB/repo';
    const raw=JSON.stringify(contract),fingerprint=expectedFingerprint(contract);write(contract);
    const workbook=api.loadWorkbook(portableHome);
    assert.equal(workbook.home,home);assert.equal(workbook.contract_fingerprint,fingerprint);assert.equal(JSON.stringify(workbook.contract),raw,'raw portable contract must not be rewritten');
    assert.equal(Object.hasOwn(workbook,'resolved_repos'),false,'resolved views must not become another source');
    assert.equal(api.resolveWorkbookLocation(portableHome),home);
    const resolved=api.getResolvedRepo(workbook,'fixture');assert.equal(resolved.canonical_root,f.repo);assert.equal(resolved.checkout_root,f.repo);
    assert.deepEqual(api.getResolvedRepos(workbook),[resolved]);assert.throws(()=>api.getResolvedRepo(workbook,'other'),/repo_not_in_contract/);
    resolved.canonical_root='/not-a-real-approved-repo';assert.equal(api.getResolvedRepo(workbook,'fixture').canonical_root,f.repo,'mutable IO view cannot change later resolution');
    assert.equal(api.contractFingerprint(workbook.contract),fingerprint);
    const previousCollab=process.env.COLLAB;process.env.COLLAB=path.join(f.root,'untrusted-env');
    assert.equal(api.resolveWorkbookLocation(portableHome),home,'environment variable must not select the collaboration root');
    if(previousCollab===undefined)delete process.env.COLLAB;else process.env.COLLAB=previousCollab;
    const wrongHome=path.join(f.repo,'duplicate.md');fs.copyFileSync(home,wrongHome);assert.throws(()=>api.loadWorkbook(wrongHome),/workbook_home_mismatch/);fs.unlinkSync(wrongHome);
    for(const bad of ['$COLLAB/../outside','$COLLAB/','$COLLAB/repo/..','$COLLAB/repo//nested','$COLLAB/repo\\nested','$HOME/repo','$UNKNOWN/repo']) {
      const changed=structuredClone(contract);changed.repos[0].canonical_root=bad;write(changed);
      assert.throws(()=>api.loadWorkbook(home),undefined,'reject invalid repo reference: '+bad);
      assert.throws(()=>api.resolveWorkbookLocation(bad),undefined,'reject invalid named location: '+bad);
    }
    for(const [name,target] of [['dangling','does-not-exist'],['symlink-repo','repo']]) {
      const link=path.join(f.root,name);fs.symlinkSync(path.join(f.root,target),link);
      const changed=structuredClone(contract);changed.repos[0].canonical_root='$COLLAB/'+name;write(changed);
      assert.throws(()=>api.loadWorkbook(home),/symlink|ENOENT/,'never follow portable root links');
      assert.throws(()=>api.resolveWorkbookLocation('$COLLAB/'+name+'/work.md'),/symlink|ENOENT/);fs.unlinkSync(link);
    }
    const relativeCommand=structuredClone(contract);relativeCommand.acceptance[0].command='$COLLAB/node';write(relativeCommand);assert.throws(()=>api.loadWorkbook(home),/verifier_invalid/,'verifier executable remains absolute');
    write(contract);
    const dir=path.join(h,'milestones','fixture');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify({name:'Fixture'}));
    const tasks=JSON.stringify({project:'fixture',tasks:[]}),tasksPath=path.join(dir,'tasks.json');fs.writeFileSync(tasksPath,tasks);
    const topology=path.join(h,'system-workflow','registries','morrowise-project-topology.json');fs.mkdirSync(path.dirname(topology),{recursive:true});
    fs.writeFileSync(topology,JSON.stringify({migration_state_vocabulary:['inventory_only','blocked'],records:[{id:'fixture',classification:'canonical_project',migration_state:'inventory_only',repo_ref:'$COLLAB/repo'}]}));
    process.env.HARNESS_MC_ROOT=h;
    const session=await import(pathToFileURL(path.join(h,'scripts/lib/workbook-session-context.mjs')).href);
    const {getWorkbookRuntimeContext}=await import(pathToFileURL(path.join(h,'scripts/lib/workbook-preflight-adapter.mjs')).href);
    const {acquireWorkbookClaim,inspectWorkbookClaims}=await import(pathToFileURL(path.join(h,'scripts/lib/workbook-coordination.mjs')).href);
    const {runPreflight}=await import(pathToFileURL(path.join(h,'scripts/work-anchor-preflight.mjs')).href);
    const human=session.inspectWorkbookHumanSource({sessionId:f.sessionId,messageId:'msg-grant',contentIndex:0});
    const input={workbook,sessionId:f.sessionId,sources:[{session_id:human.session_id,message_id:human.message_id,content_index:human.content_index,message_sha256:human.message_sha256,approval_ref:'fixture-human-grant'}],decision:{work_id:api.workId(contract),home,contract_fingerprint:fingerprint,allowed_actions:['implement','verify'],operations:[],repo_bindings:api.getResolvedRepos(workbook).map(({repo_id,canonical_root,checkout_root})=>({repo_id,canonical_root,checkout_root})),source_watermarks:[{session_id:human.session_id,user_watermark:human.user_watermark}],reason:'Fixture human supervisor reviewed original source and exact portable contract, including actual registered checkout binding; no Git grant.'}};
    const wrongBinding=structuredClone(input);wrongBinding.decision.repo_bindings[0].canonical_root='$COLLAB/repo';assert.throws(()=>session.createWorkbookSessionContext(wrongBinding),/reviewed_repo_binding_mismatch/,'human review binds the actual local repo separately from raw contract');
    const context=session.createWorkbookSessionContext(input),args={workbook:portableHome,event:'implementation',project:'fixture'};
    const allowed=runPreflight(args,context);assert.equal(allowed.decision,'allow',JSON.stringify(allowed));assert.equal(allowed.workbook,home);assert.equal(allowed.contract_fingerprint,fingerprint);
    assert.equal(runPreflight({...args,workbookPath:home},context).decision,'allow','equivalent absolute and portable selectors share one home');
    const originalCwd=process.cwd();let relativeHome,relativeAlias;
    try {
      process.chdir(f.repo);
      try {relativeHome=api.loadWorkbook('work.md').home;}catch(error){relativeHome='ERROR: '+error.message;}
      relativeAlias=runPreflight({...args,workbook:'work.md',workbookPath:home},context).decision;
    }finally{process.chdir(originalCwd);}
    assert.deepEqual([relativeHome,relativeAlias],[home,'allow'],'legacy relative file selectors and equivalent absolute aliases remain supported');
    const runtime=getWorkbookRuntimeContext(context,workbook);
    const claim=acquireWorkbookClaim({...runtime,workbook,repoId:'fixture',sessionId:f.sessionId,owner:'Portable Fixture'});assert.equal(claim.decision,'READY',JSON.stringify(claim));assert.equal(claim.claim.checkout_root,f.repo);assert.equal(claim.claim.contract_fingerprint,fingerprint);
    assert.equal(inspectWorkbookClaims({repoPath:f.repo}).filter(c=>c.state==='active').length,1);
    const verified=runPreflight({...args,event:'acceptance'},context);assert.equal(verified.decision,'allow',JSON.stringify(verified));assert.equal(verified.read_only,false);assert.equal(verified.acceptance_receipt.contract_fingerprint,fingerprint);assert.equal(verified.acceptance_receipt.results[0].status,'passed');
    assert.equal(verified.acceptance_receipt.source.fixture.head,f.git('rev-parse','HEAD'));assert.equal(verified.acceptance_receipt.results[0].artifacts['a.txt'].sha256,sha('base'));
    fs.writeFileSync(path.join(f.repo,'a.txt'),'bad');assert.equal(runPreflight({...args,event:'acceptance'},context).reason,'verifier_failed');fs.writeFileSync(path.join(f.repo,'a.txt'),'base');
    assert.equal(fs.readFileSync(tasksPath,'utf8'),tasks,'portable preflight and acceptance do not register central task');
    assert.equal(JSON.stringify(api.loadWorkbook(portableHome).contract),raw);assert.equal(api.loadWorkbook(home).contract_fingerprint,fingerprint);
    const approvalRequest={work_id:api.workId(contract),contract_fingerprint:fingerprint,action:'implement'};
    f.git('commit','--allow-empty','-qm','fixture normal HEAD advance');
    assert.ok(session.getWorkbookSessionResolvers(context,workbook).approvalResolver(approvalRequest),'normal commit must preserve the approved repository identity');
    const retired=path.join(f.root,'retired-repo');fs.renameSync(f.repo,retired);fs.cpSync(retired,f.repo,{recursive:true});
    // Another physical Git repo at the identical path can preserve HEAD, home,
    // raw contract, and claims. The old human review must still be revoked.
    assert.equal(f.git('rev-parse','--show-toplevel'),f.repo);
    const replaced=api.loadWorkbook(portableHome);assert.equal(replaced.contract_fingerprint,fingerprint);assert.equal(JSON.stringify(replaced.contract),raw);
    assert.throws(()=>session.getWorkbookSessionResolvers(context,replaced),/session_repo_identity_changed/,'same-path repository replacement must revoke the old branded context');
    for(const relative of modules)assert.equal(sha(fs.readFileSync(path.join(root,relative))),sourceHashes[relative],'candidate module changed during fixture: '+relative);
    console.log('PASS workbook portable paths: unchanged raw/legacy fingerprints, fixed host root, unique home, path/link rejection, native fixture source, registered binding, common-dir claim and public real acceptance');
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(process.argv[2]==='--isolated')await cases();
  else {const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--isolated'],{encoding:'utf8',timeout:60000});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;}
}
