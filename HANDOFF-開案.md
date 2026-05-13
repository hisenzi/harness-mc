# Harness MC — 開案紀錄

> 2026-05-13 開案完成。本文件供新 session 快速理解專案全貌。

## 這是什麼

Harness MC 是 agent 無關的共享儀表板。資料屬於 Vincent，CC 和 HiSenzi 都能讀寫 milestones。

與 OC MC（`.openclaw_260418/mission-control/`，port 3000）**完全獨立**，不共享程式碼，僅資料格式相容。

## 位置

| 項目 | 值 |
|------|---|
| 路徑 | `/Users/somedesign/Downloads/Claude_協作/harness-mc/` |
| GitHub | `hisenzi/harness-mc`（private） |
| 技術棧 | Next.js 16 + React 19 + Tailwind v4 + TypeScript |
| Port | 3001（`package.json` 內建，`.claude/launch.json` name: `mc`） |

## Harness Engineering 四大支柱

| 支柱 | 路由 | 狀態 |
|------|------|------|
| 規劃與執行 | `/projects` — 按 track 分組，任務進度 | Phase 1 ✅ |
| 評估 | `/evaluation` — 按 verdict 分組，驗證結果 | Phase 1 ✅ |
| 記憶 | 首頁灰色卡片 | Phase 2 |
| 工具 | 首頁灰色卡片 | Phase 3 |

## 資料層

- `milestones/` 目錄，每個專案一個子目錄：`project.json` + `tasks.json`
- 格式沿用 OC milestones，API 支援三種 JSON 格式
- HC 驗證擴充欄位：`foundation` / `verdict` / `issues_found` / `issues_fixed` / `note`

## 開案檢查清單

- [x] 程式碼：首頁 + `/projects` + `/evaluation` + API
- [x] git init + initial commit + 推 GitHub
- [x] 資料夾定名 `harness-mc`（從 mission-control 改名）
- [x] 共享 `000_Agent/ARCHITECTURE.md` 第八節拆 8-A(OC) / 8-B(共享)
- [x] 共享 `000_Agent/memory/MEMORY.md` 新增 `[P1] Mission Control（共享）`
- [x] CC memory `project_mission_control.md`
- [x] cc-log `memory/daily/2026-05-13.md`
- [x] Typography 5-tier tokens（caption/small/body/heading/title）
- [ ] Obsidian `Projects/harness-mc.md`（等 sync script 適配或手動建）

## 參考

- 完整架構：`harness-mc/ARCHITECTURE.md`
- 共享層：`000_Agent/ARCHITECTURE.md` § 8-B
- CC memory：`~/.claude/projects/*/memory/project_mission_control.md`
