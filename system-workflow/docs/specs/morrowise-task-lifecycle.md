# MorroWise Canonical Task Lifecycle

狀態：JV-32 內建 route

Owner task：`$COLLAB/harness-mc/milestones/morrowise/tasks.json#task-lifecycle-jv32-gate`

正本：`milestones/<project>/tasks.json`；跨 repo 的單一寫入者流程使用 append-only `task-events/pending/`。GitHub Issues、Heptabase、Canvas、dashboard、chat 與截圖均不是 task state 正本。

## 目的與邊界

`task-lifecycle` 是 JV-32 內的 canonical task mutation gate，不是第二套 task 系統，也不授權外部寫入、commit、push、部署、登入或讀取秘密。

任何新增、語意修改、暫緩、恢復、完成、取消或封存 canonical task 的動作，都必須先有 Vincent 明確 task-state mutation 核准、可檢查的 diff、原因與驗證計畫，然後在 task 的 `jv32_route.workflows` 加入 `task-lifecycle`，並追加一筆 `task_lifecycle.history`。

## Title 命名規範

Canonical task 的 `title` 以繁體中文為主要語言。Task ID、產品名稱、套件名稱、API、CLI、schema field、Prototype 等不可變技術識別碼可保留原文，但不得使用全英文作為主要標題。

允許：

- `對話驅動 Prototype 生成流程可行性驗證`
- `Paper Shader 轉接層與語意預設驗證`
- `Block Registry 重複與分類檢查`

拒絕：

- `Conversation-to-Prototype Runtime Spike`
- `Paper Shader Integration`
- `Block Registry Validator`

規範語意以繁體中文為準；validator 不以不可靠的字表猜測繁簡字形，而是在 changed-only 模式對新增或本次變更的 task 機械要求 `title` 至少包含一個 Han 字元。全 ASCII／全英文標題必須 fail；未變更的歷史 task 不追溯改寫，full scan 僅以 warning 顯示，待該 task 下次語意修改時再依本規範修正。

## Operation 與狀態

| operation | 使用時機 | status 規則 | 額外資料 |
| --- | --- | --- | --- |
| `create` | 建立新 task | `from_status` 必為 `null` | 建立原因與來源證據 |
| `amend` | 同一 status 下的語意修改，或一般進度狀態變化 | `to_status` 必與現況一致 | 修改原因與證據 |
| `suspend` | 暫時停用／等待條件 | `to_status` 必為 `deferred` | `reactivation_criteria` |
| `resume` | 從 `deferred` 或已關閉狀態重新進入可執行狀態 | 不可仍是 `deferred`／closed | 恢復依據 |
| `complete` | 結束為 `done`／`completed`／`fixed` | 必經 `closeout-commit-routing` | 驗收／verifier／commit 或 task-event 證據 |
| `cancel` | 不再執行 | `to_status` 必為 `cancelled` | `replacement_task_id` 或 `no_replacement_reason` |
| `archive` | 歷史封存或已被取代 | `to_status` 必為 `archived` | 封存原因；若有取代者填 `superseded_by` |

不存在 `disabled` status。使用者說「停用」時，必須在 `deferred`、`cancelled`、`archived` 中選一個語意正確的結果。`blocked` 仍是 active task，不是停用。不得從 canonical `tasks.json` 物理刪除 task，也不得刪除整份檔案；不再執行時必須保留歷史並走 `cancel` 或 `archive`。

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

## Semantic Task Intake

MorroWise 的新增或語意修改 task 在寫入正本前，必須把 `semantic_intake` 放在本次最新 lifecycle event。它不是關鍵字查重，而是固定檢查四個邊界：問題、owner／source of truth、輸入輸出、lifecycle／completion。

