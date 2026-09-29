import crypto from 'node:crypto';
import {createBundleFromBody} from '../generate-morrowise-documentation.mjs';

const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  : JSON.stringify(value);
export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
const fail = message => {throw new Error(message);};
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export function publicInputsFingerprint(registry, body) {
  const {public_release_review: excludedReview, ...inputs} = registry;
  return digest({registry: inputs, body_fingerprint: digest(body.replace(/\r\n?/g, '\n'))});
}

export function createPublicRelease({registry, body, sourceCommit = null} = {}) {
  if (registry?.source_allowlist?.length !== 1 || registry.source_allowlist[0] !== '$COLLAB/harness-mc/docs/morrowise/OPERATOR-GUIDE.md') fail('public_source_ref_not_approved');
  const review = registry?.public_release_review;
  if (!review || !nonempty(review.approved_by) || !nonempty(review.reviewed_by)
      || !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewed_at || '')
      || !Array.isArray(review.evidence_refs) || !review.evidence_refs.length || !review.evidence_refs.every(nonempty)
      || review.source_fingerprint !== registry?.records?.[0]?.source_refs?.[0]?.fingerprint) fail('public_review_missing_or_stale');
  const ids = registry.records.map(record => record.id).sort();
  if (!Array.isArray(registry.public_allowlist) || stable([...registry.public_allowlist].sort()) !== stable(ids)) fail('public_allowlist_incomplete');
  if (sourceCommit !== null && !/^[a-f0-9]{40}$/.test(sourceCommit)) fail('invalid_source_commit');
  const local = createBundleFromBody({registry, body});
  if (review.inputs_fingerprint !== publicInputsFingerprint(registry, body)) fail('public_inputs_review_missing_or_stale');
  const {payload_fingerprint: ignored, ...unsigned} = local;
  const payload = {...unsigned, visibility: 'public', pages: local.pages.map(page => ({...page, visibility: 'public'}))};
  const bundle = {...payload, payload_fingerprint: digest(payload)};
  const manifest = {
    schema_version: '1.0', release_state: sourceCommit ? 'committed' : 'local_candidate',
    source_commit: sourceCommit, source_ref: registry.source_allowlist[0],
    body_fingerprint: digest(body.replace(/\r\n?/g, '\n')),
    registry_fingerprint: digest(registry), bundle_fingerprint: digest(bundle),
    navigation_fingerprint: digest(bundle.human_navigation), visibility_fingerprint: digest(registry.public_allowlist),
    source_review_fingerprint: digest(review), generator_version: 'morrowise-public-release-v1',
    reviewed_at: review.reviewed_at, freshness_basis: 'reviewed_source_revision_not_live_upstream',
    chapter_versions: Object.fromEntries(registry.records.map(record => [record.id, record.document_version])),
  };
  return {manifest, bundle};
}

export function validatePublicRelease(release, {registry, body, allowCandidate = false, trustedSourceCommit = null} = {}) {
  if (!release?.manifest || typeof release.manifest !== 'object') fail('release_manifest_missing');
  if (!allowCandidate && (!release.manifest.source_commit || release.manifest.release_state !== 'committed')) fail('uncommitted_release');
  // A manifest's self-asserted 40-character value is not Git provenance.
  if (release.manifest.source_commit !== null && release.manifest.source_commit !== trustedSourceCommit) fail('unverified_source_commit');
  const expected = createPublicRelease({registry, body, sourceCommit: release.manifest.source_commit});
  if (stable(release) !== stable(expected)) fail('public_release_parity_mismatch');
  return true;
}
