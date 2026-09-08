#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modulePath=path.join(root,'scripts/lib/morrowise-documentation-impact.mjs');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const args=process.argv.slice(2);
if(args.some(a=>!['--self-test','--json'].includes(a))||new Set(args).size!==args.length)throw Error('invalid_impact_arguments');
if(args.includes('--self-test')){
 const api=fs.existsSync(modulePath)?await import(modulePath):{};
 assert.equal(typeof api.evaluateDocumentationImpact,'function','missing capability-to-document impact gate');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'docs-impact-'));
 const source='$COLLAB/system/rule.md',guide='$COLLAB/docs/guide.md';
 fs.mkdirSync(path.join(temp,'system'));fs.mkdirSync(path.join(temp,'docs'));
 const body='# 操作\n\n文件版本：**v0.3.0**\n\n## 版本歷史\n\n### v0.3.0 — 2026-09-08｜初版\n';
 const wrap=x=>'<!-- chapter:start entry -->\n'+x+'<!-- chapter:end entry -->\n';
 fs.writeFileSync(path.join(temp,'system/rule.md'),'old rule');fs.writeFileSync(path.join(temp,'docs/guide.md'),wrap(body));
 const record={id:'guide-entry',chapter_id:'entry',human_content_ref:guide};
 const registry={scope_version:'manual-local-v2',records:[record],capability_mappings:[{id:'entry',source_refs:[{path:source,fingerprint:hash('old rule')}],document_fingerprints:{'guide-entry':hash(body)}}],impact_reviews:[]};
 let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
 const run=r=>api.evaluateDocumentationImpact({registry:r||registry,collabRoot:temp});
 try{
 test('unchanged registered source has no impact',()=>assert.equal(run().decision,'allow'));
 fs.writeFileSync(path.join(temp,'system/rule.md'),'new behavior');
 test('capability changed while guide and schema remain unchanged is blocked',()=>assert.match(run().findings.join(' '),/review_missing/));
 const review={mapping_id:'entry',source_fingerprints:{[source]:hash('new behavior')},document_fingerprints:{'guide-entry':hash(body)},decision:'no_impact',reason:'Internal implementation changed, the documented contract is unchanged.',evidence_refs:['$COLLAB/tasks/test#review'],author:'author',reviewer:'independent',reviewed_at:'2026-09-08'};
 const withReview=()=>({...registry,impact_reviews:[structuredClone(review)]});
 test('documented independently reviewed no-impact is accepted',()=>assert.equal(run(withReview()).decision,'allow'));
 test('empty no-impact reason is rejected',()=>{const r=withReview();r.impact_reviews[0].reason='';assert.equal(run(r).decision,'blocked');});
 test('self-review is rejected',()=>{const r=withReview();r.impact_reviews[0].reviewer='author';assert.equal(run(r).decision,'blocked');});
 test('stale source review is rejected',()=>{const r=withReview();r.impact_reviews[0].source_fingerprints[source]=hash('old rule');assert.equal(run(r).decision,'blocked');});
 test('updated claim without changed corresponding chapter is rejected',()=>{const r=withReview();r.impact_reviews[0].decision='update_required';assert.match(run(r).findings.join(' '),/document_not_updated/);});
 test('unknown document mapping is rejected',()=>{const r=structuredClone(registry);r.capability_mappings[0].document_fingerprints={'unknown':hash(body)};assert.equal(run(r).decision,'blocked');});
 test('duplicate mapping is rejected',()=>{const r=structuredClone(registry);r.capability_mappings.push(r.capability_mappings[0]);assert.equal(run(r).decision,'blocked');});
 test('missing source is fail closed',()=>{const r=structuredClone(registry);r.capability_mappings[0].source_refs[0].path='$COLLAB/system/missing.md';assert.equal(run(r).decision,'blocked');});
 const newer=body+'\nUpdated instructions.\n';fs.writeFileSync(path.join(temp,'docs/guide.md'),wrap(newer));
 test('changed source plus corresponding revised guide passes',()=>{const r=withReview();r.impact_reviews[0].decision='update_required';r.impact_reviews[0].document_fingerprints['guide-entry']=hash(newer);assert.equal(run(r).decision,'allow');});
 test('outdated chapter review is rejected',()=>assert.equal(run(withReview()).decision,'blocked'));
 test('unsafe source reference is rejected without reading it',()=>{const r=structuredClone(registry);r.capability_mappings[0].source_refs[0].path='$COLLAB/.env';assert.equal(run(r).decision,'blocked');});
 test('removing the mappings cannot disable the gate',()=>assert.equal(run({...registry,capability_mappings:[]}).decision,'blocked'));
 fs.writeFileSync(path.join(temp,'docs/guide.md'),wrap(body));
 test('an unknown capability is rejected',()=>{const r=structuredClone(registry);r.capability_mappings[0].id='unknown';assert.match(run(r).findings.join(' '),/unknown_capability/);});
 test('unmapped documents are rejected',()=>{const r=structuredClone(registry);r.records.push({...record,id:'unmapped'});assert.equal(run(r).decision,'blocked');});
 test('duplicate review is rejected',()=>{const r=withReview();r.impact_reviews.push(r.impact_reviews[0]);assert.equal(run(r).decision,'blocked');});
 test('extra review fingerprints are rejected',()=>{const r=withReview();r.impact_reviews[0].source_fingerprints['$COLLAB/extra.md']=hash('extra');assert.equal(run(r).decision,'blocked');});
 fs.symlinkSync(path.join(temp,'system/rule.md'),path.join(temp,'system/link.md'));
 test('symlink source is rejected',()=>{const r=structuredClone(registry);r.capability_mappings[0].source_refs[0].path='$COLLAB/system/link.md';assert.equal(run(r).decision,'blocked');});
 test('refreshing the mapping baseline cannot erase a committed source change',()=>{
   const r=structuredClone(registry);r.capability_mappings[0].source_refs[0].fingerprint=hash('new behavior');
   assert.match(api.evaluateDocumentationImpact({registry:r,baselineRegistry:registry,collabRoot:temp}).findings.join(' '),/review_missing/);
 });
 fs.writeFileSync(path.join(temp,'docs/guide.md'),wrap(newer));
 const committedB=withReview();committedB.impact_reviews[0].decision='update_required';committedB.impact_reviews[0].document_fingerprints['guide-entry']=hash(newer);
 test('first independently reviewed update forms an accepted baseline',()=>assert.equal(run(committedB).decision,'allow'));
 fs.writeFileSync(path.join(temp,'system/rule.md'),'third behavior');
 const candidateC=structuredClone(committedB);candidateC.impact_reviews[0].source_fingerprints[source]=hash('third behavior');
 const afterB=r=>api.evaluateDocumentationImpact({registry:r,baselineRegistry:committedB,collabRoot:temp});
 test('second update cannot reuse the previous approved chapter and claim updated',()=>assert.match(afterB(candidateC).findings.join(' '),/document_not_updated/));
 test('second update can legitimately have independent no-impact evidence',()=>{const r=structuredClone(candidateC);r.impact_reviews[0].decision='no_impact';assert.equal(afterB(r).decision,'allow');});
 test('second update with newly revised corresponding chapter is accepted',()=>{const newest=newer+'Third instructions.\n';fs.writeFileSync(path.join(temp,'docs/guide.md'),wrap(newest));const r=structuredClone(candidateC);r.impact_reviews[0].document_fingerprints['guide-entry']=hash(newest);assert.equal(afterB(r).decision,'allow');fs.writeFileSync(path.join(temp,'docs/guide.md'),wrap(newer));});
 test('returning capability to initial behavior does not bypass a later approved baseline',()=>{fs.writeFileSync(path.join(temp,'system/rule.md'),'old rule');const r=structuredClone(candidateC);r.impact_reviews[0].source_fingerprints[source]=hash('old rule');assert.match(afterB(r).findings.join(' '),/document_not_updated/);});
 console.log(`Documentation impact tests: ${count}/${count}`);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}else{
 const {evaluateDocumentationImpact}=await import(modulePath);
 const registry=JSON.parse(fs.readFileSync(path.join(root,'system-workflow/registries/morrowise-document-sources.json'),'utf8'));
 const result=evaluateDocumentationImpact({registry,collabRoot:path.resolve(root,'..'),inspectGit:true});
 console.log(JSON.stringify(result,null,args.includes('--json')?0:2));process.exitCode=result.decision==='allow'?0:2;
}
