# Shared Memory Governance v2

> Task: `shared-memory-governance-v2` (`JV-49`)
> Status: R1 baseline inventory complete; migration pending
> Updated: 2026-08-12
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

R1 baseline 只記錄候選，不執行移動、合併、覆蓋或刪除。

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

R1 建議目標是獨立的 `memory/archive/root-dated-logs/`，但實際建立與搬移必須在 baseline checkpoint 後另行執行並驗證；原檔在此前保持不變。

## Memory ingress boundary

任何會建立記憶建議的 skill、template 或 script 都必須改成 agent-neutral：

- 不宣稱 HiSenzi 或 OpenClaw 專管 shared MEMORY.md。
- 不把開案、skill、案例或 project 細節直接回灌 L1。
- 先產生一筆有來源與目標層的 candidate；memory write 屬 Approval Policy 的 `memory_write_or_update`，需 Vincent 明確核准。
- daily raw log 的明確使用者要求可走 daily writer，但不得藉此自動升格 L1 或改 task state。

R1 只盤點 stale ingress；實際修正屬 R2。

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

R1 不修改此閉環；R3 才加入 memory-promotion candidate contract。不得新增第二套 queue、scheduler、notification、dashboard、task system、RAG 或向量資料庫。

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
| R1 migration | pending | shared L1 重整、ledger verified、after fingerprint、五查詢 no regression |
| R2 | not started | dated logs／archive 與 ingress owner 修正 |
| R3 | not started | approval-gated candidate adapter + negative fixtures |
| R4 | not started | full evaluation + Architecture Admission decision |

官方 `--phase r1` 在 migration 尚未執行前必須維持 RED；完整 verifier 在 R1–R4 未完成前也必須維持 RED。這可防止把「盤點完成」誤報成「JV-49 完成」。

## Recovery

R1 baseline 沒有 source mutation。回復只需移除本 task 新增的 harness spec、registry 與 verifier；shared MEMORY.md、skills、ARCHITECTURE.md、dated logs 與 local Codex memory 均保持原狀。後續任何 migration 必須在 registry 逐筆把 `action_status` 從 `proposed_no_write` 更新為 `verified`，並留下 before／after hash 與反向路徑。
