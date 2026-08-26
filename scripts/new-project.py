#!/usr/bin/env python3
"""
new-project.py — 開案自動化（MC 版）
自動建立 Mission Control 專案目錄（harness-mc/milestones/{id}/），
產生 project.json + tasks.json（含 done_condition + phase-verify），
同步到 Obsidian，並 rebuild MC 儀表板。
standalone 只描述預計的專案型態；只有精準 Vincent repo receipt 才建立 GitHub repo。

用法：
  python3 scripts/new-project.py --id "my-project" --name "我的專案" --desc "一句話說明" --type internal \\
    --problem "要解決的問題" --impact "不解決的影響" --metric "衡量指標" \\
    --baseline "目前基準" --target "量化目標" --due "2026-08-31" --measurement-source "資料來源或驗證指令"
  python3 scripts/new-project.py --id "my-app" --name "我的應用" --desc "說明" --type standalone \\
    --problem "要解決的問題" --impact "不解決的影響" --metric "衡量指標" \\
    --baseline "目前基準" --target "量化目標" --due "2026-08-31" --measurement-source "資料來源或驗證指令"
  python3 scripts/new-project.py formalize --id "my-project" --formalize-file /path/to/formalize.json
  python3 scripts/new-project.py promote --id "my-project" --repo-create-receipt /path/to/receipt.json
"""

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

MC_DIR       = Path(__file__).resolve().parent.parent
COLLAB_DIR   = MC_DIR.parent
AGENT_DIR    = COLLAB_DIR / "notyet-harness" / "000_Agent"
PROJECTS_DIR = MC_DIR / "milestones"
SYNC_SCRIPT  = AGENT_DIR / "scripts" / "sync-projects-to-obsidian.py"
REPOS_JSON   = AGENT_DIR / "config" / "repos.json"
ARCH_MD      = AGENT_DIR / "ARCHITECTURE.md"
STANDALONE_DIR = COLLAB_DIR
GEN_DATA     = MC_DIR / "scripts" / "generate-data.mjs"
WRITE_ADMISSION = MC_DIR / "scripts" / "project-write-admission.mjs"
MILESTONE_INDEX = MC_DIR / "scripts" / "milestone-project-index.mjs"
DEFAULT_TOPOLOGY_REGISTRY = MC_DIR / "system-workflow" / "registries" / "morrowise-project-topology.json"

PRIORITY_ALIASES = {
    "P0": "P0",
    "P1": "P1",
    "P2": "P2",
    "high": "P0",
    "medium": "P1",
    "low": "P2",
}

PLACEHOLDER_MARKERS = (
    "tbd",
    "todo",
    "請填",
    "請補",
    "待補",
    "待定",
    "<",
    ">",
)

def is_placeholder(value: str) -> bool:
    normalized = (value or "").strip().lower()
    return not normalized or any(marker in normalized for marker in PLACEHOLDER_MARKERS)


def validate_outcome_contract(parser, args):
    required = {
        "--problem": args.problem,
        "--impact": args.impact,
        "--metric": args.metric,
        "--baseline": args.baseline,
        "--target": args.target,
        "--due": args.due,
        "--measurement-source": args.measurement_source,
    }
    missing = [flag for flag, value in required.items() if is_placeholder(value)]
    if missing:
        parser.error(f"開案成果契約缺少或仍是 placeholder：{', '.join(missing)}")

    try:
        datetime.strptime(args.due, "%Y-%m-%d")
    except ValueError:
        parser.error("--due 必須是 YYYY-MM-DD")

    args.priority = PRIORITY_ALIASES[args.priority]


def resolve_milestone_destination(parser, args):
    """Resolve a flat or one-level grouped milestone destination without writing."""
    if args.group and not args.folder_date:
        args.folder_date = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%y%m%d")

    command = [
        "node", str(MILESTONE_INDEX), "candidate",
        "--root", str(MC_DIR),
        "--id", args.id,
    ]
    if args.group:
        command.extend(["--group", args.group])
    if args.folder_date:
        command.extend(["--folder-date", args.folder_date])
    result = subprocess.run(command, capture_output=True, text=True, cwd=str(MC_DIR))
    if result.returncode != 0:
        parser.error(result.stderr.strip() or "milestone candidate validation failed")
    candidate = json.loads(result.stdout)
    project_dir = MC_DIR.joinpath(*candidate["relativeDir"].split("/"))
    if candidate["layout"] == "flat-v1":
        return project_dir, None
    milestone = {
        "layout": "grouped-v1",
        "project_id": candidate["projectId"],
        "group": candidate["group"],
        "folder_date": candidate["folderDate"],
        "relative_ref": candidate["relativeDir"],
    }
    return project_dir, milestone


def load_repo_create_receipt(receipt_path: str, project_id: str):
    """讀取精準綁定 project ID 的 Vincent repo 建立 receipt。"""
    if not receipt_path:
        return None
    try:
        with open(receipt_path, encoding="utf-8") as f:
            receipt = json.load(f)
    except (OSError, json.JSONDecodeError) as error:
        print(f"❌ repo receipt 無法讀取：{error}", file=sys.stderr)
        sys.exit(2)

    expected = {
        "schema_version": "morrowise.repo-create-approval.v1",
        "action": "create_repo",
        "project_id": project_id,
        "approved_by": "Vincent",
        "decision": "approved",
    }
    invalid = [field for field, value in expected.items() if receipt.get(field) != value]
    receipt_id = receipt.get("receipt_id")
    if invalid or not isinstance(receipt_id, str) or not receipt_id.strip():
        details = ", ".join(invalid or ["receipt_id"])
        print(f"❌ repo receipt 未精準授權 project '{project_id}'：{details}", file=sys.stderr)
        sys.exit(2)
    return receipt


def load_existing_repo_ref(repo_ref: str, project_id: str):
    """驗證既有 repo 精準對應本專案；連結不授權任何 GitHub／Git 動作。"""
    if not repo_ref:
        return None
    expected = f"hisenzi/{project_id}"
    if repo_ref != expected:
        print(f"❌ existing repo 必須精準為 '{expected}'，收到：{repo_ref}", file=sys.stderr)
        sys.exit(2)
    return repo_ref


def require_write_admission(destination: Path, topology_registry: str = None, collab_root: Path = None):
    """在任何 project-init mkdir／同步前取得 target-specific topology admission。"""
    registry = Path(topology_registry) if topology_registry else DEFAULT_TOPOLOGY_REGISTRY
    resolved_collab_root = Path(collab_root) if collab_root else COLLAB_DIR
    result = subprocess.run(
        [
            "node",
            str(WRITE_ADMISSION),
            "--collab-root",
            str(resolved_collab_root),
            "--registry",
            str(registry),
            "--destination",
            str(destination),
            "--format",
            "json",
        ],
        capture_output=True,
        text=True,
        cwd=str(MC_DIR),
    )
    if result.returncode != 0:
        try:
            report = json.loads(result.stdout)
            reason = f"{report.get('code')}: {report.get('reason', '')}".strip()
        except json.JSONDecodeError:
            reason = result.stderr.strip() or "write admission failed"
        print(f"❌ project-init topology BLOCKED：{reason}", file=sys.stderr)
        sys.exit(2)


