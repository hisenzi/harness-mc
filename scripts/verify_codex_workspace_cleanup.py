"""Independent acceptance tests for the Codex workspace cleanup public API.

Run: CLEANUP_MODULE=/absolute/path/codex_workspace_cleanup.py python3 THIS_FILE
All user-data mutations take place in disposable synthetic trees. No actual
Codex task database, schedule, or user workspace is read or modified.
"""

import copy
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
MODULE_PATH = Path(os.environ.get("CLEANUP_MODULE", Path(__file__).with_name("codex_workspace_cleanup.py")))
MODULE = None
IMPORT_ERROR = None
if MODULE_PATH.is_file():
    try:
        spec = importlib.util.spec_from_file_location("cleanup_under_acceptance", MODULE_PATH)
        MODULE = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = MODULE
        spec.loader.exec_module(MODULE)
    except Exception as exc:
        IMPORT_ERROR = repr(exc)
        MODULE = None

NOW = 1_800_000_000.0
DAY = 86400
OLD = NOW - 31 * DAY


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def tree_image(root):
    """Ignore access time; retain content and mutation-sensitive metadata."""
    rows = {}
    for parent, dirs, names in os.walk(root, followlinks=False):
        for name in ["."] + dirs + names:
            path = Path(parent) if name == "." else Path(parent, name)
            rel = str(path.relative_to(root))
            st = path.lstat()
            rows[rel] = (st.st_dev, st.st_ino, st.st_mode, st.st_size,
                         st.st_mtime_ns, digest(path) if stat.S_ISREG(st.st_mode) else None,
                         os.readlink(path) if stat.S_ISLNK(st.st_mode) else None)
    return rows


class ImplementationAvailability(unittest.TestCase):
    def test_implementation_is_available(self):
        self.assertTrue(MODULE_PATH.is_file(), f"implementation missing: {MODULE_PATH}")
        self.assertIsNotNone(MODULE, f"implementation failed to load: {IMPORT_ERROR}")


