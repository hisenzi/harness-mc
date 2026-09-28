import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { executePlan, executeApply, computeSha256, parseMarker } from './lib/release-tracking.mjs';

const A='a'.repeat(40), B='b'.repeat(40), repo='owner/project';
const tag='v0.0.0-issue2-test-delivery';
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rt-live-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const activation={schema_version:1,status:'authorized',repo,target:{kind:'issue',repo,number:2},allowed_tags:[{tag,commit_shas:[A,B]}],allowed_write_types:['issue_comment','tag_repoint_notice'],operator:'test',authorization:{source:'fixture test authorization',approved_at:'2026-09-27T00:00:00Z'},workflow:{path:'.github/workflows/release-tracking.yml',disable_command:'fixture-only'}};
  const activationPath=path.join(root,'activation.json');fs.writeFileSync(activationPath,JSON.stringify(activation));
  let sequence=0;
  const makePlan=(sha=A,targetNumber=2)=>{
    const input=path.join(root,`input-${++sequence}`);fs.mkdirSync(input);
    const event={schema_version:1,event_type:'tag_push',repo,tag,ref:`refs/tags/${tag}`,commit_sha:sha,observed_at:'2026-09-27T00:00:00Z',fixture:true,routing:{mode:'existing',target:{kind:'issue',repo,number:targetNumber}}};
    const contract=JSON.stringify({required_cases:['F-PASS-01'],cases:[{id:'F-PASS-01'}]});
    const log=execFileSync(process.execPath,['-e',"console.log('fixture-ok')"]);fs.writeFileSync(path.join(input,'test.log'),log);
    const result={schema_version:1,contract_sha256:computeSha256(contract),source_commit:sha,environment:{fixture:true},cases:[{id:'F-PASS-01',status:'PASS',command:['node','-e',"console.log('fixture-ok')"],exit_code:0,started_at:'2026-09-27T00:00:00Z',duration_ms:1,evidence:[{path:'test.log',sha256:computeSha256(log)}]}],ci:{kind:'github_actions',url:'https://github.com/owner/project/actions/runs/1'}};
    fs.writeFileSync(path.join(input,'event.json'),JSON.stringify(event));fs.writeFileSync(path.join(input,'contract.json'),contract);fs.writeFileSync(path.join(input,'result.json'),JSON.stringify(result));
    const out=path.join(root,`plan-${sequence}`);
    executePlan({eventPath:path.join(input,'event.json'),contractPath:path.join(input,'contract.json'),resultPath:path.join(input,'result.json'),evidenceRoot:input,outDir:out});
    return path.join(out,'plan.json');
  };
  const comments=[], calls=[];
  const api={rejectWrite:false,loseWriteResponse:false,alterReadback:false,wrongTarget:false};
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});const u=new URL(url),method=options.method||'GET';
    assert.equal(u.origin,'https://api.github.com');
    if(method==='POST'){
      if(api.rejectWrite)return new Response(JSON.stringify({message:'Resource not accessible by integration'}),{status:403});
      const c={id:comments.length+1,body:JSON.parse(options.body).body,url:`https://api.github.com/repos/${repo}/issues/comments/${comments.length+1}`,issue_url:`https://api.github.com/repos/${repo}/issues/2`};comments.push(c);
      if(api.loseWriteResponse){api.loseWriteResponse=false;throw new Error('socket disconnected after commit');}
      return Response.json(c,{status:201});
    }
    if(u.pathname===`/repos/${repo}/issues/2/comments`)return Response.json(comments);
    const id=Number(u.pathname.split('/').at(-1));const item=comments.find(c=>c.id===id);
    if(item){const copy={...item};if(api.alterReadback)copy.body+=' changed';if(api.wrongTarget)copy.issue_url=`https://api.github.com/repos/${repo}/issues/99`;return Response.json(copy);}
    return Response.json({message:'not found'},{status:404});
  };
  const apply=(planPath,extra={})=>executeApply({planPath,mode:'live',apiBase:'https://api.github.com',activationPath,stateDir:path.join(root,`state-${++sequence}`),outDir:path.join(root,`out-${sequence}`),env:{GITHUB_TOKEN:'fixture-secret-token'},fetchImpl,...extra});
  return {root,activation,activationPath,makePlan,apply,comments,calls,api,fetchImpl};
}

