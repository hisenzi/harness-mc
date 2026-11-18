# harness-mc（已停用封存，2026-11-18）

> **封存公告**：本專案自 **2026-11-18** 起進入停用封存狀態，僅保留歷史查閱與少數尚未遷出之工具，不再作為日常任務、通知或健康檢查之執行入口。

## 功能替代與現行入口

| 原先功能 | 現行替代位置 | 追蹤 Issue |
|---|---|---|
| 任務工作流（`milestones/*/tasks.json`） | GitHub Issues（`milestones/` 自 2026-10-26 凍結，commit／push 不再依賴 `tasks.json`） | [`notyet-harness#33`](https://github.com/hisenzi/notyet-harness/issues/33) |
| 每日通知推播與管理開關 | `notyet-harness/schedule/notifications.json`＋Linode 雲端 timers／MorroWise「通知管理」 | [`notyet-harness#37`](https://github.com/hisenzi/notyet-harness/issues/37) |
| 每日健康檢查（`system-pulse`） | `notyet-harness/schedule/lib/morrowise_health.py`（`morrowise-health`） | [`notyet-harness#39`](https://github.com/hisenzi/notyet-harness/issues/39) |
| 停用排程歸檔與元件說明 | `notyet-harness/schedule/retired-tasks/README.md`、`schedule/system-pulse-notifications.md` | [`notyet-harness#39`](https://github.com/hisenzi/notyet-harness/issues/39) |

## 僅存關聯與歷史快照

- **僅存關聯**：`scripts/codex_workspace_cleanup.py`（每週日 10:00 Codex 唯讀工作區盤點，見 [`harness-mc#12`](https://github.com/hisenzi/harness-mc/issues/12)）。
- **轉出評估**：原 `system-pulse` 八項歷史失敗、`scripts/verify-schedule-liveness.mjs`、`scripts/run-system-pulse.mjs` 及 `scripts/lib/trusted-heartbeat.mjs` 已於 2026-11-18 轉入 [`notyet-harness#1`](https://github.com/hisenzi/notyet-harness/issues/1#issuecomment-6982204098) 後續評估。
- **停用前工作區現場快照**：已完整保存於分支 [`archive/worktree-20261118`](https://github.com/hisenzi/harness-mc/tree/archive/worktree-20261118) 與標籤 [`archive/pre-retirement-20261118`](https://github.com/hisenzi/harness-mc/releases/tag/archive/pre-retirement-20261118)（含 `JV-12` 移除修改、`sentinel-diff.mjs` 緩衝修正、`schedule-liveness` 自鎖修正、`milestones/supatw/` 及 2026-11-15 `system-pulse` 生成快照）。
