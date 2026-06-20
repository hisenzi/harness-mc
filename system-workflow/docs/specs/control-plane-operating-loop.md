# Control Plane 運行迴路

> Task: `acp-control-plane-operating-loop` (`ACP-MC-20`)
> Status: draft
> Updated: 2026-06-20

## 目的

把 Vincent 的系統性思考固定成可重複運行的流程，而不是每次發現缺口才補一個文件、一張卡或一段規則。

此文件對照 `harness-mc/milestones/harness-mc` 既有任務，定義 MC control-plane 工作如何從討論進入 task、視覺層與儀表板。

## 核心迴路

```text
討論 / 想法
  -> 可行判斷
  -> Task gate
  -> MC tasks.json
  -> MC read model
  -> Heptabase card
  -> Obsidian Canvas mirror
  -> MC dashboard freshness
  -> 下一輪討論 / 執行
```

## 必經 gate

| Gate | 對應 task | 何時觸發 | 通過標準 |
|---|---|---|---|
| Task-before-work | `acp-task-before-work-gate` | 要改文件、改資料、做 mockup、同步外部工具或進入執行前 | 回報 `work anchor`、`task source`、`done_condition`。 |
| Visual sync coverage | `acp-visual-sync-coverage-gate` | task 新增 / 更新 / 完成後 | 回報 MC task、Heptabase、Obsidian Canvas 三層狀態與 gaps。 |
| External sync queue | `acp-external-sync-queue` | task state 變更後需同步外部視覺層或 Notion | 產生可重試的 `sync_requested / synced / failed` 狀態，不讓外部失敗阻斷 source update。 |
| Canvas hook | `acp-obsidian-canvas-sync-hook` | MC read model 或 Heptabase refs 更新後 | 跑 `npm run sync:obsidian-canvas`，必要時 Heptabase refs 回寫後再跑一次。 |
| Freshness contract | `acp-system-attention-freshness-contract` | 儀表板呈現控制台狀態時 | 首頁顯示最後更新時間與 source 狀態，不把舊快照偽裝成現況。 |

## 文件路由

文件不能只是被放進 docs。文件必須被路由到工作流程。

| 文件 | 何時讀 | 目前入口 |
|---|---|---|
| `$COLLAB/notyet-harness/000_Agent/docs/agent-control-plane/README.md` | 不確定該讀哪份 ACP 文件時 | docs index |
| `visual-layer-transition-protocol.md` | 任務碰到 Heptabase / Canvas / MC read model 時 | planning、project-init、worktree-commit、heptabase-task-cards |
| `heptabase-task-external-refs-schema-260613.md` | 寫入或驗證 `external_refs.heptabase` 時 | heptabase-task-cards / visual sync |
| `mcp-tools-boundary-map-260613.md` | 接工具、CLI、MCP 或外部系統時 | tool / sync planning |
| `execution-plan-260613.md` | 新增 control-plane task 或規劃 ACP work 時 | planning |

## 第一階段：讓本地 source 自動跑起來

範圍先限本地 source：

- `milestones/*/tasks.json`
- `task-events/pending/*.json`
- `task-events/rejected/*.json`
- `scripts/generate-data.mjs`
- `scripts/generate-task-event-data.mjs`
- `scripts/sync-obsidian-canvas.mjs`

成功標準：

1. 任務變更後，MC read model 會重建。
2. Heptabase refs 回寫後，Canvas 會再同步。
3. Dashboard 顯示 `last_generated_at` 或等價 freshness 資訊。
4. 如果同步未完成，首頁顯示 pending gap，而不是隱藏。

## 第二階段：外部 source 只顯示 last checked

Heptabase、Notion 等外部 source 先不宣稱 live。

第一版只顯示：

- `last_checked_at`
- `last_success_at`
- `pending_sync_count`
- `failed_sync_count`

只有在有可靠 trigger / queue / retry actor 後，才把外部 source 納入自動刷新。

## 停下條件

遇到以下情況不要硬補：

1. 沒有 task anchor。
2. 不知道文件該放哪裡，且 README 沒有對應類型。
3. 視覺層與 MC task 狀態不一致。
4. 同步需要讀取 credentials、token files、app storage 或 local database。
5. 外部同步失敗但沒有 queue / retry 狀態可追蹤。

## 驗收方式

本迴路不是靠「文件寫完」驗收，而是靠下一次工作能不能自然跑起來：

1. Agent 能在動手前找到 work anchor。
2. Agent 能知道該讀哪份 protocol / schema。
3. Task 寫入後能說清楚 Heptabase / Canvas / MC dashboard 是否同步。
4. Dashboard 能顯示資料最後更新時間。
5. 缺口會變成 pending gap 或 task，而不是留在聊天裡。
