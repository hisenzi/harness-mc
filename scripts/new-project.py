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
import json
import re
import subprocess
import sys
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


def validate_quick_args(parser, args):
    """驗證快速開案已核准的最小輸入，不要求完整治理欄位。"""
    required = {
        "--id": args.id,
        "--name": args.name,
        "--desc": args.desc,
        "--project-code": args.project_code,
        "--project-folder": args.project_folder,
        "--why-open": args.why_open,
        "--mvp-goal": args.mvp_goal,
        "--final-goal": args.final_goal,
        "--mvp-tasks-file": args.mvp_tasks_file,
    }
    missing = [flag for flag, value in required.items() if not str(value or "").strip()]
    if missing:
        parser.error(f"快速開案缺少：{', '.join(missing)}")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", args.id):
        parser.error("--id 必須是小寫英文、數字與連字號組成的 slug")

    args.project_code = args.project_code.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]+(?:-[A-Z0-9]+)*", args.project_code):
        parser.error("--project-code 必須使用英文字母、數字或連字號")

    args.collab_root = Path(args.collab_root or COLLAB_DIR).expanduser().resolve()
    args.milestones_root = Path(args.milestones_root or PROJECTS_DIR).expanduser().resolve()
    args.topology_registry = Path(
        args.topology_registry or DEFAULT_TOPOLOGY_REGISTRY
    ).expanduser().resolve()

    raw_project_folder = args.project_folder.strip()
    if raw_project_folder.startswith("$COLLAB/"):
        project_folder = args.collab_root / raw_project_folder.removeprefix("$COLLAB/")
    else:
        candidate = Path(raw_project_folder).expanduser()
        project_folder = candidate if candidate.is_absolute() else args.collab_root / candidate
    args.project_folder = project_folder.resolve()
    if args.project_folder.parent != args.collab_root:
        parser.error("--project-folder 必須是 $COLLAB 直屬專案資料夾")

    args.project_dir = args.milestones_root / args.id
    if args.project_dir.exists():
        parser.error(f"MC 專案已存在：{args.project_dir}")
    if args.project_folder.exists() and not args.project_folder.is_dir():
        parser.error(f"專案資料夾不是目錄：{args.project_folder}")
    if (args.project_folder / "README.md").exists():
        parser.error(f"README.md 已存在，不覆寫：{args.project_folder / 'README.md'}")

    args.mvp_tasks = load_quick_mvp_tasks(parser, args.mvp_tasks_file)


def load_quick_mvp_tasks(parser, source_path: str) -> list:
    """讀取由 Vincent 核准的 MVP task 清單。"""
    try:
        payload = json.loads(Path(source_path).expanduser().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        parser.error(f"MVP tasks 無法讀取：{error}")
    if not isinstance(payload, list) or not payload:
        parser.error("--mvp-tasks-file 必須是至少一項 task 的 JSON array")

    normalized = []
    seen_ids = {"quick-open", "formalize"}
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            parser.error(f"MVP task {index} 必須是 JSON object")
        task_id = str(item.get("id") or "").strip()
        title = str(item.get("title") or "").strip()
        done_condition = str(item.get("done_condition") or item.get("acceptance") or "").strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", task_id):
            parser.error(f"MVP task {index} 的 id 必須是小寫 slug")
        if task_id in seen_ids:
            parser.error(f"MVP task id 重複或使用保留值：{task_id}")
        if not title:
            parser.error(f"MVP task {task_id} 缺少明確 title")
        if not done_condition:
            parser.error(f"MVP task {task_id} 缺少驗收標準")
        seen_ids.add(task_id)
        normalized.append({
            "id": task_id,
            "title": title,
            "done_condition": done_condition,
        })
    return normalized


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


def register_quick_topology(parser, args):
    """登錄或確認 quick 專案的 canonical project home。"""
    try:
        topology = json.loads(args.topology_registry.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        parser.error(f"專案拓樸檔無法讀取：{error}")
    records = topology.get("records")
    if not isinstance(records, list):
        parser.error("專案拓樸檔缺少 records array")

    path_label = f"$COLLAB/{args.project_folder.name}"
    same_id = next((record for record in records if record.get("id") == args.id), None)
    same_path = next((record for record in records if record.get("path_label") == path_label), None)
    existing = same_id or same_path
    if same_id and same_id.get("path_label") != path_label:
        parser.error(f"拓樸中的 project id 已指向其他路徑：{args.id}")
    if same_path and same_path.get("id") != args.id:
        parser.error(f"拓樸中的 project folder 已由其他 project 使用：{path_label}")
    if existing:
        if (
            existing.get("classification") != "canonical_project"
            or existing.get("project_home_ref") != path_label
            or existing.get("migration_state") == "blocked"
        ):
            parser.error(f"既有拓樸記錄不是可寫入的 canonical project：{path_label}")
        return

    today = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y-%m-%d")
    records.append({
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
    })
    if "updated_at" in topology:
        topology["updated_at"] = today
    if "inventory_as_of" in topology:
        topology["inventory_as_of"] = today
    args.topology_registry.write_text(
        json.dumps(topology, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def quick_create(parser, args):
    """快速開案：只建立 MVP 起跑所需資料，不執行同步或正式補完。"""
    project = make_quick_project_json(args)
    tasks = make_quick_tasks_json(args)
    readme = make_quick_readme(args)

    args.project_folder.mkdir(parents=False, exist_ok=True)
    register_quick_topology(parser, args)
    require_write_admission(
        args.project_folder / "README.md",
        args.topology_registry,
        args.collab_root,
    )
    require_write_admission(args.project_dir, args.topology_registry, args.collab_root)

    args.project_dir.mkdir(parents=True)
    (args.project_folder / "README.md").write_text(readme, encoding="utf-8")
    (args.project_dir / "project.json").write_text(
        json.dumps(project, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (args.project_dir / "tasks.json").write_text(
        json.dumps(tasks, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"✅ 快速開案資料已建立：{args.id}")
    print(f"   專案資料夾：{args.project_folder}")
    print(f"   MC canonical 資料：{args.project_dir}")
    print("   尚未執行 MC 同步、Git、部署、外部同步或 formalize。")


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
    quick_parser.add_argument("--id", required=True, help="專案 ID（小寫 slug）")
    quick_parser.add_argument("--name", required=True, help="專案名稱")
    quick_parser.add_argument("--desc", required=True, help="一句話目標")
    quick_parser.add_argument("--project-code", required=True, help="人類溝通代碼，例如 VTS")
    quick_parser.add_argument("--project-folder", required=True, help="$COLLAB 直屬專案資料夾")
    quick_parser.add_argument("--why-open", required=True, help="專案為何開案")
    quick_parser.add_argument("--mvp-goal", required=True, help="MVP 目標")
    quick_parser.add_argument("--final-goal", required=True, help="最終目標")
    quick_parser.add_argument("--mvp-tasks-file", required=True, help="MVP task JSON array；每項含 id、title、done_condition")
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
        validate_quick_args(quick_parser, args)
        quick_create(quick_parser, args)
        return

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