```json
{
  "semantic_intake": {
    "outcome": "amend",
    "compared_task_refs": ["morrowise/morrowise-dev-workflow-catalog"],
    "scope_comparison": {
      "problem": "兩者都在處理 canonical task intake。",
      "owner_source_of_truth": "owner 與正本同為 JV-32／tasks.json。",
      "inputs_outputs": "沿用既有 route、schema 與 verifier。",
      "lifecycle_completion": "完成邊界仍是同一個 version improvement。"
    },
    "decision_reason": "同一責任邊界，更新既有 task，不新增 task。",
    "approval": {
      "status": "approved",
      "approved_by": "Vincent",
      "approved_at": "YYYY-MM-DD",
      "evidence_refs": ["可持久查核的核准與 task ref"]
    }
  }
}
```

結果與寫入規則固定如下：

- `reuse`：read-only 結果，不得產生 canonical mutation。
- `amend`：只用於既有 task，且必須有 Vincent 明確核准。
- `replace`：只由新 successor 的 create event 使用，必須填 `replaces_task_refs`；被取代 task 必須在同一 canonical state 中 archive 或 cancel。
- `genuinely_new`：只用於新 task。
- 無法判定、比較引用不存在或未核准時 hard-fail。

只有 `commits`、`completed_at`、`summary`、`external_refs`、`jv32_route`、`task_lifecycle` 的 bookkeeping-only mutation 可不重跑 semantic intake；status、scope、note、done condition、依賴、weekly core 與 review date 都是語意變更。

## Project Deadline 與 Task Review Date Ownership

- 每個 project 的 `created`、`estimated_completion` 與 `outcome.success_target.due` 只由自己的 `$COLLAB/harness-mc/milestones/<project>/project.json` 擁有。
- Task 的 `review_date`、checkpoint 與 completion date 只由同一 project 的 `$COLLAB/harness-mc/milestones/<project>/tasks.json` 擁有；`review_date` 是 task lifecycle checkpoint，不是 project deadline。
- MorroWise 的 project deadline 只由 `$COLLAB/harness-mc/milestones/morrowise/project.json` 擁有；MorroWise weekly-core／review-date gate 不得成為其他 project 的隱性時間依賴。
- 一個 project 的 deadline 或 task review date 不得阻塞另一個 project；只有 canonical state 中明確宣告的 dependency 可以形成跨 project block。
- 不得為了解除另一個 project 的 validation、build 或 delivery 阻塞而 reframe MorroWise task。

## Weekly Core 與 Review Date

MorroWise 每次最多一個 task 可設 `weekly_core: true`。該 task 必須同時是 `in_progress` 且有 `review_date: YYYY-MM-DD`；首次進入 slot 時，最新 lifecycle event 必須帶 `weekly_core_review.decision: admit`、Vincent 核准證據與相同的 `next_review_date`。

當 Asia/Taipei 的 `as_of >= review_date`，到期處置只約束該 weekly-core task，不是 MorroWise 全案停工期限：

- work-anchor preflight 以該 weekly-core task 為 target 時必須 hard-fail；以無關非核心 task 為 target 時可繼續，但必須輸出 `weekly_core_overdue` warning、逾期 task identity 與人工 next action，不得假裝 healthy。
- changed-only validator 只有在該逾期 weekly-core task 本次確實被修改時才輸出到期錯誤；未修改的逾期 task 不得阻擋其他 MorroWise task 的 scoped mutation。
- full governance audit 仍可報告逾期狀態，但不得被包裝成無關 task 的隱性 execution dependency。

要繼續或變更該逾期 weekly-core task，只能由 Vincent 明確選擇：

- `reframe`：維持 `in_progress`，更新 scope 與 review date；event 必須精確記錄 `previous_review_date`、`next_review_date`、`new_scope` 及重新核准。
- `suspend`：task 轉 `deferred`，清除 weekly core／review date，保留 `reactivation_criteria`。
- `cancel`：task 轉 `cancelled`，清除 weekly core／review date，保留 replacement 或 no-replacement 理由。
- `complete`：驗收後走既有 closeout route，清除 weekly core／review date；最新 event 必須記錄 `weekly_core_review.decision: complete` 與 Vincent 核准。

禁止在 task 仍為 `in_progress` 時直接清掉 weekly core，也禁止只改日期、以未回覆或排程默認延長。

## Completion Evidence Contract