@unittest.skipUnless(MODULE is not None, "implementation unavailable; availability test supplies RED")
class CleanupAcceptance(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="cleanup-acceptance-")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.root = self.base / "Codex"
        self.workspace = "2026-07-01/synthetic-task"
        self.ws = self.root / self.workspace
        self.work = self.ws / "work"
        self.outputs = self.ws / "outputs"
        self.work.mkdir(parents=True)
        self.outputs.mkdir()
        self.path = self.work / "disposable.txt"
        self.rel = f"{self.workspace}/work/disposable.txt"
        self.path.write_bytes(b"synthetic rebuildable content\n")
        self.result = self.outputs / "keep.txt"
        self.result.write_bytes(b"synthetic user deliverable\n")
        os.utime(self.path, (OLD, OLD))
        os.utime(self.result, (OLD, OLD))
        self.state_dir = self.root / ".workspace-cleanup"
        st = self.root.lstat()
        self.root_identity = {"dev": st.st_dev, "ino": st.st_ino}
        self.snapshot = {
            "captured_at": NOW,
            "coverage": "partial",
            "threads": [{"cwd": self.workspace, "active": False, "pinned": False,
                         "last_activity_at": OLD}],
            "protected_paths": [],
        }
        self.evidence = {
            "root_identity": dict(self.root_identity), "checked_at": NOW,
            "source": "fixture review",
            "items": [{"path": self.rel, "references_verified": True,
                       "unreferenced": True, "not_in_use": True,
                       "manual_edits": False, "unique": False,
                       "last_activity_at": OLD, "activity_confident": True,
                       "purpose": "temporary", "disposition": "rebuildable",
                       "rebuild": {"source": "fixture", "version": "1",
                                   "inputs": "fixture recipe"},
                       "quiet_until": NOW + 300}],
        }

    def prepare(self, evidence=None, snapshot=None, now=NOW):
        return MODULE.prepare(self.root, self.evidence if evidence is None else evidence,
                              snapshot=self.snapshot if snapshot is None else snapshot, now=now)

    def approval(self, manifest, action="quarantine", batch_id=None, **updates):
        value = {"schema_version": 1, "action": action,
                 "manifest_digest": manifest["digest"], "issued_at": NOW,
                 "expires_at": NOW + 3600, "authorized_by": "Vincent",
                 "authority_ref": "fixture:explicit-approval"}
        if batch_id is not None:
            value["batch_id"] = batch_id
        value.update(updates)
        return value

    def quarantine(self, manifest=None, approval=None, evidence=None, snapshot=None, now=NOW):
        manifest = self.prepare() if manifest is None else manifest
        return MODULE.quarantine(
            self.root, self.state_dir, manifest,
            self.approval(manifest) if approval is None else approval,
            self.evidence if evidence is None else evidence,
            snapshot=self.snapshot if snapshot is None else snapshot, now=now)

    def not_admitted(self, evidence=None, snapshot=None, path=None):
        try:
            manifest = self.prepare(evidence=evidence, snapshot=snapshot)
        except MODULE.CleanupError:
            return
        self.assertNotIn(self.rel if path is None else path,
                         [entry["path"] for entry in manifest["items"]])

    def test_01_scan_is_metadata_only_and_does_not_write_user_tree(self):
        before = tree_image(self.root)
        original_builtin_open = open
        original_io_open = io.open

        def guarded(opener):
            def inner(path, *args, **kwargs):
                if isinstance(path, (str, bytes, os.PathLike)):
                    resolved = Path(os.fsdecode(path)).absolute()
                    if resolved == self.root or self.root in resolved.parents:
                        self.fail(f"scan opened user content: {resolved}")
                return opener(path, *args, **kwargs)
            return inner

        with mock.patch("builtins.open", side_effect=guarded(original_builtin_open)), \
                mock.patch("io.open", side_effect=guarded(original_io_open)):
            report = MODULE.scan(self.root, now=NOW, snapshot=self.snapshot)
        self.assertEqual(before, tree_image(self.root))
        self.assertFalse(self.state_dir.exists())
        self.assertEqual(report["root_identity"]["dev"], self.root_identity["dev"])
        self.assertEqual(report["root_identity"]["ino"], self.root_identity["ino"])
        rows = {row["path"]: row for row in report["files"]}
        self.assertIn(self.rel, rows)
        self.assertTrue({"workspace", "category", "size", "allocated", "fingerprint", "state", "reason"} <= set(rows[self.rel]))
        self.assertNotIn(rows[self.rel]["state"], ("candidate", "eligible", "approved"))
        self.assertIn("summary", report)
        self.assertIn("workspaces", report)

    def test_02_partial_index_without_evidence_cannot_admit(self):
        evidence = copy.deepcopy(self.evidence)
        evidence["items"] = []
        self.not_admitted(evidence=evidence)

    def test_02_partial_index_with_exact_review_can_prepare(self):
        manifest = self.prepare()
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(manifest["root_identity"]["ino"], self.root_identity["ino"])
        self.assertEqual(Path(manifest["root_path"]), self.root)
        self.assertTrue(manifest["policy_hash"])
        self.assertTrue(manifest["digest"])
        self.assertEqual([entry["path"] for entry in manifest["items"]], [self.rel])
        self.assertEqual(manifest["items"][0]["sha256"], digest(self.path))
        self.assertTrue(manifest["items"][0]["parent_chain"])

    def test_02_active_pinned_shared_cwd_and_direct_references_win(self):
        for field in ("active", "pinned"):
            with self.subTest(field=field):
                snap = copy.deepcopy(self.snapshot)
                snap["threads"].append({"cwd": self.workspace, field: True, "last_activity_at": OLD})
                self.not_admitted(snapshot=snap)
        snap = copy.deepcopy(self.snapshot)
        snap["protected_paths"] = [self.rel]
        self.not_admitted(snapshot=snap)

    def test_02_missing_snapshot_prevents_mutation_admission(self):
        try:
            manifest = MODULE.prepare(self.root, self.evidence, snapshot=None, now=NOW)
        except MODULE.CleanupError:
            return
        with self.assertRaises(MODULE.CleanupError):
            MODULE.quarantine(self.root, self.state_dir, manifest, self.approval(manifest),
                              self.evidence, snapshot=None, now=NOW)
        self.assertTrue(self.path.exists())

    def test_02_unknown_thread_flags_are_not_inactive(self):
        for field, value in (("active", None), ("pinned", None), ("active", "false"), ("pinned", 0)):
            with self.subTest(field=field, value=value):
                snap = copy.deepcopy(self.snapshot)
                snap["threads"][0][field] = value
                self.not_admitted(snapshot=snap)
        for field in ("active", "pinned"):
            with self.subTest(missing=field):
                snap = copy.deepcopy(self.snapshot)
                del snap["threads"][0][field]
                self.not_admitted(snapshot=snap)

    def test_02_unlocatable_active_thread_cannot_be_silently_discarded(self):
        for cwd in (None, "", "../unknown-workspace"):
            with self.subTest(cwd=cwd):
                snap = copy.deepcopy(self.snapshot)
                snap["threads"].append({"cwd": cwd, "active": True, "pinned": False,
                                         "last_activity_at": NOW})
                self.not_admitted(snapshot=snap)

    def test_02_stale_future_or_unknown_snapshot_and_review_time_are_rejected(self):
        for timestamp in (NOW - 301, NOW + 1, None, "yesterday", float("nan")):
            with self.subTest(snapshot_time=timestamp):
                snap = copy.deepcopy(self.snapshot)
                snap["captured_at"] = timestamp
                self.not_admitted(snapshot=snap)
            with self.subTest(review_time=timestamp):
                evidence = copy.deepcopy(self.evidence)
                evidence["checked_at"] = timestamp
                self.not_admitted(evidence=evidence)

    def test_03_unique_manual_original_and_incomplete_rebuild_are_not_admitted(self):
        variants = [
            ("unique", True), ("manual_edits", True), ("purpose", "original"),
            ("unreferenced", False), ("references_verified", False),
            ("not_in_use", False), ("rebuild", {"source": "fixture"}),
        ]
        for field, value in variants:
            with self.subTest(field=field):
                evidence = copy.deepcopy(self.evidence)
                evidence["items"][0][field] = value
                self.not_admitted(evidence=evidence)

    def test_03_outputs_are_protected_even_with_review(self):
        evidence = copy.deepcopy(self.evidence)
        out_rel = str(self.result.relative_to(self.root))
        evidence["items"][0]["path"] = out_rel
        self.not_admitted(evidence=evidence, path=out_rel)

    def copied_evidence(self):
        retained = self.outputs / "retained-copy.txt"
        retained.write_bytes(self.path.read_bytes())
        evidence = copy.deepcopy(self.evidence)
        entry = evidence["items"][0]
        entry.pop("rebuild")
        entry["disposition"] = "verified_copy"
        entry["copy"] = {"path": str(retained.relative_to(self.root)),
                         "verified_at": NOW, "retained": True}
        return retained, evidence

    def test_03_verified_retained_copy_can_qualify_and_remains_readable(self):
        retained, evidence = self.copied_evidence()
        before = digest(retained)
        manifest = self.prepare(evidence=evidence)
        self.assertIn(self.rel, [item["path"] for item in manifest["items"]])
        self.assertTrue(manifest.get("retained_copies"), "manifest must bind the verified retained copy")
        journal = self.quarantine(manifest, evidence=evidence)
        self.assertEqual(journal["items"][0]["state"], "quarantined")
        self.assertFalse(self.path.exists())
        self.assertEqual(digest(retained), before)

    def test_03_unverified_different_or_unprotected_copy_is_not_admitted(self):
        retained, evidence = self.copied_evidence()
        retained.write_text("different copy content")
        self.not_admitted(evidence=evidence)
        retained.write_bytes(self.path.read_bytes())
        evidence["items"][0]["copy"]["retained"] = False
        self.not_admitted(evidence=evidence)
        evidence["items"][0]["copy"]["retained"] = True
        evidence["items"][0]["copy"]["verified_at"] = NOW - 301
        self.not_admitted(evidence=evidence)
        evidence["items"][0]["copy"]["verified_at"] = NOW
        unprotected = self.work / "unprotected-copy.txt"
        retained.rename(unprotected)
        evidence["items"][0]["copy"]["path"] = str(unprotected.relative_to(self.root))
        self.not_admitted(evidence=evidence)

    def test_03_symlink_or_hardlink_copy_is_not_admitted(self):
        retained, evidence = self.copied_evidence()
        external = self.base / "external-copy.txt"
        retained.rename(external)
        retained.symlink_to(external)
        self.not_admitted(evidence=evidence)
        retained.unlink()
        os.link(external, retained)
        self.not_admitted(evidence=evidence)

    def test_06_retained_copy_replacement_invalidates_existing_approval(self):
        retained, evidence = self.copied_evidence()
        manifest = self.prepare(evidence=evidence)
        held = self.outputs / "held-old-copy.txt"
        retained.rename(held)
        retained.write_bytes(held.read_bytes())
        with self.assertRaises(MODULE.CleanupError):
            self.quarantine(manifest, evidence=evidence)
        self.assertTrue(self.path.exists())

    def test_06_retained_copy_content_change_invalidates_existing_approval(self):
        retained, evidence = self.copied_evidence()
        manifest = self.prepare(evidence=evidence)
        retained.write_text("changed retained copy")
        with self.assertRaises(MODULE.CleanupError):
            self.quarantine(manifest, evidence=evidence)
        self.assertTrue(self.path.exists())

    def test_06_retained_copy_review_expiry_during_final_hash_stops_move(self):
        retained, evidence = self.copied_evidence()
        evidence['items'][0]['copy']['verified_at'] = NOW - 299
        manifest = self.prepare(evidence=evidence)
        clock = [NOW]
        calls = [0]
        original_hash = MODULE._hash_at
        def slow_copy_hash(fd, name):
            result = original_hash(fd, name)
            if name == retained.name:
                calls[0] += 1
                if calls[0] == 3:
                    clock[0] = NOW + 2
            return result
        with mock.patch.object(MODULE.time, 'time', side_effect=lambda: clock[0]), \
                mock.patch.object(MODULE, '_hash_at', side_effect=slow_copy_hash), \
                mock.patch.object(MODULE, '_rename_exclusive', wraps=MODULE._rename_exclusive) as move:
            with self.assertRaises(MODULE.CleanupError):
                MODULE.quarantine(self.root, self.state_dir, manifest, self.approval(manifest),
                                  evidence, snapshot=self.snapshot)
            move.assert_not_called()
        self.assertGreaterEqual(calls[0], 3)
        self.assertTrue(self.path.exists())

    def test_04_thirty_day_threshold_uses_elapsed_time(self):
        for age, allowed in ((30 * DAY - 1, False), (30 * DAY, True), (30 * DAY + 1, True)):
            with self.subTest(age=age):
                os.utime(self.path, (NOW - age, NOW - age))
                evidence = copy.deepcopy(self.evidence)
                evidence["items"][0]["last_activity_at"] = NOW - age
                if allowed:
                    self.assertIn(self.rel, [item["path"] for item in self.prepare(evidence=evidence)["items"]])
                else:
                    self.not_admitted(evidence=evidence)

    def test_04_unknown_and_future_activity_are_not_admitted(self):
        for value in (None, NOW + 1):
            with self.subTest(value=value):
                evidence = copy.deepcopy(self.evidence)
                evidence["items"][0]["last_activity_at"] = value
                self.not_admitted(evidence=evidence)
        evidence = copy.deepcopy(self.evidence)
        evidence["items"][0]["activity_confident"] = False
        self.not_admitted(evidence=evidence)

    def test_04_ninety_day_empty_workspace_is_report_only(self):
        empty = self.root / "2025-01-01" / "empty-task"
        empty.mkdir(parents=True)
        os.utime(empty, (NOW - 100 * DAY, NOW - 100 * DAY))
        before = tree_image(self.root)
        MODULE.scan(self.root, now=NOW, snapshot=self.snapshot)
        self.assertEqual(before, tree_image(self.root))
        evidence = copy.deepcopy(self.evidence)
        rel = str(empty.relative_to(self.root))
        evidence["items"][0]["path"] = rel
        self.not_admitted(evidence=evidence, path=rel)

    def test_04_pruned_private_tree_cannot_be_reported_as_empty(self):
        self.path.unlink()
        self.result.unlink()
        private_dir = self.ws / ".codex"
        private_dir.mkdir()
        (private_dir / "auth.json").write_text("synthetic private fixture: do not read")
        report = MODULE.scan(self.root, now=NOW, snapshot=self.snapshot)
        entry = next(ws for ws in report["workspaces"] if ws["path"] == self.workspace)
        self.assertFalse(entry["empty_tree"], "a pruned private subtree is not known empty")

    def test_05_git_file_directory_and_nested_marker_protect_workspace(self):
        for marker, directory in ((self.ws / ".git", False), (self.ws / ".git", True),
                                  (self.work / "nested" / ".git", False)):
            with self.subTest(marker=str(marker), directory=directory):
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.mkdir() if directory else marker.write_text("gitdir: external-unread\n")
                self.not_admitted()
                marker.rmdir() if directory else marker.unlink()

    def test_05_git_ancestor_protects_candidate(self):
        (self.root / ".git").write_text("gitdir: do-not-read\n")
        self.not_admitted()

    def test_05_symlink_and_hardlink_never_become_candidates(self):
        outside = self.base / "outside.txt"
        outside.write_text("outside sentinel")
        self.path.unlink()
        self.path.symlink_to(outside)
        self.not_admitted()
        self.path.unlink()
        os.link(outside, self.path)
        os.utime(outside, (OLD, OLD))
        self.not_admitted()
        self.assertEqual(outside.read_text(), "outside sentinel")

    def test_05_absolute_parent_traversal_and_nul_paths_rejected(self):
        for rel in ("../outside.txt", str(self.path), f"{self.workspace}/work/../outputs/keep.txt", "x\x00y"):
            with self.subTest(path=repr(rel)):
                evidence = copy.deepcopy(self.evidence)
                evidence["items"][0]["path"] = rel
                self.not_admitted(evidence=evidence, path=rel)

    def test_05_root_symlink_is_rejected(self):
        alias = self.base / "root-alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(MODULE.CleanupError):
            MODULE.scan(alias, now=NOW, snapshot=self.snapshot)

    def test_05_current_working_directory_is_protected(self):
        previous = Path.cwd()
        try:
            os.chdir(self.ws)
            self.not_admitted()
        finally:
            os.chdir(previous)

    def test_05_cross_device_metadata_is_protected_without_following_mount(self):
        target_inode = self.path.stat().st_ino
        original_stat = os.stat

        class DifferentDevice:
            def __init__(self, real):
                self.real = real

            def __getattr__(self, key):
                return self.real.st_dev + 1 if key == "st_dev" else getattr(self.real, key)

            def __getitem__(self, index):
                return self.real.st_dev + 1 if index == 2 else self.real[index]

        def simulated_mount(*args, **kwargs):
            result = original_stat(*args, **kwargs)
            return DifferentDevice(result) if result.st_ino == target_inode else result

        with mock.patch.object(os, "stat", side_effect=simulated_mount):
            report = MODULE.scan(self.root, now=NOW, snapshot=self.snapshot)
            row = next(row for row in report["files"] if row["path"] == self.rel)
            self.assertEqual(row["state"], "protected")
            self.assertEqual(row["reason"], "cross_device")
            self.not_admitted()

    def test_06_expired_or_wrong_action_or_digest_approval_is_rejected(self):
        manifest = self.prepare()
        variants = ({"issued_at": NOW - 90000, "expires_at": NOW - 1},
                    {"issued_at": NOW - 1, "expires_at": NOW + 90000},
                    {"issued_at": NOW + 1}, {"action": "delete"},
                    {"manifest_digest": "0" * 64}, {"authority_ref": ""})
        for updates in variants:
            with self.subTest(updates=updates):
                with self.assertRaises(MODULE.CleanupError):
                    self.quarantine(manifest, self.approval(manifest, **updates))
                self.assertTrue(self.path.exists())

    def test_06_content_change_with_same_size_and_mtime_invalidates_manifest(self):
        manifest = self.prepare()
        original = self.path.read_bytes()
        self.path.write_bytes(b"x" * len(original))
        os.utime(self.path, (OLD, OLD))
        with self.assertRaises(MODULE.CleanupError):
            self.quarantine(manifest)
        self.assertEqual(self.path.read_bytes(), b"x" * len(original))

    def test_06_same_name_new_inode_invalidates_manifest(self):
        manifest = self.prepare()
        held = self.work / "held-original.txt"
        self.path.rename(held)
        self.path.write_bytes(held.read_bytes())
        os.utime(self.path, (OLD, OLD))
        with self.assertRaises(MODULE.CleanupError):
            self.quarantine(manifest)
        self.assertTrue(held.exists())
        self.assertTrue(self.path.exists())

    def test_06_resumed_task_and_expired_quiet_window_reject_batch(self):
        manifest = self.prepare()
        snap = copy.deepcopy(self.snapshot)
        snap["threads"][0]["active"] = True
        with self.assertRaises(MODULE.CleanupError):
            self.quarantine(manifest, snapshot=snap)
        evidence = copy.deepcopy(self.evidence)
        evidence["items"][0]["quiet_until"] = NOW - 1
        with self.assertRaises(MODULE.CleanupError):
            self.quarantine(manifest, evidence=evidence)
        self.assertTrue(self.path.exists())

    def test_06_root_identity_replacement_invalidates_entire_batch(self):
        manifest = self.prepare()
        held = self.base / "held-root"
        self.root.rename(held)
        self.root.mkdir()
        with self.assertRaises(MODULE.CleanupError):
            self.quarantine(manifest)
        self.assertTrue((held / self.rel).exists())

    def test_06_normal_root_mtime_change_does_not_invalidate_identity(self):
        manifest = self.prepare()
        (self.root / "unrelated-report.txt").write_text("unrelated root metadata change")
        journal = self.quarantine(manifest)
        self.assertEqual(journal["items"][0]["state"], "quarantined")

    def test_06_real_clock_expiry_during_hash_stops_before_move(self):
        for boundary in ("approval", "quiet_window", "snapshot_freshness"):
            with self.subTest(boundary=boundary):
                evidence = copy.deepcopy(self.evidence)
                if boundary == "quiet_window":
                    evidence["items"][0]["quiet_until"] = NOW + 1
                elif boundary == "snapshot_freshness":
                    evidence["items"][0]["quiet_until"] = NOW + 600
                manifest = self.prepare(evidence=evidence)
                approval = self.approval(manifest)
                if boundary == "approval":
                    approval["expires_at"] = NOW + 1
                clock = {"value": NOW, "pending": False, "advanced": False}
                original_write = MODULE._write_json
                original_hash = MODULE._hash_at

                def durable_pending(path, value):
                    result = original_write(path, value)
                    if isinstance(value, dict) and value.get("batch_id"):
                        clock["pending"] = True
                    return result

                def hash_consumes_time(*args, **kwargs):
                    result = original_hash(*args, **kwargs)
                    if clock["pending"]:
                        clock["value"] = NOW + (301 if boundary == "snapshot_freshness" else 2)
                        clock["advanced"] = True
                    return result

                with mock.patch.object(MODULE.time, "time", side_effect=lambda: clock["value"]), \
                        mock.patch.object(MODULE, "_write_json", side_effect=durable_pending), \
                        mock.patch.object(MODULE, "_hash_at", side_effect=hash_consumes_time), \
                        mock.patch.object(MODULE, "_rename_exclusive") as move:
                    with self.assertRaises(MODULE.CleanupError):
                        MODULE.quarantine(self.root, self.state_dir, manifest, approval,
                                          evidence, snapshot=self.snapshot, now=None)
                    move.assert_not_called()
                self.assertTrue(clock["advanced"], "fixture must advance the live clock during work")
                self.assertTrue(self.path.exists())

    def test_06_changed_review_or_rebuild_version_invalidates_approval(self):
        manifest = self.prepare()
        for field in ("version", "checked_at"):
            with self.subTest(field=field):
                evidence = copy.deepcopy(self.evidence)
                if field == "version":
                    evidence["items"][0]["rebuild"]["version"] = "2"
                else:
                    evidence["checked_at"] = NOW - 1
                with self.assertRaises(MODULE.CleanupError):
                    self.quarantine(manifest, evidence=evidence)
                self.assertTrue(self.path.exists())

    def test_07_quarantine_and_recovery_are_non_destructive_and_idempotent(self):
        manifest = self.prepare()
        expected = digest(self.path)
        journal = self.quarantine(manifest)
        self.assertFalse(self.path.exists())
        self.assertEqual(journal["items"][0]["path"], self.rel)
        self.assertEqual(journal["items"][0]["state"], "quarantined")
        self.assertEqual(journal["items"][0]["quarantined_at"], NOW)
        self.assertEqual(stat.S_IMODE(self.state_dir.lstat().st_mode), 0o700)
        recovered = MODULE.recover(self.root, self.state_dir, journal["batch_id"], now=NOW + 60)
        self.assertEqual(recovered["items"][0]["state"], "quarantined")
        self.assertEqual(recovered["items"][0]["quarantined_at"], NOW)
        matches = [p for p in self.state_dir.rglob("*") if p.is_file() and digest(p) == expected]
        self.assertEqual(len(matches), 1)

    def test_07_retention_starts_when_move_finishes_not_when_it_started(self):
        manifest = self.prepare()
        clock = {"value": NOW}
        original_rename = MODULE._rename_exclusive

        def slow_successful_move(*args):
            result = original_rename(*args)
            clock["value"] = NOW + 5
            return result

        with mock.patch.object(MODULE.time, "time", side_effect=lambda: clock["value"]), \
                mock.patch.object(MODULE, "_rename_exclusive", side_effect=slow_successful_move):
            journal = MODULE.quarantine(self.root, self.state_dir, manifest, self.approval(manifest),
                                        self.evidence, snapshot=self.snapshot, now=None)
        self.assertGreaterEqual(journal["items"][0]["quarantined_at"], NOW + 5)
        self.assertGreaterEqual(journal["items"][0]["minimum_retention_until"], NOW + 5 + 30 * DAY)

    def test_07_impossible_journal_retention_time_is_rejected_or_reestablished(self):
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        journal_path = next(path for path in self.state_dir.rglob("*.json")
                            if json.loads(path.read_text()).get("batch_id") == journal["batch_id"])
        persisted = json.loads(journal_path.read_text())
        persisted["items"][0]["quarantined_at"] = NOW - 40 * DAY
        persisted["items"][0]["minimum_retention_until"] = NOW - 10 * DAY
        journal_path.write_text(json.dumps(persisted))
        try:
            recovered = MODULE.recover(self.root, self.state_dir, journal["batch_id"], now=NOW + 60)
        except MODULE.CleanupError:
            return
        self.assertGreaterEqual(recovered["items"][0]["quarantined_at"], NOW + 60)
        self.assertGreaterEqual(recovered["items"][0]["minimum_retention_until"], NOW + 60 + 30 * DAY)

    def test_07_state_outside_fixed_directory_and_symlink_state_are_rejected(self):
        manifest = self.prepare()
        outside = self.base / "outside-state"
        outside.mkdir()
        for state_dir in (outside, self.root / "different-state"):
            with self.subTest(path=state_dir):
                with self.assertRaises(MODULE.CleanupError):
                    MODULE.quarantine(self.root, state_dir, manifest, self.approval(manifest),
                                      self.evidence, snapshot=self.snapshot, now=NOW)
        self.state_dir.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(MODULE.CleanupError):
            self.quarantine(manifest)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertTrue(self.path.exists())

    def test_07_pending_journal_must_persist_before_any_rename(self):
        manifest = self.prepare()
        expected = digest(self.path)
        original_write = MODULE._write_json
        pending_seen = []

        def fail_pending(path, value):
            if isinstance(value, dict) and any(
                    item.get("state") == "pending" for item in value.get("items", [])):
                pending_seen.append(copy.deepcopy(value))
                raise OSError("fixture: pending journal cannot be persisted")
            return original_write(path, value)

        with mock.patch.object(MODULE, "_write_json", side_effect=fail_pending), \
                mock.patch.object(MODULE, "_rename_exclusive") as move:
            with self.assertRaises((MODULE.CleanupError, OSError)):
                self.quarantine(manifest)
            move.assert_not_called()
        self.assertTrue(pending_seen, "test must reach the pending journal write seam")
        self.assertEqual(digest(self.path), expected)

    def test_07_pending_journal_fsync_failure_permits_zero_moves(self):
        manifest = self.prepare()
        with mock.patch.object(MODULE.os, "fsync", side_effect=OSError("fixture: fsync failed")), \
                mock.patch.object(MODULE, "_rename_exclusive") as move:
            with self.assertRaises((MODULE.CleanupError, OSError)):
                self.quarantine(manifest)
            move.assert_not_called()
        self.assertTrue(self.path.exists())

    def test_07_directory_fsync_failure_after_move_is_recoverable(self):
        manifest = self.prepare()
        original_write = MODULE._write_json
        original_rename = MODULE._rename_exclusive
        original_fsync = MODULE.os.fsync
        progress = {"moved": False, "batch_id": None}

        def save_batch(path, value):
            result = original_write(path, value)
            if isinstance(value, dict) and value.get("batch_id"):
                progress["batch_id"] = value["batch_id"]
            return result

        def move_then_fail_sync(*args):
            result = original_rename(*args)
            progress["moved"] = True
            return result

        def fail_post_move(fd):
            if progress["moved"]:
                raise OSError("fixture: post-move directory fsync failed")
            return original_fsync(fd)

        with mock.patch.object(MODULE, "_write_json", side_effect=save_batch), \
                mock.patch.object(MODULE, "_rename_exclusive", side_effect=move_then_fail_sync), \
                mock.patch.object(MODULE.os, "fsync", side_effect=fail_post_move):
            with self.assertRaises((MODULE.CleanupError, OSError)):
                self.quarantine(manifest)
        self.assertTrue(progress["moved"])
        recovered = MODULE.recover(self.root, self.state_dir, progress["batch_id"], now=NOW + 120)
        self.assertEqual(recovered["items"][0]["state"], "quarantined")
        self.assertEqual(recovered["items"][0]["quarantined_at"], NOW + 120)

    def test_07_post_rename_journal_failure_recovers_with_conservative_timestamp(self):
        manifest = self.prepare()
        expected = digest(self.path)
        original_write = MODULE._write_json
        original_rename = MODULE._rename_exclusive
        progress = {"moved": False, "pending_persisted": False, "batch_id": None}

        def record_or_fail(path, value):
            if progress["moved"]:
                raise OSError("fixture: completion journal write failed")
            result = original_write(path, value)
            if isinstance(value, dict) and "batch_id" in value and any(
                    item.get("state") == "pending" for item in value.get("items", [])):
                progress["pending_persisted"] = True
                progress["batch_id"] = value["batch_id"]
            return result

        def move_after_durable_pending(*args):
            self.assertTrue(progress["pending_persisted"], "move preceded durable pending journal")
            result = original_rename(*args)
            progress["moved"] = True
            return result

        with mock.patch.object(MODULE, "_write_json", side_effect=record_or_fail), \
                mock.patch.object(MODULE, "_rename_exclusive", side_effect=move_after_durable_pending):
            with self.assertRaises((MODULE.CleanupError, OSError)):
                self.quarantine(manifest)
        self.assertTrue(progress["moved"], "fault must happen after an actual move")
        self.assertFalse(self.path.exists())
        self.assertIsNotNone(progress["batch_id"])
        recovery_time = NOW + 120
        recovered = MODULE.recover(self.root, self.state_dir, progress["batch_id"], now=recovery_time)
        self.assertEqual(recovered["items"][0]["state"], "quarantined")
        self.assertEqual(recovered["items"][0]["quarantined_at"], recovery_time)
        matches = [p for p in self.state_dir.rglob("*") if p.is_file() and digest(p) == expected]
        self.assertEqual(len(matches), 1)
        repeated = MODULE.recover(self.root, self.state_dir, progress["batch_id"], now=NOW + 240)
        self.assertEqual(repeated["items"][0]["quarantined_at"], recovery_time)

    def test_07_journal_failure_stops_remaining_items_in_batch(self):
        second = self.work / "second-disposable.txt"
        second.write_text("second fixture content")
        os.utime(second, (OLD, OLD))
        evidence = copy.deepcopy(self.evidence)
        second_evidence = copy.deepcopy(evidence["items"][0])
        second_evidence["path"] = str(second.relative_to(self.root))
        evidence["items"].append(second_evidence)
        manifest = self.prepare(evidence=evidence)
        self.assertEqual(len(manifest["items"]), 2)
        original_write = MODULE._write_json
        original_rename = MODULE._rename_exclusive
        progress = {"move_count": 0}

        def fail_after_first_move(path, value):
            if progress["move_count"]:
                raise OSError("fixture: journal unavailable after first item")
            return original_write(path, value)

        def count_move(*args):
            result = original_rename(*args)
            progress["move_count"] += 1
            return result

        with mock.patch.object(MODULE, "_write_json", side_effect=fail_after_first_move), \
                mock.patch.object(MODULE, "_rename_exclusive", side_effect=count_move):
            with self.assertRaises((MODULE.CleanupError, OSError)):
                self.quarantine(manifest, evidence=evidence)
        self.assertEqual(progress["move_count"], 1)
        self.assertEqual(sum(path.exists() for path in (self.path, second)), 1)

    def test_07_existing_lock_is_preserved_and_no_move_occurs(self):
        manifest = self.prepare()
        self.state_dir.mkdir(mode=0o700)
        lock = self.state_dir / "operation.lock"
        fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            before = lock.stat().st_ino
            with self.assertRaises(MODULE.CleanupError):
                self.quarantine(manifest)
            self.assertEqual(lock.stat().st_ino, before)
            self.assertTrue(self.path.exists())
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def test_07_replaced_lock_is_not_removed_by_previous_holder(self):
        manifest = self.prepare()
        original_write = MODULE._write_json
        changed = []

        def replace_lock_then_fail(path, value):
            result = original_write(path, value)
            if isinstance(value, dict) and value.get("batch_id") and not changed:
                lock = self.state_dir / "operation.lock"
                lock.rename(self.state_dir / "held-original-lock")
                fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
                os.close(fd)
                changed.append(lock.stat().st_ino)
                raise OSError("fixture: lock identity changed during journal persistence")
            return result

        with mock.patch.object(MODULE, "_write_json", side_effect=replace_lock_then_fail):
            with self.assertRaises((MODULE.CleanupError, OSError)):
                self.quarantine(manifest)
        self.assertTrue(changed)
        lock = self.state_dir / "operation.lock"
        self.assertTrue(lock.exists(), "previous holder must not remove a replacement lock")
        self.assertEqual(lock.stat().st_ino, changed[0])
        self.assertTrue(self.path.exists())

    def test_07_state_symlink_swap_cannot_redirect_journal_writes(self):
        manifest = self.prepare()
        outside = self.base / "external-state-sentinel"
        outside.mkdir(mode=0o700)
        original_state = MODULE._state
        swapped = []

        def swap_after_state_check(root, state_dir):
            state = original_state(root, state_dir)
            state.rename(self.root / "held-state")
            state.symlink_to(outside, target_is_directory=True)
            swapped.append(True)
            return state

        with mock.patch.object(MODULE, "_state", side_effect=swap_after_state_check):
            with self.assertRaises((MODULE.CleanupError, OSError)):
                self.quarantine(manifest)
        self.assertTrue(swapped)
        self.assertEqual(list(outside.iterdir()), [], "state replacement caused writes outside the root")
        self.assertTrue(self.path.exists())

    def test_08_restore_preserves_content_mode_mtime_and_deliverable(self):
        os.chmod(self.path, 0o640)
        expected = (digest(self.path), stat.S_IMODE(self.path.stat().st_mode), self.path.stat().st_mtime_ns)
        deliverable = digest(self.result)
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        approval = self.approval(manifest, "restore", journal["batch_id"])
        MODULE.restore(self.root, self.state_dir, journal["batch_id"], approval, now=NOW + 60)
        self.assertEqual((digest(self.path), stat.S_IMODE(self.path.stat().st_mode), self.path.stat().st_mtime_ns), expected)
        self.assertEqual(digest(self.result), deliverable)

    def test_08_restore_never_overwrites_new_original_path(self):
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        self.path.write_text("new user content")
        approval = self.approval(manifest, "restore", journal["batch_id"])
        try:
            result = MODULE.restore(self.root, self.state_dir, journal["batch_id"], approval, now=NOW + 60)
        except MODULE.CleanupError:
            pass
        else:
            self.assertNotEqual(result["items"][0]["state"], "restored")
        self.assertEqual(self.path.read_text(), "new user content")
        expected = manifest["items"][0]["sha256"]
        self.assertTrue(any(p.is_file() and digest(p) == expected for p in self.state_dir.rglob("*")))

    def test_08_parent_symlink_substitution_stops_restore(self):
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        held = self.ws / "held-work"
        self.work.rename(held)
        outside = self.base / "external-parent"
        outside.mkdir()
        self.work.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(MODULE.CleanupError):
            MODULE.restore(self.root, self.state_dir, journal["batch_id"],
                           self.approval(manifest, "restore", journal["batch_id"]), now=NOW + 60)
        self.assertEqual(list(outside.iterdir()), [])

    def test_08_wrong_batch_or_action_cannot_restore(self):
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        for approval in (self.approval(manifest), self.approval(manifest, "restore", "wrong-batch")):
            with self.subTest(approval=approval):
                with self.assertRaises(MODULE.CleanupError):
                    MODULE.restore(self.root, self.state_dir, journal["batch_id"], approval, now=NOW + 60)
        self.assertFalse(self.path.exists())

    def test_08_restore_approval_expiring_during_hash_stops_before_move(self):
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        approval = self.approval(manifest, "restore", journal["batch_id"], expires_at=NOW + 1)
        clock = {"value": NOW}
        original_hash = MODULE._hash_at

        def slow_hash(*args, **kwargs):
            result = original_hash(*args, **kwargs)
            clock["value"] = NOW + 2
            return result

        with mock.patch.object(MODULE.time, "time", side_effect=lambda: clock["value"]), \
                mock.patch.object(MODULE, "_hash_at", side_effect=slow_hash), \
                mock.patch.object(MODULE, "_rename_exclusive") as move:
            with self.assertRaises(MODULE.CleanupError):
                MODULE.restore(self.root, self.state_dir, journal["batch_id"], approval, now=None)
            move.assert_not_called()
        self.assertFalse(self.path.exists())

    def test_08_repeated_restore_cannot_reaffirm_a_now_missing_original(self):
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        approval = self.approval(manifest, "restore", journal["batch_id"])
        MODULE.restore(self.root, self.state_dir, journal["batch_id"], approval, now=NOW + 60)
        self.path.unlink()
        try:
            result = MODULE.restore(self.root, self.state_dir, journal["batch_id"], approval, now=NOW + 120)
        except MODULE.CleanupError:
            return
        self.assertNotEqual(result["items"][0]["state"], "restored",
                            "a previous receipt is not proof that the restored original still exists")

    def test_08_atomic_restore_does_not_clobber_commit_time_collision(self):
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        original_rename = MODULE._rename_exclusive
        collision = b"new content created at restore commit\n"
        injected = []

        def race_destination(src_fd, src_name, dst_fd, dst_name):
            fd = os.open(dst_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=dst_fd)
            try:
                os.write(fd, collision)
            finally:
                os.close(fd)
            injected.append(dst_name)
            return original_rename(src_fd, src_name, dst_fd, dst_name)

        with mock.patch.object(MODULE, "_rename_exclusive", side_effect=race_destination):
            try:
                result = MODULE.restore(self.root, self.state_dir, journal["batch_id"],
                                        self.approval(manifest, "restore", journal["batch_id"]), now=NOW + 60)
            except (MODULE.CleanupError, OSError):
                pass
            else:
                self.assertNotEqual(result["items"][0]["state"], "restored")
        self.assertTrue(injected, "test must inject collision at the commit operation")
        self.assertEqual(self.path.read_bytes(), collision)
        expected = manifest["items"][0]["sha256"]
        self.assertTrue(any(p.is_file() and digest(p) == expected for p in self.state_dir.rglob("*")))

    def test_08_recover_preserves_both_ends_when_original_is_recreated(self):
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        self.path.write_text("concurrent replacement, preserve me")
        try:
            recovered = MODULE.recover(self.root, self.state_dir, journal["batch_id"], now=NOW + 60)
        except MODULE.CleanupError:
            pass
        else:
            self.assertEqual(recovered["items"][0]["state"], "conflict")
        self.assertEqual(self.path.read_text(), "concurrent replacement, preserve me")
        expected = manifest["items"][0]["sha256"]
        self.assertTrue(any(p.is_file() and digest(p) == expected for p in self.state_dir.rglob("*")))

    def test_08_corrupted_journal_cannot_change_approved_restore_path(self):
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        candidates = []
        for path in self.state_dir.rglob("*.json"):
            value = json.loads(path.read_text())
            if isinstance(value, dict) and value.get("batch_id") == journal["batch_id"] and "items" in value:
                candidates.append((path, value))
        self.assertEqual(len(candidates), 1)
        journal_path, persisted = candidates[0]
        unapproved = self.work / "unapproved-destination.txt"
        persisted["items"][0]["path"] = str(unapproved.relative_to(self.root))
        journal_path.write_text(json.dumps(persisted))
        with self.assertRaises(MODULE.CleanupError):
            MODULE.restore(self.root, self.state_dir, journal["batch_id"],
                           self.approval(manifest, "restore", journal["batch_id"]), now=NOW + 60)
        self.assertFalse(unapproved.exists())
        self.assertFalse(self.path.exists())
        expected = manifest["items"][0]["sha256"]
        self.assertTrue(any(p.is_file() and digest(p) == expected for p in self.state_dir.rglob("*")))

    def test_09_purge_cannot_delete_even_after_retention(self):
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        for now in (NOW + 29 * DAY, NOW + 30 * DAY, NOW + 100 * DAY):
            with self.subTest(now=now):
                with self.assertRaises(MODULE.CleanupError):
                    MODULE.purge(self.root, self.state_dir, journal["batch_id"], now=now)
        self.assertTrue(self.state_dir.exists())

    def test_10_repeated_and_late_readonly_runs_never_upgrade_authority(self):
        before = tree_image(self.root)
        for now in (NOW, NOW, NOW + 7 * DAY, NOW + 21 * DAY):
            MODULE.scan(self.root, now=now, snapshot=self.snapshot)
        self.assertEqual(before, tree_image(self.root))
        self.assertFalse(self.state_dir.exists())

    def test_10_scheduled_reports_deduplicate_slots_and_only_catch_up_once(self):
        before = tree_image(self.ws)
        first = MODULE.scheduled_report(self.root, self.state_dir, snapshot=self.snapshot, now=NOW)
        self.assertTrue({"slot", "duplicate", "missed_slots", "report_count", "notify", "scan"} <= set(first))
        self.assertFalse(first["duplicate"])
        self.assertEqual(first["report_count"], 1)
        self.assertEqual(first["missed_slots"], 0)
        duplicate = MODULE.scheduled_report(self.root, self.state_dir, snapshot=self.snapshot, now=NOW + 1)
        self.assertEqual(duplicate["slot"], first["slot"])
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["report_count"], 1)
        self.assertFalse(duplicate["notify"])
        late = MODULE.scheduled_report(self.root, self.state_dir, snapshot=self.snapshot, now=NOW + 28 * DAY)
        self.assertFalse(late["duplicate"])
        self.assertNotEqual(late["slot"], first["slot"])
        self.assertEqual(late["missed_slots"], 3)
        self.assertEqual(late["report_count"], 2)
        third = MODULE.scheduled_report(self.root, self.state_dir, snapshot=self.snapshot, now=NOW + 35 * DAY)
        self.assertEqual(third["report_count"], 3)
        self.assertEqual(tree_image(self.ws), before)
        for result in (first, late, third):
            for entry in result["scan"]["files"]:
                self.assertNotIn(entry["state"], ("approved", "quarantined", "restored"))
        self.assertTrue(self.path.exists())
        self.assertTrue(self.result.exists())

    def test_11_old_deliverable_link_survives_other_file_round_trip(self):
        old_link = str(self.result.resolve())
        expected = digest(self.result)
        manifest = self.prepare()
        journal = self.quarantine(manifest)
        self.assertEqual(digest(old_link), expected)
        MODULE.restore(self.root, self.state_dir, journal["batch_id"],
                       self.approval(manifest, "restore", journal["batch_id"]), now=NOW + 60)
        self.assertEqual(digest(old_link), expected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
