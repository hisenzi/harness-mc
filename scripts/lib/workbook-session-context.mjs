import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getResolvedRepos,gitRead,digest,stableJson,loadWorkbook,workId} from './workbook-anchor.mjs';

// Human-supervised session boundary, not a signer or an autonomous permission
// service. The host agent reads actual human text and reviews its meaning; this
// module binds that review to immutable scope and rechecks the original source.
// The private brand prevents accidental JSON/callback substitution. It does not
// defend against a malicious process with the same OS account and code access.
const contexts=new WeakMap();
const hostSessionId=process.env.CODEX_THREAD_ID;
const hostHome=os.userInfo().homedir;
const hostSessionsRoot=path.join(hostHome,'.codex','sessions');
const check=(ok,reason)=>{if(!ok)throw Error(reason);};
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const sessionPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operationActions=new Set(['commit','handoff','integrate']);

function noSymlink(file) {
  const parsed=path.parse(file);let at=parsed.root;
  for(const part of file.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    at=path.join(at,part);check(!fs.lstatSync(at).isSymbolicLink(),'human_source_symlink_rejected');
  }
}
function locateSession(sessionId) {
  check(sessionPattern.test(sessionId||''),'human_source_session_invalid');
  noSymlink(hostSessionsRoot);
  const matches=[];
  function walk(dir,depth) {
    check(depth<=5,'human_source_directory_depth');
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const full=path.join(dir,entry.name);
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory())walk(full,depth+1);
      else if(entry.isFile()&&entry.name.startsWith('rollout-')&&entry.name.endsWith(`-${sessionId}.jsonl`))matches.push(full);
    }
  }
  walk(hostSessionsRoot,0);
  check(matches.length===1,'human_source_session_not_unique');
  noSymlink(matches[0]);return matches[0];
}
function readHumanSession(sessionId) {
  const sourcePath=locateSession(sessionId),before=fs.statSync(sourcePath);
  const rows=fs.readFileSync(sourcePath,'utf8').split('\n').filter(line=>line.trim()).map(line=>{
    try{return JSON.parse(line);}catch{throw Error('human_source_incomplete_record');}
  });
  noSymlink(sourcePath);const after=fs.statSync(sourcePath);
  check(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'human_source_changed_while_reading');
  const metas=rows.filter(r=>r.type==='session_meta');
  check(metas.length===1&&metas[0].payload?.id===sessionId,'human_source_session_metadata_mismatch');
  const meta=metas[0].payload;
  check(meta.originator==='Codex Desktop'&&meta.thread_source==='user'&&['vscode','cli'].includes(meta.source),'human_source_not_root_user_session');
  const messages=[];const ids=new Set();
  for(const row of rows) {
    const p=row.payload;
    if(row.type!=='response_item'||p?.type!=='message'||p.role!=='user')continue;
    const metadata=p.internal_chat_message_metadata_passthrough;
    check(Array.isArray(p.content)&&Array.isArray(metadata?.content_item_kinds)&&metadata.content_item_kinds.length===p.content.length,'human_source_message_metadata_unsupported');
    if(!metadata.content_item_kinds.includes('user.text'))continue;
    check(nonempty(p.id)&&!ids.has(p.id)&&nonempty(metadata.turn_id)&&metadata.create_time!==undefined,'human_source_message_identity_invalid');ids.add(p.id);
    for(let i=0;i<p.content.length;i++) {
      if(metadata.content_item_kinds[i]!=='user.text')continue;
      const item=p.content[i];check(item?.type==='input_text'&&nonempty(item.text),'human_source_user_text_invalid');
      messages.push({session_id:sessionId,message_id:p.id,content_index:i,turn_id:metadata.turn_id,create_time:metadata.create_time,text:item.text,message_sha256:digest(item.text)});
    }
  }
  const userWatermark=digest(messages.map(({text,...identity})=>identity));
  return {source_path:sourcePath,messages,user_watermark:userWatermark,latest_user_message_id:messages.at(-1)?.message_id??null};
}