只有本次 mutation 從 active status 轉入 `done`、`completed` 或 `fixed` 時，changed-only validator 才強制執行 completion evidence gate；既有 closed task 的歷史內容不追溯改寫，closed-to-closed amendment 仍依原 lifecycle 與 Architecture Admission 規則處理。

可執行行為使用 `test_contract.applicability: required`，必須定義 observable `behavior_cases`、`test_level`、Red command／預期失敗、Green command、完整 regression commands、fixture refs、runtime evidence flag 與 evidence refs。實際驗收結果放在 `completion_evidence`，至少包含：

- `red_evidence` 與 `green_evidence`。
- `regression_evidence` 與可重跑的 `verifier_refs`。
- 說明 fixture 與真實 runtime claim 界線的 `fixture_runtime_boundary`。
- 當 `runtime_evidence_required: true` 時，另附安全 metadata 的 `runtime_evidence`；fixture、plist 存在或未載入 scheduler 均不可取代真實 runtime evidence。

純文件或純治理 task 可使用 `test_contract.applicability: exempt`，不假造 Red／Green，但必須記錄非空的 `tdd_exemption_reason`、`alternative_verification_commands`、evidence refs，以及 `completion_evidence` 內可重跑的 regression evidence、verifier 與 fixture/runtime boundary。

`completion_evidence` 只保存安全 evidence reference 或重跑指令，不保存 token、Cookie、帳密、秘密、runtime auth 或私人設定，也不授權 commit、push、部署或外部 tracker 寫入。

## Gate 與驗證

1. 先判斷正本 project 與 active owner task；跨 repo 變更不得直接繞過 task event single-writer 流程。
2. Vincent 明確核准 task-state mutation 後，追加 lifecycle event 與所需的 `jv32_route`。
3. 本機 worktree 執行 `node scripts/validate-tasks.mjs --changed-only`；clean CI 執行 `node scripts/validate-tasks.mjs --base <base-git-ref>` 驗證 `<base>..HEAD`。兩種 changed-only scope 都只讓實際變更的 project fatal；未變更的 MorroWise weekly-core／review-date 不得阻塞其他 project。新 task、語意修改、停用、恢復與完成若缺 route、history、semantic intake、理由、狀態一致性或 closeout 條件，必須 fail；測試／回放可用 `--as-of YYYY-MM-DD` 固定時鐘。
4. 進入 MorroWise implementation 前執行 `node scripts/work-anchor-preflight.mjs --project morrowise --task-id <id> --event implementation --scope <path>`；到期 weekly core 必須先處置，不能繼續改檔。
5. 執行 `node scripts/generate-data.mjs`，確認 generated surface 只反映 canonical state。
6. 完成 status 額外依 JV-32 `closeout-commit-routing` 走 verification-before-completion、必要的 cc-log、worktree-commit 與 task completion evidence；此 route 不取代 Vincent 的 commit／push 核准。

## Architecture Admission Review

若 task 變更的是已 promoted 架構子系統的正本、schema、verifier、policy 或 routing，不能只因 `ARCHITECTURE.md` 是薄索引就略過架構收編判斷。task 的 `architecture_decision.admission_review` 必須記錄：既有 Admission Record、`updated` 或 `no_index_change` 的索引決定、理由、證據與 `sync-architecture-subsystems.py --check` 參照。

對 JV-32，`verify-morrowise-dev-workflow-catalog.mjs` 會比對 Admission Record 的受管 contract fingerprint；任一受管來源內容變動，都會要求先更新 `version_review`，再由受控 sync 重建／檢查 `ARCHITECTURE.md` marker block。這是架構索引同步，不是把 workflow 的細節複製進架構文件。

## 外部與安全邊界

- GitHub Issues／GitLab Issues 僅是 `adapter_only`；即使有外部寫入核准，也不能成為 MC task state 正本。
- `task-lifecycle` 不執行外部 tracker、Heptabase、Notion、Canvas 或 dashboard 寫入。
- 不得用 chat、Agent client diagnostic 或 UI 顯示直接覆寫 task state。
- 不得藉由 lifecycle evidence 讀取或輸出任何秘密或認證資料。
