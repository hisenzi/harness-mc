#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as source from './generate-morrowise-documentation.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const library=path.join(root,'scripts/lib/morrowise-public-release.mjs');
assert.ok(fs.existsSync(library),'public release implementation is missing');
const api=await import(library);
const registry=JSON.parse(fs.readFileSync(path.join(root,'system-workflow/registries/morrowise-document-sources.json'),'utf8'));
const body=fs.readFileSync(path.join(root,'docs/morrowise/OPERATOR-GUIDE.md'),'utf8');
let count=0;
const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const make=()=>api.createPublicRelease({registry,body});
test('six approved chapters produce twelve public pages',()=>{
 const release=make(); assert.equal(release.bundle.pages.length,12);
 assert(release.bundle.pages.every(p=>p.visibility==='public'));
 for(const p of release.bundle.pages.filter(p=>p.kind==='content'))assert.equal(p.body,source.extractChapter(body,p.chapter_id));
 assert.equal(api.validatePublicRelease(release,{registry,body,allowCandidate:true}),true);
});
test('candidate is never deployable without committed provenance',()=>assert.throws(()=>api.validatePublicRelease(make(),{registry,body}),/uncommitted_release/));
test('same inputs produce identical release',()=>assert.deepEqual(make(),make()));
test('missing public approval is rejected',()=>{const r=structuredClone(registry);delete r.public_release_review;assert.throws(()=>api.createPublicRelease({registry:r,body}),/public_review/);});
test('partial allowlist cannot publish six chapters',()=>{const r=structuredClone(registry);r.public_allowlist.pop();assert.throws(()=>api.createPublicRelease({registry:r,body}),/allowlist/);});
test('source body tamper is rejected',()=>assert.throws(()=>api.createPublicRelease({registry,body:body+'\nchanged\n'}),/fingerprint/));
test('stale public review is rejected',()=>{const r=structuredClone(registry);r.public_release_review.source_fingerprint='0'.repeat(64);assert.throws(()=>api.createPublicRelease({registry:r,body}),/public_review/);});
test('bundle corruption with recomputed payload hashes still fails parity',()=>{
 const r=make();r.bundle.pages[0].body+='\nsynthetic corruption\n';
 r.bundle.pages[0].content_fingerprint=api.digest(r.bundle.pages[0].body);
 r.bundle.pages[0].content_hash=r.bundle.pages[0].content_fingerprint;
 const {payload_fingerprint,...unsigned}=r.bundle;r.bundle.payload_fingerprint=api.digest(unsigned);
 r.manifest.bundle_fingerprint=api.digest(r.bundle);
 assert.throws(()=>api.validatePublicRelease(r,{registry,body,allowCandidate:true}),/parity/);
});
test('wrong navigation is rejected',()=>{const r=make();r.bundle.human_navigation.reverse();assert.throws(()=>api.validatePublicRelease(r,{registry,body,allowCandidate:true}),/parity/);});
test('missing manifest is rejected',()=>assert.throws(()=>api.validatePublicRelease({bundle:make().bundle},{registry,body,allowCandidate:true}),/manifest/));
test('invalid source revision is rejected',()=>assert.throws(()=>api.createPublicRelease({registry,body,sourceCommit:'main'}),/source_commit/));
test('fabricated commit cannot turn a candidate into a deployable release',()=>{
 const r=api.createPublicRelease({registry,body,sourceCommit:'a'.repeat(40)});
 assert.throws(()=>api.validatePublicRelease(r,{registry,body}),/unverified_source_commit/);
});
test('alternate source path cannot be substituted',()=>{
 const r=structuredClone(registry);r.source_allowlist=['$COLLAB/notyet-harness/elsewhere.md'];
 assert.throws(()=>api.createPublicRelease({registry:r,body}),/public_source_ref/);
});
test('unreviewed summary cannot be regenerated into an approved release',()=>{
 const r=structuredClone(registry);r.records[0].human_summary='SYNTHETIC_UNREVIEWED_PUBLIC_SUMMARY';
 assert.throws(()=>api.createPublicRelease({registry:r,body}),/public_inputs_review/);
});
test('unreviewed navigation cannot reuse an old public review',()=>{
 const r=structuredClone(registry);r.human_navigation[0].title='SYNTHETIC_UNREVIEWED_NAVIGATION';
 assert.throws(()=>api.createPublicRelease({registry:r,body}),/public_inputs_review/);
});
console.log(`Public release tests: ${count}/${count}`);
