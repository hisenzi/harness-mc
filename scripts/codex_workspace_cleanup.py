#!/usr/bin/env python3
"""Conservative local Codex workspace inventory and approved file quarantine.

Policy lives in POLICY below. Scan is metadata-only. Mutation input is a trusted
operator attestation, not a substitute for obtaining real user approval or a
coordinated quiet window. No operation permanently deletes user data.
"""
import argparse
from contextlib import contextmanager
import ctypes
from datetime import datetime, timedelta, timezone
import errno
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import stat
import sys
import time
import uuid

DAY = 86400
STATE_NAME = '.workspace-cleanup'
POLICY = {
    'version': 1, 'candidate_days': 30, 'empty_workspace_report_days': 90,
    'quarantine_minimum_days': 30, 'approval_max_seconds': DAY,
    'fresh_evidence_seconds': 300, 'weekly_schedule': 'Sunday 10:00 Asia/Taipei',
    'default': 'metadata_only', 'directories': 'report_only',
    'dispositions': ['rebuildable', 'verified_copy_in_outputs'],
    'permanent_deletion': 'unsupported', 'report_pruning': 'manual_review_only', 'growth_alert_bytes': 250 * 1024 * 1024,
    'protected': ['outputs', 'active_or_pinned', 'current_cwd', 'git_related',
                  'symlink', 'hardlink', 'cross_device', 'unknown', 'original',
                  'manual_edit', 'unique', 'direct_reference', 'private_runtime'],
}

class CleanupError(RuntimeError):
    pass


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _digest(value):
    return hashlib.sha256(_json_bytes(value)).hexdigest()


POLICY_HASH = _digest(POLICY)
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _now(value):
    value = time.time() if value is None else value
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise CleanupError('invalid_time')
    return float(value)


def _rel(value):
    if not isinstance(value, str) or not value or '\\' in value or '\x00' in value:
        raise CleanupError('invalid_relative_path')
    parts = value.split('/')
    if any(p in ('', '.', '..') for p in parts) or Path(value).is_absolute():
        raise CleanupError('invalid_relative_path')
    return parts


def _identity(st):
    return {'dev': st.st_dev, 'ino': st.st_ino}


def _fingerprint(st):
    return {**_identity(st), 'size': st.st_size, 'mtime_ns': st.st_mtime_ns,
            'ctime_ns': st.st_ctime_ns, 'mode': st.st_mode, 'nlink': st.st_nlink}


def _root(root):
    root = Path(os.path.abspath(root))
    for path in [*reversed(root.parents), root]:
        st = path.lstat()
        if not stat.S_ISDIR(st.st_mode):
            raise CleanupError('root_or_ancestor_not_directory')
    return root, _identity(root.lstat())


def _assert_root(root, expected):
    actual, identity = _root(root)
    if identity != expected:
        raise CleanupError('root_identity_changed')
    return actual


@contextmanager
def _parent(root, rel, expected=None):
    parts = _rel(rel)
    descriptors = []
    try:
        fd = os.open(root, DIR_FLAGS)
        descriptors.append(fd)
        chain = [{'path': '.', **_identity(os.fstat(fd))}]
        for i, part in enumerate(parts[:-1]):
            fd = os.open(part, DIR_FLAGS, dir_fd=fd)
            descriptors.append(fd)
            st = os.fstat(fd)
            if st.st_dev != chain[0]['dev']:
                raise CleanupError('cross_device_parent')
            chain.append({'path': '/'.join(parts[:i+1]), **_identity(st)})
        if expected is not None and chain != expected:
            raise CleanupError('parent_identity_changed')
        yield fd, parts[-1], chain
    except OSError as exc:
        raise CleanupError(f'unsafe_or_missing_parent:{exc.errno}') from exc
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


def _hash_at(fd, name):
    handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    try:
        before = os.fstat(handle)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise CleanupError('not_single_regular_file')
        digest = hashlib.sha256()
        while True:
            block = os.read(handle, 1024 * 1024)
            if not block:
                break
            digest.update(block)
        after = os.fstat(handle)
        if _fingerprint(before) != _fingerprint(after):
            raise CleanupError('file_changed_during_hash')
        current = os.stat(name, dir_fd=fd, follow_symlinks=False)
        if _fingerprint(after) != _fingerprint(current):
            raise CleanupError('path_changed_during_hash')
        return _fingerprint(after), digest.hexdigest()
    finally:
        os.close(handle)