test('live delivery and fresh-state replay use exact remote content and never leak the token',async t=>{
  const f=fixture(t),plan=f.makePlan();
  assert.equal((await f.apply(plan)).status,'DELIVERED');
  assert.equal((await f.apply(plan)).status,'ALREADY_DELIVERED');
  assert.equal(f.comments.length,1);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
  assert.match(f.comments[0].body,/fixture/);
  for(const c of f.calls){assert.equal(c.options.headers.Authorization,'Bearer fixture-secret-token');assert.equal(c.options.redirect,'manual');}
  for(const d of fs.readdirSync(f.root).filter(s=>s.startsWith('out-')))assert.ok(!fs.readFileSync(path.join(f.root,d,'requests.json'),'utf8').includes('fixture-secret-token'));
});

test('same marker with modified remote body is a conflict on replay',async t=>{
  const f=fixture(t),plan=f.makePlan();await f.apply(plan);f.comments[0].body+=' edited';
  await assert.rejects(f.apply(plan),e=>e.exitCode===3&&e.status==='CONFLICT');assert.equal(f.comments.length,1);
});

test('first delivery readback checks body as well as marker',async t=>{
  const f=fixture(t);f.api.alterReadback=true;
  await assert.rejects(f.apply(f.makePlan()),e=>e.exitCode===3);assert.equal(f.comments.length,1);
  const out=fs.readdirSync(f.root).find(d=>d.startsWith('out-'));
  assert.ok(fs.readFileSync(path.join(f.root,out,'remote-after.json'),'utf8').includes(' changed'), 'failed readback must preserve the actual remote body');
});

test('readback verifies the actual remote Issue target',async t=>{
  const f=fixture(t);f.api.wrongTarget=true;
  await assert.rejects(f.apply(f.makePlan()),e=>e.exitCode===3);
});

test('fresh-state tag repoint preserves original bytes and reads back exactly one warning',async t=>{
  const f=fixture(t);await f.apply(f.makePlan());const original=f.comments[0].body,planB=f.makePlan(B);
  for(let n=0;n<2;n++)await assert.rejects(f.apply(planB),e=>e.exitCode===3&&e.status==='REVIEW_REQUIRED');
  assert.equal(f.comments.length,2);assert.equal(f.comments[0].body,original);assert.equal(parseMarker(original).commit_sha,A);assert.match(f.comments[1].body,new RegExp(`${A}.*${B}`));
  assert.ok(f.calls.some(c=>c.url.endsWith('/issues/comments/2')&&!c.options.method));
});

test('permission refusal cannot become a successful repoint notice',async t=>{
  const f=fixture(t);await f.apply(f.makePlan());f.api.rejectWrite=true;
  await assert.rejects(f.apply(f.makePlan(B)),e=>e.exitCode===3&&e.status==='BLOCKED');assert.equal(f.comments.length,1);
});

test('uncertain POST reconciles once, then reads and validates the remote item',async t=>{
  const f=fixture(t);f.api.loseWriteResponse=true;
  assert.equal((await f.apply(f.makePlan())).status,'DELIVERED');assert.equal(f.comments.length,1);
  const writeIndex=f.calls.findIndex(c=>c.options.method==='POST');assert.equal(f.calls.length-writeIndex-1,2);
});

test('activation rejects a changed target before any HTTP call',async t=>{
  const f=fixture(t);await assert.rejects(f.apply(f.makePlan(A,99)),e=>e.exitCode===3);assert.equal(f.calls.length,0);
});

test('activation rejects an unapproved commit before HTTP',async t=>{
  const f=fixture(t);await assert.rejects(f.apply(f.makePlan('c'.repeat(40))),e=>e.exitCode===3);assert.equal(f.calls.length,0);
});

test('missing token and unknown transport fail without HTTP',async t=>{
  const f=fixture(t),plan=f.makePlan();await assert.rejects(f.apply(plan,{env:{}}),e=>e.exitCode===3);
  await assert.rejects(f.apply(plan,{mode:'typo'}),e=>e.exitCode===2);assert.equal(f.calls.length,0);
});

test('fixture transport never accepts GitHub even with live activation',async t=>{
  const f=fixture(t);await assert.rejects(f.apply(f.makePlan(),{mode:'fixture'}),e=>e.exitCode===2);assert.equal(f.calls.length,0);
});
