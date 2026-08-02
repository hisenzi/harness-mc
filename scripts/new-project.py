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
  python3 scripts/new-project.py promote --id "my-project" --repo-create-receipt /path/to/receipt.json
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

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


def require_write_admission(destination: Path, topology_registry: str = None):
    """在任何 project-init mkdir／同步前取得 target-specific topology admission。"""
    registry = Path(topology_registry) if topology_registry else DEFAULT_TOPOLOGY_REGISTRY
    result = subprocess.run(
        [
            "node",
            str(WRITE_ADMISSION),
            "--collab-root",
            str(COLLAB_DIR),
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
        "repo_ref": None,
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
        print("   ⚠️ 記得更新 MEMORY.md 加入 Repo 行")
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
    project_dir = PROJECTS_DIR / args.id
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
    print("   ✅ 成果契約與 starter task taxonomy 已建立；下一步依 task lifecycle 執行。")


def main():
    parser = argparse.ArgumentParser(description="Mission Control 開案自動化")
    subparsers = parser.add_subparsers(dest="command")

    promote_parser = subparsers.add_parser("promote", help="升級 internal → standalone")
    promote_parser.add_argument("--id", required=True, help="專案 ID")
    promote_parser.add_argument("--deploy", default=None, help="部署目標 (zeabur/vps/none)")
    promote_parser.add_argument("--repo-create-receipt", required=True, help="Vincent 精準 repo 建立 receipt JSON")
    promote_parser.add_argument("--topology-registry", default=None, help=argparse.SUPPRESS)

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
    parser.add_argument("--repo-create-receipt", default=None, help="Vincent 精準 repo 建立 receipt JSON")
    parser.add_argument("--topology-registry", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--template", default=None, help="（已棄用，請用 --type）")
    parser.add_argument("--repo-path", default=None, help="（已棄用）")

    args = parser.parse_args()

    if args.command == "promote":
        args.repo_create_receipt = load_repo_create_receipt(args.repo_create_receipt, args.id)
        promote(args)
        return

    if args.template and not args.type:
        args.type = "standalone" if args.template == "product" else args.template

    if not args.id or not args.name or not args.desc:
        parser.error("需要 --id, --name, --desc")
    if not args.type:
        parser.error("需要 --type (internal 或 standalone)")

    validate_outcome_contract(parser, args)
    args.repo_create_receipt = load_repo_create_receipt(args.repo_create_receipt, args.id)

    create(args)


if __name__ == "__main__":
    main()
