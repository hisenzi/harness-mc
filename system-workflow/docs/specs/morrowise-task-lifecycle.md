# MorroWise Canonical Task Lifecycle

狀態：JV-32 內建 route

Owner task：`$COLLAB/harness-mc/milestones/morrowise/tasks.json#task-lifecycle-jv32-gate`

正本：`milestones/<project>/tasks.json`；跨 repo 的單一寫入者流程使用 append-only `task-events/pending/`。GitHub Issues、Heptabase、Canvas、dashboard、chat 與截圖均不是 task state 正本。

## 目的與邊界

`task-lifecycle` 是 JV-32 內的 canonical task mutation gate，不是第二套 task 系統，也不授權外部寫入、commit、push、部署、登入或讀取秘密。

任何新增、語意修改、暫緩、恢復、完成、取消或封存 canonical task 的動作，都必須先有 Vincent 明確 task-state mutation 核准、可檢查的 diff、原因與驗證計畫，然後在 task 的 `jv32_route.workflows` 加入 `task-lifecycle`，並追加一筆 `task_lifecycle.history`。

## Operation 與狀態

| operation | 使用時機 | status 規則 | 額外資料 |
| --- | --- | --- | --- |
| `create` | 建立新 task | `from_status` 必為 `null` | 建立原因與來源證據 |
| `amend` | 同一 status 下的語意修改，或一般進度狀態變化 | `to_status` 必與現況一致 | 修改原因與證據 |
| `suspend` | 暫時停用／等待條件 | `to_status` 必為 `deferred` | `reactivation_criteria` |
| `resume` | 從 `deferred` 回到可執行狀態 | 不可仍是 `deferred` | 恢復依據 |
| `complete` | 結束為 `done`／`completed`／`fixed` | 必經 `closeout-commit-routing` | 驗收／verifier／commit 或 task-event 證據 |
| `cancel` | 不再執行 | `to_status` 必為 `cancelled` | `replacement_task_id` 或 `no_replacement_reason` |
| `archive` | 歷史封存或已被取代 | `to_status` 必為 `archived` | 封存原因；若有取代者填 `superseded_by` |

不存在 `disabled` status。使用者說「停用」時，必須在 `deferred`、`cancelled`、`archived` 中選一個語意正確的結果。`blocked` 仍是 active task，不是停用。

## 最小記錄

```json
{
  "jv32_route": { "workflows": ["task-lifecycle"] },
  "task_lifecycle": {
    "route": "JV-32/task-lifecycle",
    "history": [{
      "operation": "amend",
      "from_status": "todo",
      "to_status": "todo",
      "reason": "說明 canonical task 為何需要修改。",
      "evidence_refs": ["可重跑的文件、verifier 或 task ref"],
      "recorded_at": "YYYY-MM-DD"
    }]
  }
}
```

`history` 為 append-only；既有 event 不可覆寫。內容只可保存安全 metadata、原因與 evidence reference，不可保存 token、Cookie、帳號、秘密、runtime auth 或私人設定。

## Gate 與驗證

1. 先判斷正本 project 與 active owner task；跨 repo 變更不得直接繞過 task event single-writer 流程。
2. Vincent 明確核准 task-state mutation 後，追加 lifecycle event 與所需的 `jv32_route`。
3. 執行 `node scripts/validate-tasks.mjs --changed-only`。新 task、語意修改、停用、恢復與完成若缺 route、history、理由、狀態一致性或 closeout 條件，必須 fail。
4. 執行 `node scripts/generate-data.mjs`，確認 generated surface 只反映 canonical state。
5. 完成 status 額外依 JV-32 `closeout-commit-routing` 走 verification-before-completion、必要的 cc-log、worktree-commit 與 task completion evidence；此 route 不取代 Vincent 的 commit／push 核准。

## Architecture Admission Review

若 task 變更的是已 promoted 架構子系統的正本、schema、verifier、policy 或 routing，不能只因 `ARCHITECTURE.md` 是薄索引就略過架構收編判斷。task 的 `architecture_decision.admission_review` 必須記錄：既有 Admission Record、`updated` 或 `no_index_change` 的索引決定、理由、證據與 `sync-architecture-subsystems.py --check` 參照。

對 JV-32，`verify-morrowise-dev-workflow-catalog.mjs` 會比對 Admission Record 的受管 contract fingerprint；任一受管來源內容變動，都會要求先更新 `version_review`，再由受控 sync 重建／檢查 `ARCHITECTURE.md` marker block。這是架構索引同步，不是把 workflow 的細節複製進架構文件。

## 外部與安全邊界

- GitHub Issues／GitLab Issues 僅是 `adapter_only`；即使有外部寫入核准，也不能成為 MC task state 正本。
- `task-lifecycle` 不執行外部 tracker、Heptabase、Notion、Canvas 或 dashboard 寫入。
- 不得用 chat、Agent client diagnostic 或 UI 顯示直接覆寫 task state。
- 不得藉由 lifecycle evidence 讀取或輸出任何秘密或認證資料。