def _snapshot(snapshot, now, required=False):
    if not isinstance(snapshot, dict):
        if required:
            raise CleanupError('task_snapshot_missing')
        return {'threads': [], 'protected_paths': [], 'coverage': 'unknown'}
    captured = snapshot.get('captured_at')
    try:
        age = now - _now(captured) if captured is not None else float('inf')
    except CleanupError:
        age = float('inf')
    if required and not 0 <= age <= POLICY['fresh_evidence_seconds']:
        raise CleanupError('task_snapshot_stale')
    if not isinstance(snapshot.get('threads'), list) or not isinstance(snapshot.get('protected_paths', []), list):
        raise CleanupError('invalid_snapshot')
    if required:
        for thread in snapshot['threads']:
            if not isinstance(thread, dict):
                raise CleanupError('invalid_thread_record')
            cwd = thread.get('cwd')
            if not isinstance(cwd, str) or not cwd or ('..' in cwd.split('/')) or '\\' in cwd or '\x00' in cwd:
                raise CleanupError('unlocatable_thread_state')
    return snapshot


def _workspace(parts):
    return '/'.join(parts[:2]) if len(parts) >= 2 and re.fullmatch(r'\d{4}-\d{2}-\d{2}', parts[0]) else None


def _cwd_relative(root, cwd):
    if not isinstance(cwd, str):
        return None
    try:
        return str(Path(cwd).relative_to(root)) if Path(cwd).is_absolute() else '/'.join(_rel(cwd))
    except (ValueError, CleanupError):
        return None


def _intersects(a, b):
    return a == b or a.startswith(b + '/') or b.startswith(a + '/')


def _private(parts):
    return any(p in ('.codex', '.ssh', '.agents', '.env', 'credentials.json', 'auth.json',
                     'id_rsa', 'id_ed25519') or p.startswith('.env.') for p in parts)


def scan(root, now=None, snapshot=None):
    now = _now(now)
    root, identity = _root(root)
    snap = _snapshot(snapshot, now)
    rows, dirs, errors, git_workspaces = [], [], [], set()
    root_git = any(os.path.lexists(p / '.git') for p in [root, *root.parents])
    blocked = set()
    activities = {}
    for thread in snap['threads']:
        rel = _cwd_relative(root, thread.get('cwd'))
        if not rel:
            continue
        ws = _workspace(rel.split('/'))
        if ws:
            if thread.get('active') is not False or thread.get('pinned') is not False:
                blocked.add(ws)
            value = thread.get('last_activity_at')
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                activities[ws] = max(activities.get(ws, value), value)
    current = _cwd_relative(root, os.getcwd())
    if current and _workspace(current.split('/')):
        blocked.add(_workspace(current.split('/')))
    references = []
    for value in snap.get('protected_paths', []):
        rel = _cwd_relative(root, value)
        if rel:
            references.append(rel)
    def visit(fd, parts):
        try:
            with os.scandir(fd) as entries:
                entries = sorted(entries, key=lambda entry: entry.name)
            for entry in entries:
                child = parts + [entry.name]
                rel = '/'.join(child)
                if not parts and entry.name == STATE_NAME:
                    continue
                try:
                    st = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                    ws = _workspace(child)
                    if entry.name == '.git':
                        if ws:
                            git_workspaces.add(ws)
                        else:
                            # A Git marker at a date container conservatively protects all.
                            git_workspaces.add('*')
                    if stat.S_ISDIR(st.st_mode):
                        dirs.append({'path': rel, 'workspace': ws, 'mtime': st.st_mtime})
                        if st.st_dev != identity['dev']:
                            errors.append({'path': rel, 'reason': 'cross_device_directory'})
                            if ws:
                                blocked.add(ws)
                            continue
                        if entry.name == '.git' or _private(child):
                            continue
                        nested = os.open(entry.name, DIR_FLAGS, dir_fd=fd)
                        try:
                            if _identity(os.fstat(nested)) != _identity(st):
                                raise CleanupError('directory_changed_during_scan')
                            visit(nested, child)
                        finally:
                            os.close(nested)
                    else:
                        category = 'outputs' if 'outputs' in child[2:] else ('work' if len(child) > 2 and child[2] == 'work' else 'cache' if any(p in ('node_modules', '.cache', 'dist', 'build') for p in child[2:]) else 'other')
                        rows.append({'path': rel, 'workspace': ws, 'category': category,
                                     'size': st.st_size, 'allocated': st.st_blocks * 512,
                                     'fingerprint': _fingerprint(st), 'state': 'unknown',
                                     'reason': 'reference_purpose_activity_unverified'})
                except (OSError, CleanupError) as exc:
                    errors.append({'path': rel, 'reason': type(exc).__name__})
        except OSError as exc:
            errors.append({'path': '/'.join(parts), 'reason': f'scan_error:{exc.errno}'})
    fd = os.open(root, DIR_FLAGS)
    try:
        if _identity(os.fstat(fd)) != identity:
            raise CleanupError('root_identity_changed')
        visit(fd, [])
    finally:
        os.close(fd)
    _assert_root(root, identity)
    for row in rows:
        parts = row['path'].split('/')
        fp = row['fingerprint']
        reason = None
        if row['category'] == 'outputs': reason = 'output_deliverable'
        elif _private(parts): reason = 'private_runtime'
        elif row['workspace'] in blocked: reason = 'active_pinned_current_or_mount'
        elif root_git or '*' in git_workspaces or row['workspace'] in git_workspaces: reason = 'git_related_workspace'
        elif not stat.S_ISREG(fp['mode']): reason = 'symlink_or_special'
        elif fp['nlink'] != 1: reason = 'hardlink_or_shared'
        elif fp['dev'] != identity['dev']: reason = 'cross_device'
        elif any(_intersects(row['path'], ref) for ref in references): reason = 'direct_reference'
        if reason:
            row.update(state='protected', reason=reason)
        age = now - fp['mtime_ns'] / 1e9
        row['time_filter_30d'] = bool(age >= 30 * DAY and row['category'] in ('work', 'cache'))
    workspaces = []
    for directory in dirs:
        if directory['path'] != directory['workspace']:
            continue
        children = [r for r in rows if r['workspace'] == directory['workspace']]
        # Protected/pruned trees cannot be characterized as empty.
        pruned = directory['workspace'] in git_workspaces or any(e['path'].startswith(directory['path'] + '/') for e in errors) or any(d['path'].startswith(directory['path'] + '/') and _private(d['path'].split('/')) for d in dirs)
        empty = not children and not pruned
        workspaces.append({'path': directory['path'], 'files': len(children),
                           'empty_tree': empty, 'empty_90d_report_only': empty and now - directory['mtime'] >= 90 * DAY,
                           'known_last_activity': activities.get(directory['path']),
                           'active_or_pinned_or_current': directory['path'] in blocked})
    regular = [r for r in rows if stat.S_ISREG(r['fingerprint']['mode'])]
    return {'schema_version': 1, 'scanned_at': now, 'root_path': str(root), 'root_identity': identity,
            'policy_hash': POLICY_HASH, 'snapshot_coverage': snap.get('coverage', 'unknown'),
            'files': rows, 'workspaces': workspaces, 'errors': errors,
            'summary': {'regular_files': len(regular), 'workspaces': len(workspaces),
                        'logical_bytes': sum(r['size'] for r in regular),
                        'allocated_bytes': sum(r['allocated'] for r in regular),
                        'protected': sum(r['state'] == 'protected' for r in rows),
                        'unknown': sum(r['state'] == 'unknown' for r in rows),
                        'time_filtered_files': sum(r['time_filter_30d'] for r in regular),
                        'eligible_files': 0, 'errors': len(errors)}}