class QuickRejected(Exception):
    """A contract rejection that must become a fixed Quick JSON receipt."""

    def __init__(self, code: str, detail: str = None):
        self.code = code
        self.detail = detail
        super().__init__(code)


class StableFileLock:
    """Use a persistent /tmp inode so releasing a lock cannot create an unlink race."""

    def __init__(self, scope: str, *, nonblocking: bool):
        lock_root = Path(tempfile.gettempdir()) / "morrowise-project-init-locks"
        lock_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        digest = hashlib.sha256(scope.encode("utf-8")).hexdigest()
        self.path = lock_root / f"{digest}.lock"
        self.nonblocking = nonblocking
        self.handle = None

    def __enter__(self):
        self.handle = self.path.open("a+")
        try:
            operation = fcntl.LOCK_EX | (fcntl.LOCK_NB if self.nonblocking else 0)
            fcntl.flock(self.handle.fileno(), operation)
        except BlockingIOError as error:
            self.handle.close()
            self.handle = None
            raise
        return self

    def __exit__(self, exc_type, exc, traceback):
        if self.handle:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()


class QuickLock:
    """Reject only competing candidate ID/folder requests; registry commits serialize separately."""

    def __init__(self, project_id: str, project_folder: Path):
        scopes = {
            f"quick-project-id:{project_id}",
            f"quick-project-folder:{project_folder}",
        }
        self.locks = [StableFileLock(scope, nonblocking=True) for scope in sorted(scopes)]

    def __enter__(self):
        try:
            for lock in self.locks:
                lock.__enter__()
        except BlockingIOError as error:
            self.__exit__(None, None, None)
            raise QuickRejected("transaction_unavailable") from error
        return self

    def __exit__(self, exc_type, exc, traceback):
        for lock in reversed(self.locks):
            lock.__exit__(exc_type, exc, traceback)


class QuickRegistryLock(StableFileLock):
    """Serialize the shared topology registry without rejecting unrelated candidates."""

    def __init__(self, collab_root: Path):
        super().__init__(f"quick-topology-registry:{collab_root}", nonblocking=False)


def quick_tasks_from_file(source_path: str) -> list:
    """Read the supplied MVP list without using argparse's non-contract output."""
    try:
        payload = json.loads(Path(source_path).expanduser().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise QuickRejected("invalid_input") from error
    if not isinstance(payload, list) or not payload:
        raise QuickRejected("invalid_input")

    normalized = []
    seen_ids = {"quick-open", "formalize"}
    for item in payload:
        if not isinstance(item, dict):
            raise QuickRejected("invalid_input")
        task_id = str(item.get("id") or "").strip()
        title = str(item.get("title") or "").strip()
        done_condition = str(item.get("done_condition") or item.get("acceptance") or "").strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", task_id) or task_id in seen_ids or not title:
            raise QuickRejected("invalid_input")
        if not done_condition:
            raise QuickRejected("invalid_input", f"MVP task {task_id} 缺少驗收標準")
        seen_ids.add(task_id)
        normalized.append({"id": task_id, "title": title, "done_condition": done_condition})
    return normalized


def prepare_quick_input(args):
    """Validate input and path shape before a transaction exists."""
    required = [
        args.id, args.name, args.desc, args.project_code, args.project_folder,
        args.why_open, args.mvp_goal, args.final_goal, args.mvp_tasks_file,
    ]
    if any(not str(value or "").strip() for value in required):
        raise QuickRejected("invalid_input")
    args.id = args.id.strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", args.id):
        raise QuickRejected("invalid_input")
    args.project_code = args.project_code.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]+(?:-[A-Z0-9]+)*", args.project_code):
        raise QuickRejected("invalid_input")

    args.collab_root = Path(os.path.abspath(Path(args.collab_root or COLLAB_DIR).expanduser()))
    args.milestones_root = Path(os.path.abspath(Path(args.milestones_root or PROJECTS_DIR).expanduser()))
    args.topology_registry = Path(os.path.abspath(Path(args.topology_registry or DEFAULT_TOPOLOGY_REGISTRY).expanduser()))
    if not args.collab_root.is_dir():
        raise QuickRejected("transaction_failed")
    control_root = args.collab_root / "harness-mc"
    allowed_registries = {
        control_root / "topology.json",
        control_root / "system-workflow" / "registries" / "morrowise-project-topology.json",
    }
    if args.milestones_root != control_root / "milestones" or args.topology_registry not in allowed_registries:
        raise QuickRejected("destination_path_escape")
    if args.milestones_root.is_symlink() or args.topology_registry.is_symlink():
        raise QuickRejected("destination_symlink_escape")
    if not args.milestones_root.is_dir() or not args.topology_registry.is_file():
        raise QuickRejected("transaction_failed")

    raw_folder = args.project_folder.strip()
    if raw_folder.startswith("$COLLAB/"):
        raw_folder = raw_folder.removeprefix("$COLLAB/")
    supplied_folder = Path(raw_folder).expanduser()
    logical_folder = supplied_folder if supplied_folder.is_absolute() else args.collab_root / supplied_folder
    logical_folder = Path(os.path.abspath(logical_folder))
    if logical_folder.parent != args.collab_root:
        raise QuickRejected("destination_path_escape")
    if logical_folder.is_symlink():
        raise QuickRejected("destination_symlink_escape")
    args.project_folder = logical_folder
    args.project_dir = args.milestones_root / args.id
    args.mvp_tasks = quick_tasks_from_file(args.mvp_tasks_file)


