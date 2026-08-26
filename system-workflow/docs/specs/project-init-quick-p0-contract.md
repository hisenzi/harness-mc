# Quick P0 驗收契約：10 秒安全開案

## 範圍

本契約只規範已取得完整 Quick input 後，到回傳 Quick receipt 為止的本機路徑。它不包含需求討論、Git、部署、MC rebuild、同步、通知或正式 MVP 工作。

Quick 只有三種阻擋理由：input 或命名衝突、目標位置不安全或不是可接受的 canonical 本機位置、無法保證本次寫入全成或全不成。無關 root 的 stale、missing、unknown 與 migration maintenance finding 一律只進 receipt 的 `maintenance_findings`。

## Candidate bootstrap

1. 先在記憶體建立 candidate topology record；此時不得建立專案資料夾、milestone 或 topology record。
2. 先檢查 project ID、project folder、README 與 milestone 的衝突，以及 canonical profile、path escape、symlink escape。
3. 對 candidate 套用 target-scoped admission。candidate 合法時，無關 global finding 不得拒絕本案。
4. 全部檢查通過後，才進入同一個 Quick transaction。

## 固定 receipt

Quick stdout 只輸出一個 JSON object：

```json
{
  "outcome": "created | rejected",
  "target_status": "ready | rejected",
  "global_status": "ready | degraded",
  "duration_ms": 0,
  "maintenance_findings": []
}
```

`created` 的 process exit code 是 `0`；`rejected` 是 `2`。

當 `outcome` 為 `rejected` 時，另必須有非空的 `reason_code`。成功 receipt 不得有 `reason_code`。`target_status: "ready"` 與 `global_status: "degraded"` 可同時成立，且仍代表開案成功。

拒絕碼固定為：

| Code | 意義 |
| --- | --- |
| `invalid_input` | 必填 input 或格式不合法。 |
| `id_conflict` | project ID 已存在。 |
| `project_folder_conflict` | project folder 已被占用。 |
| `readme_conflict` | README 已存在。 |
| `milestone_conflict` | milestone 已存在或目的地衝突。 |
| `destination_path_escape` | destination 位於 `$COLLAB` 外。 |
| `destination_symlink_escape` | destination 實體路徑逃出 canonical root。 |
| `target_not_canonical` | candidate target classification 或 canonical profile 不可接受。 |
| `target_migration_blocked` | candidate target 的 migration 為 blocked。 |
| `transaction_unavailable` | 無法取得同一 ID／folder 的 Quick lock。不同 candidate 等待短暫 registry commit lock，不因彼此而拒絕。 |
| `transaction_failed` | 寫入或 registry commit 失敗，且已回復。 |
| `transaction_interrupted` | 發現未完成 transaction 並完成回復。 |

## Transaction 與併發

- 同一 project ID 或 project folder 同時 Quick 時，最多一筆可進入 commit；另一筆回傳 `transaction_unavailable`。
- 所有正式產出先寫入 transaction staging state；journal 必須含 transaction ID、受限的相對目標、registry 前後 digest；project folder 與 milestone 必須帶同一 transaction marker，才可被回復刪除。
- 只有 README、最小 project.json、tasks.json 與 topology record 都準備成功後，才提交為正式狀態。
- 任一步驟失敗、程序中斷、registry 無法讀寫時，正式 project folder、milestone 與 topology registry 的 digest 必須回到執行前；下次 Quick 必須先回復未完成 journal。
- Quick 不得建立 Git/repo、部署、資料庫、同步或通知。

## 10 秒計時

- `duration_ms` 從 CLI 收到完整 input 開始，到 JSON receipt 寫入 stdout 前結束。
- 不含 input 蒐集、Git、部署、同步、通知與後續工作。
- 固定有效 input 的 20 次隔離 fixture 執行，以升冪排序後第 `ceil(20 × 0.95)` 筆作為 p95；必須小於或等於 10,000 ms。

## Quick verifier fixture 設計

每個案例使用獨立的 temporary `$COLLAB`、milestones、topology registry 與外部命令攔截器；不得讀寫正式 registry 或正式專案資料。

| Fixture | 預期 receipt／不變條件 |
| --- | --- |
| `success` | `created`、target `ready`；四份正式產出同時存在；外部命令記錄為空。 |
| `invalid-input` | `rejected`／`invalid_input`；所有 digest 不變。 |
| `invalid-topology-registry` | `rejected`／`transaction_failed`、global `degraded`；不得寫入不合格 registry。 |
| `id-folder-readme-milestone-conflict` | 對四種衝突逐一回傳固定拒絕碼；檔案樹與 registry digest 不變。 |
| `path-escape` | `destination_path_escape`；digest 不變。 |
| `symlink-escape` | `destination_symlink_escape`；digest 不變。 |
| `milestone-root-escape`、`topology-registry-escape` | 隱藏 destination 也只能在 canonical control-plane 範圍；否則 `destination_path_escape`，digest 不變。 |
| `milestone-root-symlink` | milestone destination 的 symlink 也拒絕為 `destination_symlink_escape`。 |
| `global-degraded` | `created`、target `ready`、global `degraded`，並含 maintenance finding。 |
| `mid-write-failure` | `transaction_failed`；project folder、milestone、registry digest 回復。 |
| `interrupted-transaction-project_folder`、`-milestone`、`-topology` | 每一個正式提交後的真實程序中斷均回 `transaction_interrupted`；沒有 staging/journal 或半成品殘留。 |
| `concurrent-same-id-folder` | 最多一筆 `created`；另一筆 `transaction_unavailable`；只有一組正式產出。 |
| `concurrent-distinct-candidates` | 兩個不同 candidate 均可完成；shared registry 不遺失任何 record。 |
| `no-external-side-effects` | 成功與拒絕案例均不呼叫 Git、部署、MC rebuild、同步或通知。 |
| `performance-20-runs` | 20 次 success fixture p95 小於或等於 10,000 ms。 |

這份契約的 RED verifier 必須跑 Quick 指令本身；在所有 fixture 轉綠前，不得以舊完整開案 verifier 宣告 P0 完成。

## 功能完成門檻

本文件中的「綠燈」只指同時符合下列三項；不得把新 verifier 單獨通過稱為綠燈：

1. `node scripts/verify-project-init-quick-v2.mjs` 的 23 個 fixture 全部 GREEN，process exit code 為 0。
2. 既有 `node scripts/verify-project-init-quick.mjs` 也通過。
3. 成功與拒絕 fixture 的外部命令記錄均為空；沒有 Git、部署、MC rebuild、同步或通知副作用。

任一項不成立，只能回報「規格／測試已完成」或「功能尚未完成」，不得使用「綠燈」或「功能完成」。
