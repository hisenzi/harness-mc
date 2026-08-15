# Shared Memory Governance v2

> Task: `shared-memory-governance-v2` (`JV-49`)
> Status: R1-R4 verified; JV-49 canonical task completed
> Updated: 2026-08-15
> Machine-readable evidence: `$COLLAB/harness-mc/system-workflow/registries/morrowise-shared-memory-governance-v2.json`
> Verifier: `node scripts/verify-shared-memory-governance-v2.mjs`

## Outcome

讓 `$COLLAB/notyet-harness/000_Agent/memory/MEMORY.md` 保持唯一、精簡且跨 Agent 可用的 L1 入口；把操作細節、系統結構、task state、daily raw log 與 local agent memory 分流到各自正本。

品質不以行數下降或檔案數減少判定。完成必須同時證明：來源可追溯、無資料遺失、五個代表性查詢不退步、重複／漂移可見，以及未核准 candidate 不寫共享正本。

## Source boundaries

| Layer | Source of truth | Allowed content |
| --- | --- | --- |
| L0 rules | `$COLLAB/notyet-harness/000_Agent/CORE.md`、`SOUL.md`、`USER.md` | 紅線、長期偏好、共同協作規則 |
| L1 shared active memory | `$COLLAB/notyet-harness/000_Agent/memory/MEMORY.md` | 耐久決策、薄路由、高價值 active index |
| Domain procedure | `$COLLAB/notyet-harness/000_Agent/skills/<skill>/SKILL.md` | 可重複執行的完整 SOP 與驗證規則 |
| Architecture | `$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md` | 分層、owner、source-of-truth、runtime 與治理邊界 |
| Task state | `$COLLAB/harness-mc/milestones/*/tasks.json` | status、done condition、acceptance、evidence |
| Daily raw log | `$COLLAB/notyet-harness/000_Agent/memory/daily/` | 當日 session、決策與原始交接 |
| L2 archive | `$COLLAB/notyet-harness/000_Agent/memory/archive/` | 已結束、低頻或只需追溯的記錄 |
| Agent adapter memory | `$CODEX_HOME/memories/` 等本機 runtime | cache／candidate source，不是 shared truth |

## R1 classification vocabulary

每個候選段落只能使用下列一種分類：

- `retain`：符合 L1 耐久內容或正確薄路由。
- `move-to-skill`：內容是 domain procedure，完整版本應由 skill 擁有。
- `move-to-architecture`：內容是系統結構或 owner 邊界，應由 ARCHITECTURE.md 擁有。
- `archive`：歷史、daily progress 或已被現行正本取代。
- `needs-review`：可能仍有價值，但 canonical source、active state 或目標層尚未確認。

R1 的 frozen baseline 保留在 registry 與 `memory/archive/MEMORY-pre-jv49-2026-08-12.md`；實作後共享 L1 只保留耐久內容與薄路由。

## L1 content budget

- 硬上限維持 150 行，目標上限 120 行，保留後續人工補充空間。
- 每個主題只留 1–4 行的「何時查、去哪裡查、哪個例外仍重要」。
- 不保留 volatile task 數量、percent complete、每日進展、案例級 SOP、runtime 版本快照或已能由 canonical task／registry 回答的狀態。
- 行數只作容量 guardrail；五個代表性查詢的 `no regression` 才是品質 gate。

## Dated-log migration gate

2026-08-12 baseline 在 `memory/` 根目錄發現 14 份 dated logs；`archive/` 不存在。逐檔比對結果為：12 份在 `daily/` 有同名但內容不同，2 份沒有同名檔。

因此禁止把 root 檔直接覆蓋到 `daily/`，也禁止以日期較新推定內容相同。每筆 ledger 必須保存：

1. source path、SHA-256 與 line count；
2. daily 對應 path、`different|missing` 關係與 diff evidence；
3. proposed target；
4. action status；
5. recovery path。

14 份 root dated logs 已逐筆搬到 `memory/archive/root-dated-logs/`，且保留 source SHA-256、target SHA-256、daily relation 與 recovery path。`memory/archive/MANIFEST.json` 另收錄 pre-JV-49 L1 snapshot，共 15 筆可回復項目；同名 daily 檔未被覆蓋或合併。

## Memory ingress boundary

任何會建立記憶建議的 skill、template 或 script 都必須改成 agent-neutral：

- 不宣稱 HiSenzi 或 OpenClaw 專管 shared MEMORY.md。
- 不把開案、skill、案例或 project 細節直接回灌 L1。
- 先產生一筆有來源與目標層的 candidate；memory write 屬 Approval Policy 的 `memory_write_or_update`，需 Vincent 明確核准。
- daily raw log 的明確使用者要求可走 daily writer，但不得藉此自動升格 L1 或改 task state。