def prepare(root, evidence, snapshot=None, now=None):
    now = _now(now)
    root, identity = _root(root)
    snap = _snapshot(snapshot, now, required=True)
    if not isinstance(evidence, dict) or evidence.get('root_identity') != identity:
        raise CleanupError('evidence_root_mismatch')
    checked = evidence.get('checked_at')
    if checked is None or not 0 <= now - _now(checked) <= POLICY['fresh_evidence_seconds'] or not evidence.get('source'):
        raise CleanupError('evidence_stale_or_source_missing')
    report = scan(root, now, snap)
    if report['errors']:
        raise CleanupError('scan_incomplete')
    rows = {r['path']: r for r in report['files']}
    workspaces = {w['path']: w for w in report['workspaces']}
    items = []
    retained_copies = []
    seen = set()
    for entry in evidence.get('items', []):
        rel = entry.get('path')
        _rel(rel)
        if rel in seen:
            raise CleanupError('duplicate_evidence_path')
        seen.add(rel)
        row = rows.get(rel)
        if not row or row['state'] == 'protected' or row['category'] not in ('work', 'cache') or not row['workspace']:
            raise CleanupError('protected_or_non_file_candidate')
        if any(entry.get(k) is not True for k in ('references_verified', 'unreferenced', 'not_in_use', 'activity_confident')):
            raise CleanupError('reference_or_activity_unknown')
        if any(entry.get(k) is not False for k in ('manual_edits', 'unique')) or entry.get('purpose') != 'temporary':
            raise CleanupError('protected_purpose')
        activity = entry.get('last_activity_at')
        if activity is None or now - _now(activity) < 30 * DAY or not row['time_filter_30d']:
            raise CleanupError('activity_too_recent_or_unknown')
        known = workspaces.get(row['workspace'], {}).get('known_last_activity')
        if known is not None and now - known < 30 * DAY:
            raise CleanupError('known_task_activity_too_recent')
        if entry.get('quiet_until') is None or not now < _now(entry['quiet_until']) <= checked + DAY:
            raise CleanupError('quiet_window_missing_or_expired')
        rebuild = entry.get('rebuild', {})
        disposition = entry.get('disposition')
        if disposition == 'rebuildable':
            if not all(isinstance(rebuild.get(k), str) and rebuild[k].strip() for k in ('source', 'version', 'inputs')):
                raise CleanupError('rebuild_evidence_incomplete')
        elif disposition != 'verified_copy':
            raise CleanupError('disposition_unknown')
        with _parent(root, rel) as (fd, name, chain):
            fp, sha = _hash_at(fd, name)
            if fp != row['fingerprint'] or chain[0]['dev'] != identity['dev'] or chain[0]['ino'] != identity['ino']:
                raise CleanupError('candidate_changed_during_prepare')
            items.append({'path': rel, 'fingerprint': fp, 'sha256': sha, 'parent_chain': chain})
        if disposition == 'verified_copy':
            proof = entry.get('copy', {})
            copy_path = proof.get('path')
            parts = _rel(copy_path)
            copy_row = rows.get(copy_path)
            verified = proof.get('verified_at')
            if proof.get('retained') is not True or verified is None or not 0 <= now - _now(verified) <= POLICY['fresh_evidence_seconds']:
                raise CleanupError('retained_copy_evidence_stale_or_unknown')
            if copy_path == rel or not copy_row or copy_row['category'] != 'outputs' or _private(parts):
                raise CleanupError('retained_copy_must_be_protected_output')
            with _parent(root, copy_path) as (copy_fd, copy_name, copy_chain):
                copy_fp, copy_sha = _hash_at(copy_fd, copy_name)
                if copy_sha != sha or copy_fp['dev'] != identity['dev']:
                    raise CleanupError('retained_copy_content_or_device_mismatch')
                retained_copies.append({'source_path': rel, 'path': copy_path, 'fingerprint': copy_fp, 'sha256': copy_sha, 'parent_chain': copy_chain})
    manifest = {'schema_version': 1, 'created_at': now, 'root_identity': identity,
                'root_path': str(root), 'policy_hash': POLICY_HASH,
                'evidence_digest': _digest(evidence),
                'snapshot_digest': _digest({k: v for k, v in snap.items() if k != 'captured_at'}),
                'items': items, 'retained_copies': retained_copies}
    manifest['digest'] = _digest(manifest)
    return manifest