def candidate_topology(args):
    """Build and admit a new topology record entirely in memory."""
    try:
        topology = json.loads(args.topology_registry.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise QuickRejected("transaction_failed") from error
    if topology.get("registry_id") != "morrowise-project-topology.v1":
        raise QuickRejected("transaction_failed")
    policy = topology.get("maintenance_policy") or {}
    max_evidence_age = policy.get("evidence_warn_after_days", 30) if isinstance(policy, dict) else None
    if not isinstance(max_evidence_age, int) or max_evidence_age < 1:
        raise QuickRejected("transaction_failed")
    records = topology.get("records")
    if not isinstance(records, list):
        raise QuickRejected("transaction_failed")

    path_label = f"$COLLAB/{args.project_folder.name}"
    same_id = next((record for record in records if record.get("id") == args.id), None)
    same_path = next((record for record in records if record.get("path_label") == path_label), None)
    if same_id and same_id.get("path_label") != path_label:
        raise QuickRejected("id_conflict")
    existing = same_id or same_path
    if existing:
        if existing.get("migration_state") == "blocked":
            raise QuickRejected("target_migration_blocked")
        if existing.get("classification") != "canonical_project" or existing.get("project_home_ref") != path_label:
            raise QuickRejected("target_not_canonical")
        if same_id:
            raise QuickRejected("id_conflict")
        raise QuickRejected("project_folder_conflict")
    if args.project_folder.exists():
        if (args.project_folder / "README.md").exists():
            raise QuickRejected("readme_conflict")
        raise QuickRejected("project_folder_conflict")
    if args.project_dir.exists():
        raise QuickRejected("milestone_conflict")

    today = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y-%m-%d")
    candidate = {
        "id": args.id,
        "path_label": path_label,
        "classification": "canonical_project",
        "migration_state": "inventory_only",
        "project_home_ref": path_label,
        "topology_profile": "non-git-project",
        "document_ref": f"{path_label}/README.md",
        "repo_ref": None,
        "evidence": [path_label],
        "last_verified_at": today,
        "notes": "Quick project opening registered this canonical local home; Git, deployment, and external sync remain separate MVP actions.",
    }
    next_topology = json.loads(json.dumps(topology))
    next_topology["records"].append(candidate)
    for field in ("updated_at", "inventory_as_of"):
        if field in next_topology:
            next_topology[field] = today
    return next_topology


def quick_global_context(args) -> tuple[str, list]:
    """Report the same global maintenance signal even if candidate admission rejects."""
    collab_root = Path(os.path.abspath(Path(args.collab_root or COLLAB_DIR).expanduser()))
    registry = Path(os.path.abspath(Path(args.topology_registry or DEFAULT_TOPOLOGY_REGISTRY).expanduser()))
    try:
        topology = json.loads(registry.read_text(encoding="utf-8"))
        records = topology.get("records")
        policy = topology.get("maintenance_policy") or {}
        max_evidence_age = policy.get("evidence_warn_after_days", 30) if isinstance(policy, dict) else None
        if topology.get("registry_id") != "morrowise-project-topology.v1" or not collab_root.is_dir() or not isinstance(records, list) or not isinstance(max_evidence_age, int) or max_evidence_age < 1:
            raise ValueError("topology input unavailable")
        findings = quick_maintenance_findings(collab_root, records, policy)
    except (OSError, ValueError, json.JSONDecodeError):
        findings = ["topology_registry_unavailable"]
    return ("degraded" if findings else "ready"), findings


def quick_maintenance_findings(collab_root: Path, records: list, policy: dict) -> list:
    """Mirror topology health findings, but retain them as non-blocking global maintenance."""
    max_age = policy.get("evidence_warn_after_days", 30) if isinstance(policy, dict) else 30
    if not isinstance(max_age, int) or max_age < 1:
        max_age = 30
    today = datetime.now(ZoneInfo("UTC")).date()
    record_refs = set()
    findings = []
    for record in records:
        if not isinstance(record, dict):
            continue
        ref = record.get("path_label")
        if not isinstance(ref, str) or not re.fullmatch(r"\$COLLAB/[^/]+", ref):
            continue
        if ref in record_refs:
            findings.append(f"duplicate_topology_root:{ref}")
            continue
        record_refs.add(ref)
        local_path = collab_root / ref.removeprefix("$COLLAB/")
        if not local_path.exists():
            findings.append(f"missing_registered_topology_root:{ref}")
        try:
            verified = datetime.strptime(str(record.get("last_verified_at") or ""), "%Y-%m-%d").date()
            stale = (today - verified).days > max_age
        except ValueError:
            stale = True
        if stale:
            findings.append(f"stale_topology_evidence:{ref}")
        if record.get("classification") == "unknown":
            findings.append(f"unclassified_topology_record:{ref}")
        if record.get("migration_state") == "blocked":
            code = "blocked_worktree_migration" if record.get("classification") == "git_worktree" else "blocked_topology_migration"
            findings.append(f"{code}:{ref}")
    for entry in collab_root.iterdir():
        if entry.name.startswith(".quick-") or not entry.is_dir():
            continue
        ref = f"$COLLAB/{entry.name}"
        if ref not in record_refs:
            findings.append(f"unregistered_topology_root:{ref}")
    return sorted(findings)


def make_quick_project_json(args) -> dict:
    """快速開案的最小 project.json；完整治理欄位留待 formalize。"""
    return {
        "name": args.name,
        "description": args.desc,
        "status": "active",
        "created": datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y-%m-%d"),
        "project_code": args.project_code,
        "project_folder": f"$COLLAB/{args.project_folder.name}",
        "why_opened": args.why_open,
        "mvp_goal": args.mvp_goal,
        "final_goal": args.final_goal,
        "tracks": {
            "mvp": "MVP",
        },
    }


def make_quick_tasks_json(args) -> dict:
    """建立 quick-open、任意數量 MVP tasks 與 formalize checkpoint。"""
    tasks = [
        {
            "id": "quick-open",
            "title": "完成快速開案流程",
            "status": "todo",
            "track": "mvp",
            "order_label": f"{args.project_code}-MVP-01",
            "dependencies": [],
            "done_condition": "README.md、最小 project.json、MVP tasks、formalize checkpoint、專案拓樸與局部驗證均完成，且 tasks 已可在 MC 查看",
        },
    ]
    for index, item in enumerate(args.mvp_tasks, start=2):
        tasks.append({
            "id": item["id"],
            "title": item["title"],
            "status": "todo",
            "track": "mvp",
            "order_label": f"{args.project_code}-MVP-{index:02d}",
            "dependencies": [],
            "done_condition": item["done_condition"],
        })

    checkpoint_number = len(tasks) + 1
    tasks.append({
        "id": "formalize",
        "title": "依 MVP 測試結果啟動正式補完",
        "status": "todo",
        "track": "mvp",
        "order_label": f"{args.project_code}-MVP-{checkpoint_number:02d}",
        "dependencies": [],
        "done_condition": "已依 MVP 測試結果與最終目標補齊正式專案內容，並建立內容明確且各有驗收標準的正式 tasks",
    })
    return {
        "project": args.id,
        "tasks": tasks,
    }


def make_quick_readme(args) -> str:
    return (
        f"# {args.name}\n\n"
        f"{args.desc}\n\n"
        "## 為何開案\n\n"
        f"{args.why_open}\n\n"
        "## MVP 目標\n\n"
        f"{args.mvp_goal}\n\n"
        "## 最終目標\n\n"
        f"{args.final_goal}\n"
    )


QUICK_TRANSACTION_SCHEMA = "morrowise.quick-transaction.v1"
QUICK_TRANSACTION_MARKER = ".quick-transaction.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def transaction_payload(args, transaction: Path, topology_backup: Path, staged_topology: Path) -> dict:
    return {
        "schema_version": QUICK_TRANSACTION_SCHEMA,
        "transaction_id": transaction.name,
        "project_id": args.id,
        "project_folder_name": args.project_folder.name,
        "milestone_relative": f"harness-mc/milestones/{args.id}",
        "topology_registry_relative": str(args.topology_registry.relative_to(args.collab_root)),
        "topology_before_sha256": sha256_file(topology_backup),
        "topology_after_sha256": sha256_file(staged_topology),
    }


def write_quick_marker(directory: Path, payload: dict, artifact: str):
    marker = {
        "schema_version": QUICK_TRANSACTION_SCHEMA,
        "transaction_id": payload["transaction_id"],
        "project_id": payload["project_id"],
        "artifact": artifact,
    }
    (directory / QUICK_TRANSACTION_MARKER).write_text(
        json.dumps(marker, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def write_quick_journal(path: Path, payload: dict, state: str, committed: list, in_flight: str = None):
    record = {**payload, "state": state, "committed": list(committed), "in_flight": in_flight}
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def trusted_journal_targets(collab_root: Path, transaction: Path, payload: dict) -> tuple[Path, Path, Path, Path]:
    """Derive recovery targets from a tightly validated journal; never trust journal paths."""
    allowed_registries = {
        "harness-mc/topology.json",
        "harness-mc/system-workflow/registries/morrowise-project-topology.json",
    }
    project_id = payload.get("project_id")
    folder_name = payload.get("project_folder_name")
    if (
        payload.get("schema_version") != QUICK_TRANSACTION_SCHEMA
        or payload.get("transaction_id") != transaction.name
        or not isinstance(project_id, str)
        or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", project_id)
        or not isinstance(folder_name, str)
        or not folder_name
        or folder_name in {".", ".."}
        or "/" in folder_name
        or "\\" in folder_name
        or payload.get("milestone_relative") != f"harness-mc/milestones/{project_id}"
        or payload.get("topology_registry_relative") not in allowed_registries
        or not re.fullmatch(r"[0-9a-f]{64}", str(payload.get("topology_before_sha256") or ""))
        or not re.fullmatch(r"[0-9a-f]{64}", str(payload.get("topology_after_sha256") or ""))
        or not isinstance(payload.get("committed"), list)
        or any(item not in {"project_folder", "milestone", "topology"} for item in payload["committed"])
        or payload.get("in_flight") not in {None, "project_folder", "milestone", "topology"}
    ):
        raise QuickRejected("transaction_interrupted")
    project_folder = collab_root / folder_name
    milestone = collab_root / "harness-mc" / "milestones" / project_id
    registry = collab_root / Path(payload["topology_registry_relative"])
    backup = transaction / "topology.before.json"
    return project_folder, milestone, registry, backup


def owned_marker_matches(directory: Path, payload: dict, artifact: str) -> bool:
    marker_path = directory / QUICK_TRANSACTION_MARKER
    if directory.is_symlink() or marker_path.is_symlink() or not marker_path.is_file():
        return False
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return marker == {
        "schema_version": QUICK_TRANSACTION_SCHEMA,
        "transaction_id": payload["transaction_id"],
        "project_id": payload["project_id"],
        "artifact": artifact,
    }


def remove_owned_artifact(directory: Path, payload: dict, artifact: str) -> bool:
    if not directory.exists() and not directory.is_symlink():
        return True
    if not owned_marker_matches(directory, payload, artifact):
        return False
    try:
        shutil.rmtree(directory)
        return True
    except OSError:
        return False


def rollback_quick_transaction(collab_root: Path, transaction: Path, payload: dict) -> bool:
    """Restore only outputs carrying this transaction marker and an exact registry digest."""
    project_folder, milestone, registry, backup = trusted_journal_targets(collab_root, transaction, payload)
    committed = set(payload["committed"])
    if payload.get("in_flight"):
        committed.add(payload["in_flight"])
    if "topology" in committed:
        if backup.is_symlink() or registry.is_symlink() or not backup.is_file() or sha256_file(backup) != payload["topology_before_sha256"] or not registry.is_file():
            return False
        current_digest = sha256_file(registry)
        if current_digest == payload["topology_after_sha256"]:
            os.replace(backup, registry)
        elif current_digest != payload["topology_before_sha256"]:
            return False
    if "project_folder" in committed and not remove_owned_artifact(project_folder, payload, "project_folder"):
        return False
    if "milestone" in committed and not remove_owned_artifact(milestone, payload, "milestone"):
        return False
    return True


def remove_transaction_staging(transaction_root: Path, transaction: Path, journal: Path):
    """The journal is the commit decision; remove it before deleting only its direct staging folder."""
    try:
        journal.unlink()
    except FileNotFoundError:
        pass
    if transaction.parent == transaction_root and transaction.exists() and transaction.is_dir() and not transaction.is_symlink():
        shutil.rmtree(transaction)
    try:
        transaction_root.rmdir()
    except OSError:
        pass


def recover_unfinished_quick_transactions(collab_root: Path) -> bool:
    """Recover only journaled Quick artifacts that prove they belong to that transaction."""
    transaction_root = collab_root / ".quick-transactions"
    if not transaction_root.exists():
        return False
    if transaction_root.is_symlink() or not transaction_root.is_dir():
        raise QuickRejected("transaction_interrupted")
    journals = sorted(transaction_root.glob("*/journal.json"))
    if not journals:
        if any(transaction_root.iterdir()):
            raise QuickRejected("transaction_interrupted")
        transaction_root.rmdir()
        return False
    for journal in journals:
        transaction = journal.parent
        try:
            payload = json.loads(journal.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise QuickRejected("transaction_interrupted") from error
        if not rollback_quick_transaction(collab_root, transaction, payload):
            raise QuickRejected("transaction_interrupted")
        remove_transaction_staging(transaction_root, transaction, journal)
    return True


def interrupt_for_quick_recovery_fixture(phase: str):
    """Only the isolated verifier sets this hook to model an uncatchable process interruption."""
    if os.environ.get("MORROWISE_QUICK_TEST_INTERRUPT_AFTER") == phase:
        os._exit(91)


def commit_quick_transaction(args, topology):
    """Stage every output, then commit and recover only marker-proven partial artifacts."""
    transaction_root = args.collab_root / ".quick-transactions"
    transaction = transaction_root / f"{args.id}-{uuid.uuid4().hex}"
    staged_project = transaction / "project-folder"
    staged_milestone = transaction / "milestone"
    staged_topology = transaction / "topology.json"
    topology_backup = transaction / "topology.before.json"
    journal = transaction / "journal.json"
    committed = []
    in_flight = None
    payload = None
    completed = False
    try:
        staged_project.mkdir(parents=True)
        staged_milestone.mkdir()
        (staged_project / "README.md").write_text(make_quick_readme(args), encoding="utf-8")
        (staged_milestone / "project.json").write_text(json.dumps(make_quick_project_json(args), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (staged_milestone / "tasks.json").write_text(json.dumps(make_quick_tasks_json(args), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        shutil.copyfile(args.topology_registry, topology_backup)
        staged_topology.write_text(json.dumps(topology, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        payload = transaction_payload(args, transaction, topology_backup, staged_topology)
        write_quick_marker(staged_project, payload, "project_folder")
        write_quick_marker(staged_milestone, payload, "milestone")
        in_flight = "project_folder"
        write_quick_journal(journal, payload, "committing", committed, in_flight)

        os.replace(staged_project, args.project_folder)
        committed.append("project_folder")
        in_flight = None
        write_quick_journal(journal, payload, "committing", committed, in_flight)
        interrupt_for_quick_recovery_fixture("project_folder")
        in_flight = "milestone"
        write_quick_journal(journal, payload, "committing", committed, in_flight)
        os.replace(staged_milestone, args.project_dir)
        committed.append("milestone")
        in_flight = None
        write_quick_journal(journal, payload, "committing", committed, in_flight)
        interrupt_for_quick_recovery_fixture("milestone")
        in_flight = "topology"
        write_quick_journal(journal, payload, "committing", committed, in_flight)
        os.replace(staged_topology, args.topology_registry)
        committed.append("topology")
        in_flight = None
        write_quick_journal(journal, payload, "committed", committed, in_flight)
        interrupt_for_quick_recovery_fixture("topology")
        completed = True
    except BaseException:
        if payload is not None:
            recovery_payload = {**payload, "committed": committed, "in_flight": in_flight}
            try:
                write_quick_journal(journal, payload, "rolling_back", committed, in_flight)
            except OSError:
                pass
            if rollback_quick_transaction(args.collab_root, transaction, recovery_payload):
                remove_transaction_staging(transaction_root, transaction, journal)
            else:
                raise QuickRejected("transaction_interrupted")
        raise
    finally:
        if completed:
            remove_transaction_staging(transaction_root, transaction, journal)


def emit_quick_receipt(outcome: str, start_time: float, global_status: str, findings: list, reason_code: str = None):
    receipt = {
        "outcome": outcome,
        "target_status": "ready" if outcome == "created" else "rejected",
        "global_status": global_status,
        "duration_ms": round((time.perf_counter() - start_time) * 1000),
        "maintenance_findings": findings,
    }
    if reason_code:
        receipt["reason_code"] = reason_code
    sys.stdout.write(json.dumps(receipt, ensure_ascii=False) + "\n")


def quick_create(args):
    """Quick contract: validate candidate, stage all outputs, then commit or leave nothing."""
    start_time = time.perf_counter()
    global_status, findings = quick_global_context(args)
    try:
        prepare_quick_input(args)
        with QuickLock(args.id, args.project_folder):
            with QuickRegistryLock(args.collab_root):
                if recover_unfinished_quick_transactions(args.collab_root):
                    raise QuickRejected("transaction_interrupted")
                topology = candidate_topology(args)
                global_status, findings = quick_global_context(args)
                commit_quick_transaction(args, topology)
        emit_quick_receipt("created", start_time, global_status, findings)
        return 0
    except QuickRejected as error:
        if error.detail:
            print(error.detail, file=sys.stderr)
        emit_quick_receipt("rejected", start_time, global_status, findings, error.code)
        return 2
    except Exception:
        emit_quick_receipt("rejected", start_time, global_status, findings, "transaction_failed")
        return 2


def has_content(value) -> bool:
    """接受非空文字、array 或 object，避免替正式內容增加未核准 schema。"""
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return value is not None


def load_formalize_payload(parser, source_path: str, existing_tasks: list, project_code: str) -> dict:
    """讀取 MVP 測試後核准的正式專案內容與正式 tasks。"""
    try:
        payload = json.loads(Path(source_path).expanduser().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        parser.error(f"formalize 資料無法讀取：{error}")
    if not isinstance(payload, dict):
        parser.error("--formalize-file 必須是 JSON object")

    required = {
        "MVP 測試結果": payload.get("mvp_test_results"),
        "goals": payload.get("goals"),
        "risks": payload.get("risks"),
        "metric": payload.get("metric"),
        "due": payload.get("due"),
        "System Growth Gate": payload.get("system_growth_gate"),
    }
    missing = [label for label, value in required.items() if not has_content(value)]
    if missing:
        parser.error(f"formalize 缺少：{', '.join(missing)}")
    try:
        datetime.strptime(str(payload["due"]), "%Y-%m-%d")
    except ValueError:
        parser.error("formalize due 必須是 YYYY-MM-DD")

    raw_tasks = payload.get("tasks")
    if not isinstance(raw_tasks, list) or not raw_tasks:
        parser.error("formalize tasks 必須是至少一項 task 的 JSON array")

    seen_ids = {
        str(task.get("id") or "").strip()
        for task in existing_tasks
        if isinstance(task, dict) and str(task.get("id") or "").strip()
    }
    seen_labels = {
        str(task.get("order_label") or "").strip()
        for task in existing_tasks
        if isinstance(task, dict) and str(task.get("order_label") or "").strip()
    }
    formal_tasks = []
    for index, item in enumerate(raw_tasks, start=1):
        if not isinstance(item, dict):
            parser.error(f"正式 task {index} 必須是 JSON object")
        task_id = str(item.get("id") or "").strip()
        title = str(item.get("title") or "").strip()
        done_condition = str(item.get("done_condition") or item.get("acceptance") or "").strip()
        order_label = f"{project_code}-{index:02d}"
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", task_id):
            parser.error(f"正式 task {index} 的 id 必須是小寫 slug")
        if task_id in seen_ids:
            parser.error(f"正式 task id 重複：{task_id}")
        if not title:
            parser.error(f"正式 task {task_id} 缺少明確 title")
        if not done_condition:
            parser.error(f"正式 task {task_id} 缺少驗收標準")
        if order_label in seen_labels:
            parser.error(f"正式 task order_label 重複：{order_label}")
        seen_ids.add(task_id)
        seen_labels.add(order_label)
        formal_tasks.append({
            "id": task_id,
            "title": title,
            "status": "todo",
            "track": "formal",
            "order_label": order_label,
            "dependencies": [],
            "done_condition": done_condition,
        })

    payload["formal_tasks"] = formal_tasks
    return payload


def validate_formalize_args(parser, args):
    """formalize 只接受既有 quick 專案，並保留其既有內容。"""
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", str(args.id or "")):
        parser.error("--id 必須是小寫英文、數字與連字號組成的 slug")
    args.collab_root = Path(args.collab_root or COLLAB_DIR).expanduser().resolve()
    args.milestones_root = Path(args.milestones_root or PROJECTS_DIR).expanduser().resolve()
    args.topology_registry = Path(
        args.topology_registry or DEFAULT_TOPOLOGY_REGISTRY
    ).expanduser().resolve()
    args.project_dir = args.milestones_root / args.id
    args.project_path = args.project_dir / "project.json"
    args.tasks_path = args.project_dir / "tasks.json"
    if not args.project_dir.is_dir() or not args.project_path.is_file() or not args.tasks_path.is_file():
        parser.error(f"找不到既有 quick 專案：{args.project_dir}")

    try:
        args.project_data = json.loads(args.project_path.read_text(encoding="utf-8"))
        args.tasks_data = json.loads(args.tasks_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        parser.error(f"既有 quick 專案資料無法讀取：{error}")
    if not isinstance(args.project_data, dict):
        parser.error("既有 project.json 必須是 JSON object")
    if not isinstance(args.tasks_data, dict) or not isinstance(args.tasks_data.get("tasks"), list):
        parser.error("既有 tasks.json 必須包含 tasks array")

    project_code = str(args.project_data.get("project_code") or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9]+(?:-[A-Z0-9]+)*", project_code):
        parser.error("既有 quick 專案缺少有效 project_code")
    if not has_content(args.project_data.get("final_goal")):
        parser.error("既有 quick 專案缺少最終目標 final_goal")
    if has_content(args.project_data.get("goals")):
        parser.error("此專案已完成 formalize，不重複建立正式 tasks")

    args.project_code = project_code
    args.formalize_payload = load_formalize_payload(
        parser,
        args.formalize_file,
        args.tasks_data["tasks"],
        project_code,
    )


def formalize_project(parser, args):
    """依 MVP 測試結果與既有 final_goal 更新專案，並只追加正式 tasks。"""
    project = args.project_data
    tasks_data = args.tasks_data
    payload = args.formalize_payload

    tracks = project.get("tracks")
    if tracks is None:
        tracks = {}
    if not isinstance(tracks, dict):
        parser.error("既有 project.json tracks 必須是 JSON object")
    project["tracks"] = {**tracks, "formal": "正式執行"}
    for field in ["goals", "risks", "metric", "due", "system_growth_gate"]:
        project[field] = payload[field]
    tasks_data["tasks"].extend(payload["formal_tasks"])

    require_write_admission(
        args.project_dir,
        args.topology_registry,
        args.collab_root,
    )
    args.project_path.write_text(
        json.dumps(project, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.tasks_path.write_text(
        json.dumps(tasks_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"✅ 正式補完資料已建立：{args.id}")
    print("   已保留既有 quick 專案與所有 MVP task 身分及紀錄。")
    print(f"   已追加 {len(payload['formal_tasks'])} 項正式 task。")
    print("   尚未執行 MC 同步、Git、部署、外部同步或其他全域重建。")


def make_project_json(args) -> dict:
    proj_type = args.type
    outcome = {
        "problem_statement": args.problem,
        "impact": args.impact,
        "success_target": {
            "metric": args.metric,
            "baseline": args.baseline,
            "target": args.target,
            "due": args.due,
        },
        "measurement_source": args.measurement_source,
    }

    base = {
        "name":        args.name,
        "description": args.desc,
        "type":        proj_type,
        "status":      "active",
        "priority":    args.priority,
        "created":     datetime.now().strftime("%Y-%m-%d"),
        "estimated_completion": args.due,
        "repo_ref": args.existing_repo_ref,
        "repo_creation": {
            "create_repo": args.repo_create_receipt is not None,
            "approval_ref": args.repo_create_receipt.get("receipt_id") if args.repo_create_receipt else None,
        },
        "tracks": {
            "phase-1": "Phase 1",
        },
        "outcome": outcome,
        "task_taxonomy": {
            "version": "v1",
            "sort_rule": "dependencies_then_priority_then_id",
            "capability_domains": [
                "direction-governance",
                "source-memory",
                "sensing-events",
                "judgment-priority",
                "approval-safety",
                "action-delivery",
                "feedback-learning",
                "heartbeat-scheduling",
                "dashboard-surface",
                "knowledge-capture",
                "verification-immunity",
            ],
            "task_kinds": ["discover", "decide", "design", "implement", "verify", "operate", "closeout"],
            "priority_order": ["P0", "P1", "P2"],
        },
        "goals": [
            f"解決：{args.problem}",
            f"{args.metric} 從 {args.baseline} 提升至 {args.target}，截止 {args.due}",
        ],
        "risks": [
            {
                "risk": "成果契約或量測來源失效，導致專案無法驗收。",
                "impact": "high",
                "probability": "medium",
                "mitigation": "在 Phase 1 驗收前重跑 measurement_source 並確認 baseline/target。",
            },
        ],
        "success_criteria": [
            {
                "criterion": f"{args.metric} 達到 {args.target}",
                "verify_cmd": args.measurement_source,
                "expected": f"baseline={args.baseline}; target={args.target}; due={args.due}",
            },
        ],
        "decisions": [],
    }
    if getattr(args, "milestone", None):
        base["milestone"] = args.milestone

    if proj_type == "standalone":
        base["tracks"]["deploy"] = "部署"

    return base


def make_tasks_json(args) -> dict:
    return {
        "project": args.id,
        "tasks": [
            {
                "id":     "p1-1",
                "title":  "需求確認（功能範圍、使用者角色、完成定義）",
                "status": "todo",
                "track":  "phase-1",
                "order_label": "PI-01",
                "priority": args.priority,
                "capability_domain": "direction-governance",
                "task_kind": "discover",
                "dependencies": [],
                "done_condition": "outcome.problem_statement、impact、success_target 與 measurement_source 已由需求確認驗證，且沒有 placeholder"
            },
            {
                "id":     "p1-2",
                "title":  "架構設計（技術棧選定、系統架構文件）",
                "status": "todo",
                "track":  "phase-1",
                "order_label": "PI-02",
                "priority": "P1",
                "capability_domain": "source-memory",
                "task_kind": "design",
                "dependencies": ["p1-1"],
                "done_condition": "ARCHITECTURE.md 或等效文件已建立，並能對照 outcome contract"
            },
            {
                "id":     "p1-verify",
                "title":  "Phase 1 驗收整合",
                "status": "todo",
                "track":  "phase-1",
                "order_label": "PI-03",
                "priority": "P2",
                "capability_domain": "verification-immunity",
                "task_kind": "verify",
                "dependencies": ["p1-1", "p1-2"],
                "done_condition": "success_criteria、done_condition、量測來源與環境異動均已驗證",
                "note":   "前置任務全 done 後執行"
            }
        ]
    }


# ── Standalone repo 建立 ──────────────────────────────────────────────────

def setup_standalone_repo(project_id: str, name: str, desc: str, deploy_target: str = None):
    """建立 GitHub repo + clone + 初始化 + 更新 repos.json + ARCHITECTURE.md"""
    repo_dir = STANDALONE_DIR / project_id

    print(f"\n📦 建立 GitHub repo: hisenzi/{project_id}")
    result = subprocess.run(
        ["gh", "repo", "create", f"hisenzi/{project_id}", "--private", "--clone"],
        capture_output=True, text=True, cwd=str(STANDALONE_DIR)
    )
    if result.returncode != 0:
        print(f"❌ GitHub repo 建立失敗：{result.stderr}")
        return False

    readme = repo_dir / "README.md"
    if not readme.exists():
        readme.write_text(
            f"# {name}\n\n{desc}\n\n"
            f"<!-- MILESTONES:BEGIN -->\n<!-- MILESTONES:END -->\n"
        )

    gitignore = repo_dir / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text(
            "node_modules/\ndist/\n.astro/\n.env\n.DS_Store\n"
            "__pycache__/\n*.pyc\nsecrets/\n"
        )

    subprocess.run(["git", "add", "-A"], cwd=str(repo_dir), capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "chore: init project structure"],
        cwd=str(repo_dir), capture_output=True
    )
    subprocess.run(
        ["git", "push", "-u", "origin", "main"],
        cwd=str(repo_dir), capture_output=True
    )
    print(f"✅ Repo 初始化完成：{repo_dir}")

    update_repos_json(project_id, desc, deploy_target)
    update_architecture(project_id, name)

    return True


def update_repos_json(project_id: str, desc: str, deploy_target: str = None):
    """新增 repo 到 repos.json"""
    with open(REPOS_JSON) as f:
        data = json.load(f)
    repos = data.get("repos", data)

    existing = {r["name"] for r in repos if isinstance(r, dict)}
    if project_id in existing:
        for r in repos:
            if isinstance(r, dict) and r["name"] == project_id:
                r["path"] = f"Claude_協作/{project_id}"
                r["remote"] = f"hisenzi/{project_id}"
                if deploy_target:
                    r["deploy_target"] = deploy_target
        print(f"  📝 repos.json: 更新 {project_id}")
    else:
        repos.append({
            "name": project_id,
            "path": f"Claude_協作/{project_id}",
            "remote": f"hisenzi/{project_id}",
            "auto_push": False,
            "deploy_target": deploy_target,
            "created": datetime.now().strftime("%Y-%m-%d"),
            "initialized": True,
            "description": desc
        })
        print(f"  ✅ repos.json: 新增 {project_id}")

    if isinstance(data, dict):
        data["repos"] = repos
    with open(REPOS_JSON, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def update_architecture(project_id: str, name: str):
    """在 ARCHITECTURE.md 的 repo 表格加入新 repo"""
    arch_text = ARCH_MD.read_text(encoding="utf-8")
    new_line = f"| hisenzi/{project_id} | {name} | check-repos 通知 |"

    if f"hisenzi/{project_id}" in arch_text:
        print(f"  ⏭️ ARCHITECTURE.md: 已存在 {project_id}")
        return

    marker = "| hisenzi/how-i-work |"
    if marker in arch_text:
        arch_text = arch_text.replace(marker, f"{new_line}\n{marker}")
    else:
        lines = arch_text.split("\n")
        insert_idx = None
        for i, line in enumerate(lines):
            if "| hisenzi/" in line:
                insert_idx = i
        if insert_idx is not None:
            lines.insert(insert_idx + 1, new_line)
            arch_text = "\n".join(lines)

    ARCH_MD.write_text(arch_text, encoding="utf-8")
    print(f"  ✅ ARCHITECTURE.md: 新增 {project_id}")


# ── Promote: internal → standalone ────────────────────────────────────────

def promote(args):
    """將 internal 專案升級為 standalone"""
    project_dir = PROJECTS_DIR / args.id
    proj_path = project_dir / "project.json"

    if not proj_path.exists():
        print(f"❌ 專案 '{args.id}' 不存在")
        sys.exit(1)

    with open(proj_path) as f:
        proj = json.load(f)

    if proj.get("type") == "standalone":
        print(f"⏭️ '{args.id}' 已經是 standalone")
        return

    require_write_admission(proj_path, args.topology_registry)

    print(f"🔄 升級 {args.id}: internal → standalone")

    deploy_target = None
    if hasattr(args, "deploy") and args.deploy:
        deploy_target = args.deploy

    success = setup_standalone_repo(
        args.id,
        proj.get("name", args.id),
        proj.get("description", ""),
        deploy_target
    )

    if success:
        proj["type"] = "standalone"
        proj["repo_ref"] = f"hisenzi/{args.id}"
        proj["repo_creation"] = {
            "create_repo": True,
            "approval_ref": args.repo_create_receipt["receipt_id"],
        }
        with open(proj_path, "w") as f:
            json.dump(proj, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"  ✅ project.json: type → standalone")

        print("\n🔄 同步到 Obsidian...")
        subprocess.run(
            ["python3", str(SYNC_SCRIPT)],
            capture_output=True, text=True
        )

        rebuild_mc()

        print(f"\n🎉 升級完成：{args.id} → standalone")
        print(f"   Repo: https://github.com/hisenzi/{args.id}")
        print(f"   本地: Claude_協作/{args.id}/")
        print("   🧠 如需長期記憶，請建立 shared-memory candidate（source、reason、dedupe_key、target_layer、sensitivity、Vincent approval）；未核准不得直接更新 MEMORY.md")
    else:
        print("❌ 升級失敗")


def rebuild_mc():
    """Rebuild MC 儀表板"""
    if GEN_DATA.exists():
        print("\n🔄 Rebuild MC 儀表板...")
        result = subprocess.run(
            ["node", str(GEN_DATA)],
            capture_output=True, text=True, cwd=str(MC_DIR)
        )
        if result.returncode == 0:
            print(f"  ✅ {result.stdout.strip()}")
        else:
            print(f"  ⚠️ rebuild 失敗：{result.stderr}")
    else:
        print(f"\n⚠️ generate-data.mjs 不存在：{GEN_DATA}")


# ── 主流程 ────────────────────────────────────────────────────────────────

def create(args):
    """新建專案"""
    project_dir = args.project_dir
    project = make_project_json(args)
    tasks = make_tasks_json(args)

    if args.dry_run:
        print(json.dumps({"project": project, "tasks": tasks}, ensure_ascii=False, indent=2))
        return

    require_write_admission(project_dir, args.topology_registry)

    if project_dir.exists():
        print(f"❌ 專案 '{args.id}' 已存在：{project_dir}")
        sys.exit(1)

    project_dir.mkdir(parents=True)
    print(f"📁 建立目錄：{project_dir}")

    proj_path = project_dir / "project.json"
    proj_path.write_text(
        json.dumps(project, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"✅ 建立：{proj_path.name}")

    ms_path = project_dir / "tasks.json"
    ms_path.write_text(
        json.dumps(tasks, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"✅ 建立：{ms_path.name}")

    repo_created = False
    if args.repo_create_receipt:
        deploy_target = getattr(args, "deploy", None)
        repo_created = setup_standalone_repo(args.id, args.name, args.desc, deploy_target)
        if repo_created:
            project["repo_ref"] = f"hisenzi/{args.id}"
            proj_path.write_text(
                json.dumps(project, ensure_ascii=False, indent=2) + "\n"
            )

    if not args.no_sync:
        print("\n🔄 同步到 Obsidian...")
        result = subprocess.run(
            ["python3", str(SYNC_SCRIPT)],
            capture_output=True, text=True
        )
        if result.stdout:
            print(result.stdout.strip().split("\n")[-1])
        if result.returncode != 0:
            print(f"⚠️  同步失敗：{result.stderr}")
    else:
        print("\n⏭️  跳過 Obsidian 同步（--no-sync）")

    rebuild_mc()

    print(f"\n🎉 開案完成：{args.name}（{args.id}）— type: {args.type}")
    print(f"   MC 目錄：{project_dir}")
    print(f"   Obsidian：Projects/{args.id}.md")
    if repo_created:
        print(f"   Repo: https://github.com/hisenzi/{args.id}")
        print(f"   本地: Claude_協作/{args.id}/")
    elif args.existing_repo_ref:
        print(f"   已連結既有 Repo: https://github.com/{args.existing_repo_ref}")
    print("   ✅ 成果契約與 starter task taxonomy 已建立；下一步依 task lifecycle 執行。")


def main():
    parser = argparse.ArgumentParser(description="Mission Control 開案自動化")
    subparsers = parser.add_subparsers(dest="command")

    promote_parser = subparsers.add_parser("promote", help="升級 internal → standalone")
    promote_parser.add_argument("--id", required=True, help="專案 ID")
    promote_parser.add_argument("--deploy", default=None, help="部署目標 (zeabur/vps/none)")
    promote_parser.add_argument("--repo-create-receipt", required=True, help="Vincent 精準 repo 建立 receipt JSON")
    promote_parser.add_argument("--topology-registry", default=None, help=argparse.SUPPRESS)

    quick_parser = subparsers.add_parser("quick", help="以最小資料建立 MVP 專案")
    quick_parser.add_argument("--id", default=None, help="專案 ID（小寫 slug）")
    quick_parser.add_argument("--name", default=None, help="專案名稱")
    quick_parser.add_argument("--desc", default=None, help="一句話目標")
    quick_parser.add_argument("--project-code", default=None, help="人類溝通代碼，例如 VTS")
    quick_parser.add_argument("--project-folder", default=None, help="$COLLAB 直屬專案資料夾")
    quick_parser.add_argument("--why-open", default=None, help="專案為何開案")
    quick_parser.add_argument("--mvp-goal", default=None, help="MVP 目標")
    quick_parser.add_argument("--final-goal", default=None, help="最終目標")
    quick_parser.add_argument("--mvp-tasks-file", default=None, help="MVP task JSON array；每項含 id、title、done_condition")
    quick_parser.add_argument("--collab-root", default=None, help=argparse.SUPPRESS)
    quick_parser.add_argument("--milestones-root", default=None, help=argparse.SUPPRESS)
    quick_parser.add_argument("--topology-registry", default=None, help=argparse.SUPPRESS)

    formalize_parser = subparsers.add_parser("formalize", help="依 MVP 測試結果補完正式專案與 tasks")
    formalize_parser.add_argument("--id", required=True, help="既有 quick 專案 ID")
    formalize_parser.add_argument("--formalize-file", required=True, help="MVP 測試結果、正式欄位與 tasks 的 JSON object")
    formalize_parser.add_argument("--collab-root", default=None, help=argparse.SUPPRESS)
    formalize_parser.add_argument("--milestones-root", default=None, help=argparse.SUPPRESS)
    formalize_parser.add_argument("--topology-registry", default=None, help=argparse.SUPPRESS)

    parser.add_argument("--id",       help="專案 ID（英文、連字號）")
    parser.add_argument("--name",     help="專案名稱")
    parser.add_argument("--desc",     help="一句話描述")
    parser.add_argument("--type",     choices=["internal", "standalone"], help="專案類型（必填）")
    parser.add_argument("--problem", default=None, help="要解決的具體問題")
    parser.add_argument("--impact", default=None, help="不解決或解決後的影響")
    parser.add_argument("--metric", default=None, help="量化成功指標")
    parser.add_argument("--baseline", default=None, help="目前量測基準")
    parser.add_argument("--target", default=None, help="目標數值或門檻")
    parser.add_argument("--due", default=None, help="成果目標日 YYYY-MM-DD")
    parser.add_argument("--measurement-source", default=None, help="量測資料來源或驗證指令")
    parser.add_argument("--priority", default="P1", choices=["P0", "P1", "P2", "high", "medium", "low"])
    parser.add_argument("--deploy",   default=None, help="部署目標 (zeabur/vps)")
    parser.add_argument("--no-sync",  action="store_true", help="只建檔，不同步 Obsidian")
    parser.add_argument("--dry-run", action="store_true", help="只輸出 project/tasks contract，不建立檔案或同步")
    parser.add_argument("--group", default=None, help="milestone group slug；搭配後使用 milestones/<group>/<yymmdd-id>")
    parser.add_argument("--folder-date", default=None, help="grouped milestone 目錄日期 yymmdd；未提供則用 Asia/Taipei 今日")
    parser.add_argument("--repo-create-receipt", default=None, help="Vincent 精準 repo 建立 receipt JSON")
    parser.add_argument("--existing-repo-ref", default=None, help="已存在且精準對應本專案的 GitHub repo，例如 hisenzi/my-project")
    parser.add_argument("--topology-registry", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--template", default=None, help="（已棄用，請用 --type）")
    parser.add_argument("--repo-path", default=None, help="（已棄用）")

    args = parser.parse_args()

    if args.command == "promote":
        args.repo_create_receipt = load_repo_create_receipt(args.repo_create_receipt, args.id)
        promote(args)
        return

    if args.command == "quick":
        sys.exit(quick_create(args))

    if args.command == "formalize":
        validate_formalize_args(formalize_parser, args)
        formalize_project(formalize_parser, args)
        return

    if args.template and not args.type:
        args.type = "standalone" if args.template == "product" else args.template

    if not args.id or not args.name or not args.desc:
        parser.error("需要 --id, --name, --desc")
    if not args.type:
        parser.error("需要 --type (internal 或 standalone)")

    validate_outcome_contract(parser, args)
    args.project_dir, args.milestone = resolve_milestone_destination(parser, args)
    if args.repo_create_receipt and args.existing_repo_ref:
        parser.error("--repo-create-receipt 與 --existing-repo-ref 不可同時使用")
    if args.existing_repo_ref and args.type != "standalone":
        parser.error("--existing-repo-ref 只適用於 standalone 專案")
    args.repo_create_receipt = load_repo_create_receipt(args.repo_create_receipt, args.id)
    args.existing_repo_ref = load_existing_repo_ref(args.existing_repo_ref, args.id)

    create(args)


if __name__ == "__main__":
    main()