R2 已修正 inventory 中 13 個 active ingress。每個入口都在 registry 保存 expected／forbidden markers，讓 stale owner、硬編碼路徑與自動升格宣告可被重跑 verifier 攔截。

## Maxmodel boundary sample

「有沒有 Max One 文案」的完整條件分支只由 `$COLLAB/notyet-harness/000_Agent/skills/maxmodel-case-page/SKILL.md` 擁有：來源文案沒有 Max One 時，不新增 Max One 說明與連結。共享 L1 最多保留「做 Maxmodel 案例時讀該 skill」的薄路由，不複製完整規範。

R1 baseline 同時記錄：該 skill 與 SKILLS-INDEX.md 在觀測時仍是其他 session 的 local dirty scope；JV-49 不吸收、不修改，也不把它描述成已在 remote canonical truth。

## Local Codex candidate source

`$CODEX_HOME/memories/MEMORY.md` 只能逐筆提出 candidate，禁止 wholesale merge。registry 只保存檔案 metadata、候選來源位置與衝突摘要，不複製 local memory 全文。

每筆 candidate 必須有：

- `source`
- `reason`
- `dedupe_comparison`
- `target_layer`
- `sensitivity`
- `vincent_approval`

raw rollout、聊天全文、秘密、runtime auth、機器專屬暫態與未驗證推論一律不得晉升。

## Existing MorroWise loop only

跨 Agent candidate 只接入既有：

`Recommendation Engine → Approval Policy → Runner / task lifecycle`

R3 新增 `morrowise-memory-promotion-adapter.v1`，只把 candidate 轉成既有 Recommendation／Approval／Runner 可判斷的輸入。pending candidate 只產生 approval request；approved candidate 仍須通過 exact target、exact text hash 與 preimage SHA-256，才可由既有 Runner 寫入。不得新增第二套 queue、scheduler、notification、dashboard、task system、RAG 或向量資料庫。

負向 fixtures 固定覆蓋 unapproved、duplicate、sensitive、machine-local、raw-rollout、unverified 與 rejected；正向 approved fixture 只在 verifier 建立的臨時 `$COLLAB` root 寫入，真實 shared L1 的 fixture write count 必須為 0。

## Five representative queries

1. Maxmodel 案例沒有 Max One 原始文案時怎麼處理？
2. project/task 目前狀態去哪裡查？
3. 誰可以更新 shared MEMORY.md，需不需要批准？
4. 日期工作記錄應放 root、daily 還是 archive？
5. local Codex memory 如何安全晉升到 shared L1？

registry 保存 before result 與 evidence。R1 實際重整後才填 after result；任一查詢來源變得更模糊、產生雙正本或失去 attribution，R1 不通過。

## Phase gates

| Phase | Current state | Gate |
| --- | --- | --- |
| R1 baseline | complete | `node scripts/verify-shared-memory-governance-v2.mjs --phase r1-baseline` |
| R1 migration | complete | `node scripts/verify-shared-memory-governance-v2.mjs --phase r1` |
| R2 | complete | `node scripts/verify-shared-memory-governance-v2.mjs --phase r2` |
| R3 | complete | `node scripts/verify-shared-memory-governance-v2.mjs --phase r3` |
| R4 | complete | Architecture Admission、canonical task completion evidence、acceptance receipt 與 full gate 全數通過 |

完整 verifier 現在應維持 PASS，並精確覆蓋 `JV49-R1-A01` 至 `JV49-R4-A01`。C1 實作已到達 harness-mc `79cc7a1c491ebdfccd414c22653d51d71c9f7768` 與 notyet-harness `2f338c71c96fd4a455bc24e14e5abc9057ba9815` 的 remote main；R4 只將已驗證證據、Architecture Admission 與 all-pass receipt 收回 canonical task，沒有建立第二記憶正本或平行治理系統。

## Recovery

完整 pre-JV-49 L1 可由 `memory/archive/MEMORY-pre-jv49-2026-08-12.md` 依 manifest hash 回復。每份 root dated log 可由 manifest 的 `target_ref` 搬回 `recovery_path`，並核對 SHA-256；不得覆蓋同名 daily 檔。promotion write 若 preimage 漂移會 fail closed，不執行猜測性合併。R2 ingress 修正與 R3 adapter 應以 Git diff／commit 反向回復，不得刪除 archive evidence。