def _manifest(manifest, root, now):
    if manifest.get('schema_version') != 1 or manifest.get('policy_hash') != POLICY_HASH:
        raise CleanupError('manifest_policy_mismatch')
    unsigned = {k: v for k, v in manifest.items() if k != 'digest'}
    if manifest.get('digest') != _digest(unsigned):
        raise CleanupError('manifest_digest_mismatch')
    _assert_root(root, manifest['root_identity'])
    if str(Path(os.path.abspath(root))) != manifest['root_path']:
        raise CleanupError('root_path_mismatch')
    if not 0 <= now - _now(manifest['created_at']) <= DAY:
        raise CleanupError('manifest_stale')


def _approval(approval, action, digest, now, batch_id=None):
    if not isinstance(approval, dict) or approval.get('schema_version') != 1 or approval.get('action') != action or approval.get('manifest_digest') != digest:
        raise CleanupError('approval_scope_mismatch')
    if not all(isinstance(approval.get(k), str) and approval[k].strip() for k in ('authorized_by', 'authority_ref')):
        raise CleanupError('approval_authority_missing')
    issued, expires = approval.get('issued_at'), approval.get('expires_at')
    if issued is None or expires is None or not _now(issued) <= now < _now(expires) or not 0 < expires - issued <= DAY:
        raise CleanupError('approval_stale_or_invalid')
    if batch_id is not None and approval.get('batch_id') != batch_id:
        raise CleanupError('approval_batch_mismatch')


