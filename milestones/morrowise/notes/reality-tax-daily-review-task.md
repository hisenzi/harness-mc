# MorroWise 每日決策排程：整併判斷與未決事項

> 既有 owner task：`morrowise/reality-tax-daily-review-task`
> 行動正本：`$COLLAB/harness-mc/milestones/morrowise/tasks.json`
> 本頁角色：每日排程議題紀錄；不取代 task state、schedule YAML、event schema 或 delivery adapter。
> Semantic intake：`replace`，Vincent 已於 2026-07-21 核准 task-state mutation；舊 task 已取消，唯一 successor 為 `morrowise/morrowise-live-decision-loop-v1`。
> 已吸收範圍：task intake、weekly core、review date 與到期 gate 已由 JV-40 實作，本頁只保留薄連結。

## 1. 目前決定

每日建議不能另開一張與既有 Reality Tax Daily Review 平行的 task。現有 task 已擁有 daily schedule、scheduler、delivery 與 Reality Tax 行為，但新需求已由「研究損耗檢查」擴成「全 MorroWise 每日決策摘要」。

已於同一個 canonical mutation batch 完成：

1. 將 `reality-tax-daily-review-task` 由 `in_progress` 轉為 `cancelled`，記錄 replacement reason。
2. 建立 successor：`morrowise-live-decision-loop-v1`。
3. 新舊 task 使用 reciprocal replacement refs。
4. Successor 保留 Reality Tax 30 分鐘／24 小時檢查，不遺失原始問題。

此後禁止建立 `daily-recommendation.v0` 或其他平行 daily task；所有每日決策實作都必須收斂至 successor。

## 2. 已由 JV-40 吸收

以下內容屬於 `morrowise/task-lifecycle-jv32-gate`，不得在每日排程重複保存或實作：

- `reuse | amend | replace | genuinely_new` semantic intake。
- 問題、owner／正本、輸入輸出、lifecycle／completion 四維 comparison。
- Vincent approval、replacement linkage 與 changed-only validator。
- 單一 `weekly_core`、`review_date`、到期 reframe／suspend／cancel／complete。
- work-anchor expiry gate、負向 fixtures 與 Architecture Admission Review。

薄連結：`consumed_by: morrowise/task-lifecycle-jv32-gate`。

## 3. 仍未解的每日排程範圍

- 每天如何選出唯一 focus task。
- MorroWise 優化建議、deferred candidates 與 system status 各保留多少資訊。
- 是否及如何保留 Reality Tax 的 `30min / 24h / reality_gap` 規則。
- 確切執行時間；21:30 目前只是舊 task done condition，尚未核准為整合版時間。
- Delivery channel 與 fallback；通知成功不得反向修改 task state。
- Human-readable message、transport-neutral event schema、候選數量與 ack 行為。
- Schedule YAML、runs log、task-specific verifier 與 schedule-health surface。

目前 `$COLLAB/notyet-harness/schedule/tasks/` 沒有 `reality-tax-daily-review.yaml`；不得因 task 存在就宣稱 runtime 已上線。

## 4. Replace 四個邊界

| 邊界 | 判斷 |
| --- | --- |
| 問題 | 舊 task 只處理研究／討論的 Reality Tax；新需求是每天整合 task focus、系統狀態與改善建議。問題已擴張。 |
| Owner／正本 | 兩者仍由 MorroWise task state、agent-agnostic scheduler 與 delivery adapter 管理，owner family 相同。 |
| 輸入／輸出 | 舊輸入偏研究活動；新輸入需全體 canonical tasks、system status、deferred candidates，輸出是每日決策摘要。 |
| Lifecycle／完成 | 沿用舊 id 會造成身份失真；應 cancel 舊 task 並建立 reciprocal successor，但保留 Reality Tax acceptance。 |

固定建議：`replace`，不是 `genuinely_new`。目前只記錄判斷，不執行 mutation。

## 5. Successor 最小驗收草案

1. 每次 run 只選一個 focus task，附選擇理由與正本 task ref。
2. 顯示最多數個 deferred candidates，不把完整 task list 複製進通知。
3. 每日只給一項可驗證的 MorroWise 系統改善建議。
4. Reality Tax 規則仍能偵測 30 分鐘討論／研究與 24 小時無實質 output。
5. 沒有 schedule YAML、run log、freshness 與 delivery evidence 時狀態必須 degraded／not_live。
6. Event contract 與 Telegram／macOS 等 renderer 分離。
7. Delivery adapter 不能決定 task completion、weekly core 或 canonical state。

## 6. 演進與文章素材

| 日期 | 發現 | 決策變化 |
| --- | --- | --- |
| 2026-07-19 | `daily-recommendation.v0` 只是 session 中提出的事件格式概念，不是既有 task。 | 禁止把 event version 當 task id。 |
| 2026-07-19 | 先提出新 daily task 後才發現既有 Reality Tax task。 | Task 提案前必須先跑 semantic intake；此缺口由 JV-40 修正。 |
| 2026-07-19 | Component validator 可通過，但 fresh Agent 仍可能先開重複 task。 | 驗收提升為 fresh-session 行為與 runtime preflight，而非只看 schema。 |
| 2026-07-19 | Task 管理機械 gate 已完成，daily schedule 內容與 runtime 仍未決。 | 把兩個問題拆開：JV-40 closeout 不等待 daily schedule；每日 scope 回到既有 owner family。 |

### 核心論點

真正的活系統不是每天丟出更多提醒，而是每天從正本中選出一個能推進的焦點，同時誠實顯示哪些能力尚未 live。

### 反直覺發現

- 有 task 不代表有排程；沒有 YAML、run log 與 freshness 就不能宣稱 live。
- 新需求比舊 task 大時，直接 amend 可能比 replace 更危險，因為 id 會開始說謊。
- 自動提醒越多不一定越主動；沒有唯一 focus task 的通知只是另一個 Dashboard。

### 候選題目

1. 《每天提醒很多事，為什麼系統還是不會推進？》
2. 《有 Task 不等於有 Runtime：AI 系統最常見的假活》
3. 《什麼時候該 amend，什麼時候該 replace？》

## 7. Provenance

本頁收編自 `$COLLAB/notyet-harness/000_Agent/_temp/2026-07-19-morrowise-daily-schedule-task-management-handoff.md`；原始檔 SHA-256：`7504e27d402b94f6ea35b060731b11674def7b4f622c6628c1d46300d0a334d2`。暫存原檔完成收編後不再作正本。