export function inspectWorkbookHumanSource(input) {
  check(input&&Object.keys(input).every(k=>['sessionId','messageId','contentIndex'].includes(k)),'human_source_input_invalid');
  const {sessionId,messageId,contentIndex=0}=input;
  check(nonempty(messageId)&&Number.isInteger(contentIndex)&&contentIndex>=0,'human_source_message_selector_invalid');
  const session=readHumanSession(sessionId);
  const message=session.messages.find(m=>m.message_id===messageId&&m.content_index===contentIndex);
  check(message,'human_source_message_not_user_text');
  return {provider:'codex-desktop-user-text-v1',...message,source_path:session.source_path,user_watermark:session.user_watermark,latest_user_message_id:session.latest_user_message_id};
}

function currentWorkbook(workbook) {
  check(nonempty(workbook?.home),'session_workbook_required');
  const live=loadWorkbook(workbook.home);
  check(live.contract_fingerprint===workbook.contract_fingerprint,'session_contract_changed');return live;
}
function refresh(record,workbook) {
  const live=currentWorkbook(workbook);
  check(live.home===record.home&&live.contract_fingerprint===record.contract_fingerprint&&workId(live.contract)===record.work_id,'session_contract_changed');
  check(stableJson(repoBindings(live))===stableJson(record.repo_bindings),'session_repo_binding_changed');
  check(stableJson(repoIdentities(live))===stableJson(record.repo_identities),'session_repo_identity_changed');
  const sessions=new Map(record.sources.map(s=>[s.session_id,null]));
  sessions.set(record.session_id,null);
  for(const sessionId of sessions.keys())sessions.set(sessionId,readHumanSession(sessionId));
  check(sessions.get(record.session_id).user_watermark===record.host_user_watermark,'human_source_watermark_changed');
  for(const source of record.sources) {
    const session=sessions.get(source.session_id);
    const message=session.messages.find(m=>m.message_id===source.message_id&&m.content_index===source.content_index);
    check(message&&message.message_sha256===source.message_sha256,'human_source_digest_changed');
    check(record.source_watermarks.find(s=>s.session_id===source.session_id)?.user_watermark===session.user_watermark,'human_source_watermark_changed');
  }
  return live;
}

function repoIdentities(workbook) {
  const identity=location=>{
    const realpath=fs.realpathSync(location),stat=fs.statSync(realpath);
    check(stat.isDirectory(),'session_repo_directory_required');
    return {realpath,device:stat.dev,inode:stat.ino};
  };
  return getResolvedRepos(workbook).map(repo=>({repo_id:repo.repo_id,
    canonical:identity(repo.canonical_root),checkout:identity(repo.checkout_root),
    common_git:identity(path.resolve(repo.checkout_root,gitRead(repo.checkout_root,['rev-parse','--git-common-dir']))),
  }));
}
function repoBindings(workbook) {
  return getResolvedRepos(workbook).map(r=>({repo_id:r.repo_id,canonical_root:r.canonical_root,checkout_root:r.checkout_root}));
}

