#!/usr/bin/env python3
"""
new-project.py — 開案自動化（MC 版）
自動建立 Mission Control 專案目錄（harness-mc/milestones/{id}/），
產生 project.json + tasks.json（含 done_condition + phase-verify），
同步到 Obsidian，並 rebuild MC 儀表板。
standalone 類型自動建 GitHub repo + 更新 repos.json + ARCHITECTURE.md。

用法：
  python3 scripts/new-project.py --id "my-project" --name "我的專案" --desc "一句話說明" --type internal
  python3 scripts/new-project.py --id "my-app" --name "我的應用" --desc "說明" --type standalone
  python3 scripts/new-project.py promote --id "my-project"
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
OPENCLAW_DIR = Path.home() / ".openclaw"
GEN_DATA     = MC_DIR / "scripts" / "generate-data.mjs"


def make_project_json(args) -> dict:
    proj_type = args.type

    base = {
        "name":        args.name,
        "description": args.desc,
        "type":        proj_type,
        "status":      "active",
        "priority":    args.priority,
        "created":     datetime.now().strftime("%Y-%m-%d"),
        "estimated_completion": args.due,
        "tracks": {
            "phase-1": "Phase 1",
        },
    }

    if proj_type == "standalone":
        base["tracks"]["deploy"] = "部署"
        base.update({
            "goals": [
                "MVP 上線",
                "（請補充）",
            ],
            "risks": [
                {"risk": "部署延遲", "impact": "medium", "probability": "medium", "mitigation": "先本機驗證再上 Zeabur"},
            ],
            "success_criteria": [
                {"criterion": "可部署到目標平台", "verify_cmd": "curl -s -o /dev/null -w '%{http_code}' <URL>", "expected": "200"},
                {"criterion": "核心功能可正常操作", "verify_cmd": "（填入驗證指令）", "expected": "（預期結果）"},
            ],
        })
    else:
        base.update({
            "goals": [
                "（請填入目標 1）",
                "（請填入目標 2）",
            ],
            "risks": [
                {"risk": "（請填入風險）", "impact": "medium", "probability": "medium", "mitigation": "（請填入應對方式）"},
            ],
            "success_criteria": [
                {"criterion": "（請填入驗收標準）", "verify_cmd": "（驗證指令）", "expected": "（預期結果）"},
            ],
        })

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
                "done_condition": "goals + success_criteria 已填入 project.json，非 placeholder"
            },
            {
                "id":     "p1-2",
                "title":  "架構設計（技術棧選定、系統架構文件）",
                "status": "todo",
                "track":  "phase-1",
                "done_condition": "ARCHITECTURE.md 或等效文件已建立"
            },
            {
                "id":     "p1-verify",
                "title":  "Phase 1 驗收整合",
                "status": "todo",
                "track":  "phase-1",
                "done_condition": "success_criteria + done_condition + 環境異動彙整完成",
                "note":   "前置任務全 done 後執行"
            }
        ]
    }


# ── Standalone repo 建立 ──────────────────────────────────────────────────

def setup_standalone_repo(project_id: str, name: str, desc: str, deploy_target: str = None):
    """建立 GitHub repo + clone + 初始化 + 更新 repos.json + ARCHITECTURE.md"""
    repo_dir = OPENCLAW_DIR / project_id

    print(f"\n📦 建立 GitHub repo: hisenzi/{project_id}")
    result = subprocess.run(
        ["gh", "repo", "create", f"hisenzi/{project_id}", "--private", "--clone"],
        capture_output=True, text=True, cwd=str(OPENCLAW_DIR)
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
                r["path"] = f"~/.openclaw/{project_id}"
                r["remote"] = f"hisenzi/{project_id}"
                if deploy_target:
                    r["deploy_target"] = deploy_target
        print(f"  📝 repos.json: 更新 {project_id}")
    else:
        repos.append({
            "name": project_id,
            "path": f"~/.openclaw/{project_id}",
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
        print(f"   本地: ~/.openclaw/{args.id}/")
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
    if project_dir.exists():
        print(f"❌ 專案 '{args.id}' 已存在：{project_dir}")
        sys.exit(1)

    project_dir.mkdir(parents=True)
    print(f"📁 建立目錄：{project_dir}")

    proj_path = project_dir / "project.json"
    proj_path.write_text(
        json.dumps(make_project_json(args), ensure_ascii=False, indent=2) + "\n"
    )
    print(f"✅ 建立：{proj_path.name}")

    ms_path = project_dir / "tasks.json"
    ms_path.write_text(
        json.dumps(make_tasks_json(args), ensure_ascii=False, indent=2) + "\n"
    )
    print(f"✅ 建立：{ms_path.name}")

    if args.type == "standalone":
        deploy_target = getattr(args, "deploy", None)
        setup_standalone_repo(args.id, args.name, args.desc, deploy_target)

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
    if args.type == "standalone":
        print(f"   Repo: https://github.com/hisenzi/{args.id}")
        print(f"   本地: ~/.openclaw/{args.id}/")
    print("   ⚠️ 待辦：補充 project.json placeholder + 更新 MEMORY.md [P1]")


def main():
    parser = argparse.ArgumentParser(description="Mission Control 開案自動化")
    subparsers = parser.add_subparsers(dest="command")

    promote_parser = subparsers.add_parser("promote", help="升級 internal → standalone")
    promote_parser.add_argument("--id", required=True, help="專案 ID")
    promote_parser.add_argument("--deploy", default=None, help="部署目標 (zeabur/vps/none)")

    parser.add_argument("--id",       help="專案 ID（英文、連字號）")
    parser.add_argument("--name",     help="專案名稱")
    parser.add_argument("--desc",     help="一句話描述")
    parser.add_argument("--type",     choices=["internal", "standalone"], help="專案類型（必填）")
    parser.add_argument("--due",      default="TBD",  help="預計完成日 YYYY-MM-DD")
    parser.add_argument("--priority", default="high", choices=["high", "medium", "low"])
    parser.add_argument("--deploy",   default=None, help="部署目標 (zeabur/vps)")
    parser.add_argument("--no-sync",  action="store_true", help="只建檔，不同步 Obsidian")
    parser.add_argument("--template", default=None, help="（已棄用，請用 --type）")
    parser.add_argument("--repo-path", default=None, help="（已棄用，standalone 自動建）")

    args = parser.parse_args()

    if args.command == "promote":
        promote(args)
        return

    if args.template and not args.type:
        args.type = "standalone" if args.template == "product" else args.template

    if not args.id or not args.name or not args.desc:
        parser.error("需要 --id, --name, --desc")
    if not args.type:
        parser.error("需要 --type (internal 或 standalone)")

    create(args)


if __name__ == "__main__":
    main()
