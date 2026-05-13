# Mission Control 共享儀表板 — 雙刀流開案交接

> 給別的 session 用的開案說明。讀完後按「待辦」執行。

## 這是什麼

Mission Control（共享 MC）是 agent 無關的專案追蹤儀表板。資料屬於 Vincent，CC 和 HiSenzi 都能讀寫。

從 OC MC（`.openclaw_260418/mission-control/`，port 3000）抽取通用部分獨立出來，**兩套完全獨立，不共享程式碼，僅資料格式相容**。

## 位置與狀態

| 項目 | 值 |
|------|---|
| 路徑 | `/Users/somedesign/Downloads/Claude_協作/harness-mc/` |
| 性質 | 獨立 git repo（不在 notyet-harness 內） |
| 技術棧 | Next.js 16 + React 19 + Tailwind v4 + TypeScript |
| Port | 3001（`.claude/launch.json` name: `mc`） |
| git | ✅ 已 init，initial commit `5838fa7`（18 files，+2798 行） |
| GitHub remote | ❌ 未建（Vincent 決定 repo name） |

## 架構：Harness Engineering 四大支柱

| 支柱 | 路由 | 狀態 |
|------|------|------|
| 規劃與執行 | `/projects` — 按 track 分組，任務進度 | Phase 1 ✅ |
| 評估 | `/evaluation` — 按 verdict 分組，驗證結果/issues/foundation | Phase 1 ✅ |
| 記憶 | 首頁灰色卡片 | Phase 2 |
| 工具 | 首頁灰色卡片 | Phase 3 |

## 資料層

- 專案資料在 `milestones/` 目錄（不是 `data/` 或 `projects/`）
- 每個專案一個子目錄：`project.json`（metadata）+ `tasks.json`（任務）
- 格式沿用 OC milestones，API 支援三種 JSON 格式（array / flat / dev-ops split）
- HC 驗證擴充欄位：`foundation`、`verdict`、`issues_found`/`issues_fixed`、`note`

## 首個專案：HC 思考習慣驗證

`milestones/hc-validation/` — 驗證 20 個 priority HC 的底層邏輯與操作手冊準確度。

- 3 個已驗（fallacies / confirmationBias / breakItDown），各 2 issues，全部「可用需修」
- 17 個未驗證
- 三條 track：formal-logic（2）、cognitive-science（6）、methodology（12）

## 已完成

- ✅ 程式碼：首頁 + `/projects` + `/evaluation` + API
- ✅ git init + initial commit
- ✅ `000_Agent/ARCHITECTURE.md` 第八節已更新（拆成 8-A OC MC / 8-B 共享 MC）
- ✅ CC memory 已寫（`project_mission_control.md`）
- ✅ cc-log 已寫入 `memory/daily/2026-05-13.md`
- ✅ MC 自己的架構文件 `mission-control/ARCHITECTURE.md`

## 待辦（這個 session 要做的）

### 1. 更新共享 MEMORY.md

CC 唯讀，需要有寫入權限的 session 處理。

現有條目（第 41-46 行附近）：
```
## [P1] Mission Control
- status: active（2026-03-14）| 22/28 done (79%)
- 位置: ~/.openclaw/mission-control/
```

改成兩條，區分 OC MC 和共享 MC：
```
## [P1] Mission Control（OC）
- status: active（2026-03-14）| 22/28 done (79%)
- 位置: ~/.openclaw/mission-control/

## [P1] Mission Control（共享）
- status: active（2026-05-13 開案）
- 位置: Claude_協作/harness-mc/（獨立 git repo，hisenzi/harness-mc）
- Harness Engineering 四大支柱，HC 驗證為首個專案
```

### 2. Obsidian 專案頁

建立 `Projects/mission-control-shared.md`（或用 sync script 同步）。

### 3. GitHub remote（問 Vincent）

決定 repo name 和 private/public 後建立。建議：`hisenzi/mission-control-shared` 或 `hisenzi/harness-mc`。

## 參考

- 完整架構：`mission-control/ARCHITECTURE.md`
- 共享層架構更新：`000_Agent/ARCHITECTURE.md` 第八節
- cc-log：`000_Agent/memory/daily/2026-05-13.md` → `## [CC] Mission Control 共享儀表板開案`