def _open_directory(path):
    """Resolve every absolute parent through an open descriptor, no symlinks."""
    path = Path(os.path.abspath(path))
    fd = os.open('/', DIR_FLAGS)
    try:
        for part in path.parts[1:]:
            child = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def _state(root, state_dir):
    root, identity = _root(root)
    state_dir = Path(os.path.abspath(state_dir))
    if state_dir != root / STATE_NAME:
        raise CleanupError('state_directory_must_be_fixed_root_child')
    root_fd = _open_directory(root)
    try:
        if _identity(os.fstat(root_fd)) != identity:
            raise CleanupError('root_identity_changed')
        try:
            os.mkdir(STATE_NAME, mode=0o700, dir_fd=root_fd)
        except FileExistsError:
            pass
        st = os.stat(STATE_NAME, dir_fd=root_fd, follow_symlinks=False)
    finally:
        os.close(root_fd)
    if not stat.S_ISDIR(st.st_mode) or st.st_dev != identity['dev'] or stat.S_IMODE(st.st_mode) != 0o700 or st.st_uid != os.getuid():
        raise CleanupError('state_directory_not_private_or_same_device')
    return state_dir


@contextmanager
def _lock(state):
    # Kernel flock releases on process death. Keep its inode; unlinking a lock
    # file would let a third invocation lock a different inode concurrently.
    state_fd = _open_directory(state)
    try:
        fd = os.open('operation.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=state_fd)
    except BaseException:
        os.close(state_fd)
        raise
    acquired = False
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o600:
            raise CleanupError('unsafe_lock_file')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError as exc:
            raise CleanupError('cleanup_lock_busy') from exc
        yield state_fd
    finally:
        if acquired:
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
        os.close(state_fd)


def _fsync_dir(path):
    fd = _open_directory(path)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_json(path, value):
    path = Path(path)
    temporary = '.' + path.name + '.' + uuid.uuid4().hex + '.tmp'
    parent_fd = _open_directory(path.parent)
    try:
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
        data = _json_bytes(value) + b'\n'
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path.name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        os.fsync(parent_fd)
    finally:
        # Failed temporary files remain for diagnosis; never replayed.
        os.close(parent_fd)


def _read_json(path):
    path = Path(path)
    parent_fd = _open_directory(path.parent)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
    finally:
        os.close(parent_fd)
    with os.fdopen(fd, 'r', encoding='utf-8') as stream:
        st = os.fstat(stream.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_size > 100 * 1024 * 1024:
            raise CleanupError('unsafe_json_file')
        return json.load(stream)


def _rename_exclusive(src_fd, src_name, dst_fd, dst_name):
    library = ctypes.CDLL(None, use_errno=True)
    if platform.system() == 'Darwin' and hasattr(library, 'renameatx_np'):
        function, flag = library.renameatx_np, 4
    elif platform.system() == 'Linux' and hasattr(library, 'renameat2'):
        function, flag = library.renameat2, 1
    else:
        raise CleanupError('atomic_no_overwrite_rename_unavailable')
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    if function(src_fd, os.fsencode(src_name), dst_fd, os.fsencode(dst_name), flag) != 0:
        value = ctypes.get_errno()
        raise CleanupError(f'atomic_rename_refused:{errno.errorcode.get(value, value)}')


def _match_moved(fp, sha, expected):
    return sha == expected['sha256'] and all(fp[k] == expected['fingerprint'][k] for k in ('dev', 'ino', 'size', 'mtime_ns', 'mode', 'nlink'))


def quarantine(root, state_dir, manifest, approval, evidence, snapshot=None, now=None):
    clock = time.time if now is None else lambda: _now(now)
    now = clock()
    root, _ = _root(root)
    _manifest(manifest, root, now)
    _approval(approval, 'quarantine', manifest['digest'], now)
    fresh = prepare(root, evidence, snapshot, now)
    if any(fresh.get(k) != manifest.get(k) for k in ('items', 'evidence_digest', 'snapshot_digest', 'retained_copies')) or not manifest['items']:
        raise CleanupError('candidate_changed_or_empty_batch')
    state = _state(root, state_dir)
    with _lock(state) as state_fd:
        _assert_root(root, manifest['root_identity'])
        batch_id = uuid.uuid4().hex
        batch = state / batch_id
        os.mkdir(batch_id, mode=0o700, dir_fd=state_fd)
        journal = {'schema_version': 1, 'batch_id': batch_id, 'root_identity': manifest['root_identity'],
                   'root_path': str(root), 'manifest_digest': manifest['digest'], 'policy_hash': POLICY_HASH,
                   'created_at': now, 'approval': approval, 'manifest': manifest, 'items': []}
        for i, item in enumerate(manifest['items']):
            journal['items'].append({**item, 'location': f'{STATE_NAME}/{batch_id}/{i:06d}.payload',
                                     'state': 'pending', 'quarantined_at': None})
        journal_path = batch / 'journal.json'
        _write_json(journal_path, journal)
        _fsync_dir(state)
        for item in journal['items']:
            instant = clock()
            _assert_root(root, journal['root_identity'])
            _approval(approval, 'quarantine', manifest['digest'], instant)
            # Recheck metadata, references, evidence and quiet window before each move.
            fresh = prepare(root, {**evidence, 'items': [e for e in evidence['items'] if e['path'] == item['path']]}, snapshot, instant)
            expected_copies = [c for c in manifest['retained_copies'] if c['source_path'] == item['path']]
            if fresh['retained_copies'] != expected_copies or fresh['items'] != [{k: item[k] for k in ('path', 'fingerprint', 'sha256', 'parent_chain')}]:
                raise CleanupError('candidate_changed_before_move')
            with _parent(root, item['path'], item['parent_chain']) as (src_fd, src_name, _):
                with _parent(root, item['location']) as (dst_fd, dst_name, _):
                    fp, sha = _hash_at(src_fd, src_name)
                    if fp != item['fingerprint'] or sha != item['sha256']:
                        raise CleanupError('source_changed_before_move')
                    for retained in expected_copies:
                        with _parent(root, retained['path'], retained['parent_chain']) as (copy_fd, copy_name, _):
                            copy_fp, copy_sha = _hash_at(copy_fd, copy_name)
                            if copy_fp != retained['fingerprint'] or copy_sha != retained['sha256']:
                                raise CleanupError('retained_copy_changed_before_move')
                    instant = clock()
                    _approval(approval, 'quarantine', manifest['digest'], instant)
                    _snapshot(snapshot, instant, required=True)
                    exact_evidence = next(e for e in evidence['items'] if e['path'] == item['path'])
                    if exact_evidence['disposition'] == 'verified_copy' and not 0 <= instant - exact_evidence['copy']['verified_at'] <= POLICY['fresh_evidence_seconds']:
                        raise CleanupError('retained_copy_review_expired_during_hash')
                    if not instant < exact_evidence['quiet_until'] or not 0 <= instant - evidence['checked_at'] <= POLICY['fresh_evidence_seconds']:
                        raise CleanupError('evidence_or_quiet_window_expired_during_hash')
                    _assert_root(root, journal['root_identity'])
                    _rename_exclusive(src_fd, src_name, dst_fd, dst_name)
                    os.fsync(src_fd)
                    os.fsync(dst_fd)
                    moved_fp, moved_sha = _hash_at(dst_fd, dst_name)
                    if not _match_moved(moved_fp, moved_sha, item):
                        raise CleanupError('moved_identity_conflict')
            instant = clock()
            item['state'] = 'quarantined'
            item['quarantined_at'] = instant
            item['minimum_retention_until'] = instant + 30 * DAY
            _write_json(journal_path, journal)
        return journal


def _journal(root, state, batch_id, now):
    if not isinstance(batch_id, str) or not re.fullmatch(r'[0-9a-f]{32}', batch_id):
        raise CleanupError('invalid_batch_id')
    batch = state / batch_id
    st = batch.lstat()
    if not stat.S_ISDIR(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o700 or st.st_dev != root.lstat().st_dev:
        raise CleanupError('unsafe_batch_directory')
    journal = _read_json(batch / 'journal.json')
    if journal.get('schema_version') != 1 or journal.get('batch_id') != batch_id or journal.get('policy_hash') != POLICY_HASH or journal.get('root_path') != str(root):
        raise CleanupError('invalid_journal_binding')
    _assert_root(root, journal['root_identity'])
    if not _now(journal['created_at']) <= now:
        raise CleanupError('journal_creation_time_impossible')
    bound = journal.get('manifest')
    if not isinstance(bound, dict) or bound.get('digest') != journal.get('manifest_digest') or _digest({k: v for k, v in bound.items() if k != 'digest'}) != bound['digest'] or bound.get('root_identity') != journal['root_identity'] or bound.get('root_path') != str(root) or bound.get('policy_hash') != POLICY_HASH or len(bound.get('items', [])) != len(journal['items']):
        raise CleanupError('journal_manifest_binding_corrupt')
    for i, item in enumerate(journal['items']):
        if {k: item.get(k) for k in ('path', 'fingerprint', 'sha256', 'parent_chain')} != bound['items'][i]:
            raise CleanupError('journal_item_binding_corrupt')
        _rel(item['path'])
        if item['location'] != f'{STATE_NAME}/{batch_id}/{i:06d}.payload':
            raise CleanupError('invalid_journal_location')
        if item['state'] not in ('pending', 'quarantined', 'restoring', 'restored', 'conflict'):
            raise CleanupError('invalid_journal_state')
        quarantined_at = item.get('quarantined_at')
        if quarantined_at is not None and (not journal['created_at'] <= _now(quarantined_at) <= now or item.get('minimum_retention_until') != quarantined_at + 30 * DAY):
            raise CleanupError('journal_retention_time_impossible_or_inconsistent')
        if item.get('restored_at') is not None and not journal['created_at'] <= _now(item['restored_at']) <= now:
            raise CleanupError('journal_restore_time_impossible')
    return journal, batch / 'journal.json'


def _probe(root, path, expected_chain=None):
    with _parent(root, path, expected_chain) as (fd, name, _):
        try:
            st = os.stat(name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            return None
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            return {'invalid': True}
        fp, sha = _hash_at(fd, name)
        return fp, sha


def restore(root, state_dir, batch_id, approval, now=None):
    clock = time.time if now is None else lambda: _now(now)
    now = clock()
    root, _ = _root(root)
    state = _state(root, state_dir)
    with _lock(state):
        journal, path = _journal(root, state, batch_id, now)
        _approval(approval, 'restore', journal['manifest_digest'], now, batch_id)
        for item in journal['items']:
            if item['state'] == 'restored':
                current = _probe(root, item['path'], item['parent_chain'])
                if not isinstance(current, tuple) or not _match_moved(*current, item) or _probe(root, item['location']) is not None:
                    raise CleanupError('restored_original_no_longer_matches')
                continue
            if item['state'] != 'quarantined':
                raise CleanupError('recovery_or_conflict_review_required')
            _assert_root(root, journal['root_identity'])
            with _parent(root, item['path'], item['parent_chain']) as (dst_fd, dst_name, _):
                with _parent(root, item['location']) as (src_fd, src_name, _):
                    fp, sha = _hash_at(src_fd, src_name)
                    if not _match_moved(fp, sha, item):
                        raise CleanupError('quarantine_content_changed')
                    _approval(approval, 'restore', journal['manifest_digest'], clock(), batch_id)
                    _assert_root(root, journal['root_identity'])
                    item['state'] = 'restoring'
                    _write_json(path, journal)
                    _approval(approval, 'restore', journal['manifest_digest'], clock(), batch_id)
                    _rename_exclusive(src_fd, src_name, dst_fd, dst_name)
                    os.fsync(src_fd)
                    os.fsync(dst_fd)
                    fp, sha = _hash_at(dst_fd, dst_name)
                    if not _match_moved(fp, sha, item):
                        raise CleanupError('restored_identity_conflict')
                    item['state'] = 'restored'
                    item['restored_at'] = clock()
                    _write_json(path, journal)
        return journal


def recover(root, state_dir, batch_id, now=None):
    now = _now(now)
    root, _ = _root(root)
    state = _state(root, state_dir)
    with _lock(state):
        journal, path = _journal(root, state, batch_id, now)
        for item in journal['items']:
            source = _probe(root, item['path'], item['parent_chain'])
            destination = _probe(root, item['location'])
            source_match = isinstance(source, tuple) and _match_moved(*source, item)
            destination_match = isinstance(destination, tuple) and _match_moved(*destination, item)
            if source is None and destination_match:
                item['state'] = 'quarantined'
                if item.get('quarantined_at') is None:
                    item['quarantined_at'] = now
                    item['retention_time_basis'] = 'recovery_time_actual_move_unknown'
                    item['minimum_retention_until'] = now + 30 * DAY
            elif destination is None and source_match:
                if item['state'] in ('restoring', 'restored'):
                    item['state'] = 'restored'
                    item.setdefault('restored_at', now)
                elif item['state'] == 'pending':
                    item['recovery_note'] = 'source_only_no_replay_new_preparation_and_approval_required'
                else:
                    item['state'] = 'conflict'
            else:
                item['state'] = 'conflict'
                item['recovery_note'] = 'both_neither_or_identity_mismatch_preserved'
        _write_json(path, journal)
        return journal


def purge(*args, **kwargs):
    raise CleanupError('permanent_deletion_not_supported')


def _slot(now):
    zone = timezone(timedelta(hours=8))
    current = datetime.fromtimestamp(now, zone)
    sunday = (current - timedelta(days=(current.weekday() + 1) % 7)).replace(hour=10, minute=0, second=0, microsecond=0)
    if sunday > current:
        sunday -= timedelta(days=7)
    return sunday.timestamp()


def scheduled_report(root, state_dir, snapshot=None, now=None):
    now = _now(now)
    root, identity = _root(root)
    state = _state(root, state_dir)
    with _lock(state) as state_fd:
        index_path = state / 'report-index.json'
        previous = _read_json(index_path) if index_path.exists() else None
        if previous and previous.get('root_identity') != identity:
            raise CleanupError('report_root_binding_changed')
        slot = _slot(now)
        if previous and slot <= previous['slot']:
            return {**previous, 'duplicate': True, 'notify': False}
        report = scan(root, now, snapshot)
        filesystem = os.statvfs(root)
        payload_files, payload_bytes = 0, 0
        with os.scandir(state_fd) as batch_entries:
            for batch in batch_entries:
                bst = os.stat(batch.name, dir_fd=state_fd, follow_symlinks=False)
                if re.fullmatch(r'[0-9a-f]{32}', batch.name) and stat.S_ISDIR(bst.st_mode):
                    batch_fd = os.open(batch.name, DIR_FLAGS, dir_fd=state_fd)
                    try:
                        with os.scandir(batch_fd) as payload_entries:
                            for payload in payload_entries:
                                pst = os.stat(payload.name, dir_fd=batch_fd, follow_symlinks=False)
                                if payload.name.endswith('.payload') and stat.S_ISREG(pst.st_mode):
                                    payload_files += 1
                                    payload_bytes += pst.st_size
                    finally:
                        os.close(batch_fd)
        storage = {'filesystem_available_bytes': filesystem.f_bavail * filesystem.f_frsize,
                   'quarantine_payload_files': payload_files, 'quarantine_logical_bytes': payload_bytes,
                   'note': 'allocated blocks and same-volume quarantine do not promise freed space'}
        previous_bytes = previous['scan']['summary']['logical_bytes'] if previous else report['summary']['logical_bytes']
        growth = report['summary']['logical_bytes'] - previous_bytes
        signature = _digest({'errors': report['errors'], 'eligible': report['summary']['eligible_files']})
        missed = max(0, int((slot - previous['slot']) // (7 * DAY)) - 1) if previous else 0
        result = {'schema_version': 1, 'root_identity': identity, 'slot': slot,
                  'generated_at': now, 'duplicate': False, 'missed_slots': missed,
                  'report_count': (previous['report_count'] if previous else 0) + 1,
                  'signature': signature, 'growth_bytes': growth,
                  'notify': (bool(report['errors']) and (not previous or previous['signature'] != signature)) or growth >= POLICY['growth_alert_bytes'],
                  'mode': 'readonly', 'storage': storage, 'scan': report}
        report_path = state / f'report-{int(slot)}.json'
        _write_json(report_path, result)
        _write_json(index_path, result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['scan', 'prepare', 'quarantine', 'restore', 'recover', 'report', 'policy', 'purge'])
    parser.add_argument('--root', type=Path)
    parser.add_argument('--state-dir', type=Path)
    parser.add_argument('--snapshot', type=Path)
    parser.add_argument('--evidence', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--approval', type=Path)
    parser.add_argument('--batch-id')
    parser.add_argument('--output', type=Path, help='scan/prepare JSON output only; use an explicitly approved path outside scanned user data')
    parser.add_argument('--summary', action='store_true', help='omit per-file scan rows on stdout')
    args = parser.parse_args(argv)
    try:
        if args.output and args.action not in ('scan', 'prepare'):
            raise CleanupError('output_flag_only_for_readonly_commands')
        if args.action == 'policy':
            result = {**POLICY, 'policy_hash': POLICY_HASH}
        elif args.action == 'purge':
            purge()
        else:
            if args.root is None:
                raise CleanupError('root_required')
            root = args.root
            state = args.state_dir or root / STATE_NAME
            snapshot = _read_json(args.snapshot) if args.snapshot else None
            if args.action == 'scan': result = scan(root, snapshot=snapshot)
            elif args.action == 'prepare': result = prepare(root, _read_json(args.evidence), snapshot=snapshot)
            elif args.action == 'quarantine': result = quarantine(root, state, _read_json(args.manifest), _read_json(args.approval), _read_json(args.evidence), snapshot=snapshot)
            elif args.action == 'restore': result = restore(root, state, args.batch_id, _read_json(args.approval))
            elif args.action == 'recover': result = recover(root, state, args.batch_id)
            else: result = scheduled_report(root, state, snapshot=snapshot)
        if args.output:
            if args.action not in ('scan', 'prepare'):
                raise CleanupError('output_flag_only_for_readonly_commands')
            # Exclusive creation only: an existing user file is never replaced.
            with open(args.output, 'x', encoding='utf-8') as stream:
                json.dump(result, stream, ensure_ascii=False, indent=2, allow_nan=False)
                stream.write('\n')
        if args.summary:
            result = dict(result)
            if 'scan' in result:
                result['scan'] = {k: v for k, v in result['scan'].items() if k not in ('files', 'workspaces')}
            else:
                result.pop('files', None)
                result.pop('workspaces', None)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (CleanupError, OSError, ValueError, TypeError, KeyError) as exc:
        print(json.dumps({'error': str(exc), 'kind': type(exc).__name__}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