export function createWorkbookSessionContext({workbook,sessionId,sources,decision}) {
  check(nonempty(hostSessionId)&&sessionId===hostSessionId,'host_session_mismatch');
  const live=currentWorkbook(workbook),c=live.contract;
  check(Array.isArray(sources)&&sources.length>0&&sources.every(s=>s&&Object.keys(s).every(k=>['session_id','message_id','content_index','message_sha256','approval_ref'].includes(k))&&sessionPattern.test(s.session_id||'')&&nonempty(s.message_id)&&Number.isInteger(s.content_index)&&s.content_index>=0&&sha(s.message_sha256)&&c.approval_refs.includes(s.approval_ref)),'human_source_reference_invalid');
  check(new Set(sources.map(s=>`${s.session_id}/${s.message_id}/${s.content_index}`)).size===sources.length,'human_source_reference_duplicate');
  check(decision&&decision.work_id===workId(c)&&decision.home===live.home&&decision.contract_fingerprint===live.contract_fingerprint,'reviewed_contract_binding_mismatch');
  check(nonempty(decision.reason),'human_semantic_review_required');
  check(Array.isArray(decision.allowed_actions)&&decision.allowed_actions.length>0&&new Set(decision.allowed_actions).size===decision.allowed_actions.length&&decision.allowed_actions.every(a=>c.allowed_actions.includes(a)),'reviewed_actions_invalid');
  const repos=repoBindings(live);
  check(stableJson(decision.repo_bindings)===stableJson(repos),'reviewed_repo_binding_mismatch');
  check(Array.isArray(decision.source_watermarks)&&decision.source_watermarks.every(s=>s&&sessionPattern.test(s.session_id||'')&&sha(s.user_watermark))&&new Set(decision.source_watermarks.map(s=>s.session_id)).size===decision.source_watermarks.length&&stableJson([...new Set(sources.map(s=>s.session_id))].sort())===stableJson(decision.source_watermarks.map(s=>s.session_id).sort()),'reviewed_source_watermarks_invalid');
  check(Array.isArray(decision.operations)&&decision.operations.every(o=>operationActions.has(o?.action)&&decision.allowed_actions.includes(o.action)&&sha(o.operation_fingerprint)),'reviewed_operations_invalid');
  for(const action of decision.allowed_actions.filter(a=>operationActions.has(a)))check(decision.operations.some(o=>o.action===action),'reviewed_exact_operation_required');
  check(decision.intake_reviews===undefined||Array.isArray(decision.intake_reviews)&&decision.intake_reviews.every(r=>r&&Object.keys(r).every(k=>['operation_fingerprint','review_fingerprint'].includes(k))&&sha(r.operation_fingerprint)&&sha(r.review_fingerprint)&&decision.operations.some(o=>['handoff','integrate'].includes(o.action)&&o.operation_fingerprint===r.operation_fingerprint)),'reviewed_intake_binding_invalid');
  // A resumed session may cite an earlier human grant, but a later stop in the
  // current human session must still revoke this in-memory review.
  const record=structuredClone({...decision,sources,session_id:sessionId,repo_identities:repoIdentities(live),host_user_watermark:readHumanSession(sessionId).user_watermark});refresh(record,live);
  const context=Object.freeze({kind:'human_supervised_workbook_session',version:1});contexts.set(context,record);return context;
}

export function getWorkbookSessionResolvers(context,workbook) {
  const record=contexts.get(context);check(record,'untrusted_session_context');refresh(record,workbook);
  return {
    session_id:record.session_id,
    source_evidence:structuredClone({sources:record.sources,source_watermarks:record.source_watermarks,host_session_id:record.session_id,host_user_watermark:record.host_user_watermark,review_reason:record.reason}),
    hc_decision:structuredClone(record.hc_decision??null),
    intakeReviewResolver(request) {
      refresh(record,workbook);
      if(!request||!record.intake_reviews?.some(r=>r.operation_fingerprint===request.operation_fingerprint&&r.review_fingerprint===request.review_fingerprint))return null;
      return {decision:'allow',source_ref:record.sources[0].approval_ref,operation_fingerprint:request.operation_fingerprint,review_fingerprint:request.review_fingerprint};
    },
    approvalResolver(request) {
      refresh(record,workbook);
      if(request?.work_id!==record.work_id||request.contract_fingerprint!==record.contract_fingerprint||!record.allowed_actions.includes(request.action))return null;
      if(operationActions.has(request.action)&&(!request.operation||digest(request.operation)!==request.operation_fingerprint||!record.operations.some(o=>o.action===request.action&&o.operation_fingerprint===request.operation_fingerprint)))return null;
      return {source_ref:record.sources[0].approval_ref,work_id:record.work_id,contract_fingerprint:record.contract_fingerprint,allowed_actions:[...record.allowed_actions],revoked:false,...(request.operation_fingerprint?{operation_fingerprint:request.operation_fingerprint}:{}),source_evidence:structuredClone(record.sources)};
    }
  };
}
