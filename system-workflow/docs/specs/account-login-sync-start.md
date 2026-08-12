# JV-45 登入後同步與開始工作契約

目標原文：

> 換任何硬體，只要登入必備帳號，就能同步最新資料並開始工作。

本契約只負責 Vincent 完成登入之後的唯讀判定：remote truth 是否可讀、本機是否安全、evidence 是否新鮮，以及下一個可開始工作的 action。它不是登入器、同步器、scheduler、task writer、credential store 或 Git writer。

## 帳號邊界

- 必備帳號、登入狀態與登入問題完全由 Vincent 管理。
- evaluator、probe、CLI、task evidence 與 log 不接收、不檢查、不輸出 account metadata 或登入狀態。
- `account_metadata` 是 out of scope input；token、secret、password、Cookie、credential、runtime auth、access token 與 refresh token 欄位一律拒絕，錯誤訊息只包含欄位名稱，不回顯值。
- Vincent 尚未宣告登入完成時，JV-45 不啟動後續判定，也不自行登入、追問或探測帳號。

## Safe probe

```bash
node scripts/account-login-sync-start.mjs --probe --remote --root "$COLLAB/harness-mc"
```

probe 只執行 read-only Git metadata command：辨識 repo、origin、branch、working tree、local HEAD、既有 upstream 差異，並在明確指定 `--remote` 時用 `git ls-remote --heads origin <branch>` 讀取 remote HEAD。它不執行 fetch、pull、reset、checkout、commit、push 或登入，origin URL／path 也不會輸出。

每個 repository evidence 至少包含：

- stable repository id
- `origin_configured`
- `local_state`: `clean | dirty | unknown`
- `upstream_state`: `in_sync | ahead | behind | diverged | remote_different | unknown | missing`
- branch
- local HEAD SHA
- remote HEAD SHA
- `remote_checked`

沒有真正執行 remote probe 時，即使本機 tracking metadata 顯示 in-sync，也只能輸出 `remote_truth_not_probed` degraded reason。

## Evidence 與 freshness

只有同一 runtime 內由 `probeAccountLoginSyncStart` 實際產生的 evidence，才具備 private provenance marker。手寫 JSON、fixture、copy／spread 後自行宣告 `kind: safe_probe` 都不得成為 ready evidence。

probe 同時計算 repositories payload 與 `observed_at` 的 SHA-256 digest：

```json
{
  "kind": "safe_probe",
  "observed_at": "ISO-8601 timestamp",
  "evidence_ref": "safe-probe:sha256:<digest>",
  "evidence_digest": "sha256:<digest>",
  "verifier": "probeAccountLoginSyncStart"
}
```

- freshness window 固定為 900 秒。
- `observed_at` 不可解析：`runtime_evidence_timestamp_invalid`。
- `observed_at` 晚於 `evaluated_at`：`runtime_evidence_from_future`。
- age 大於 900 秒：`runtime_evidence_stale`。
- payload 與 digest／reference 不一致：`runtime_evidence_digest_mismatch`。
- fixture 或非 probe evidence：`fixture_only_runtime_evidence`／`untrusted_runtime_evidence`。

上述情況只能 degraded，不得假裝 healthy。

## Decision

`ready` 必須同時滿足：

- evidence 由真實 safe probe 產生、digest 相符且 freshness 為 fresh；
- repo clean；
- origin 與 remote truth 已實際讀取；
- local／remote SHA 都存在且完全相同；
- upstream state 為 `in_sync`。

`ready` 輸出必須包含：

- `freshness.state／observed_at／evaluated_at／age_seconds／max_age_seconds`
- evidence reference／digest／verifier result
- repository id／branch／local SHA／remote SHA／upstream state
- `next_action.kind=begin_work_from_canonical_sources`
- read-only write boundary

dirty、ahead、behind、diverged／remote_different、missing 與 unknown 必須輸出 blocked／degraded reason 及安全 next action，不得自動覆寫或修改 repo／task state。

## Completion evidence

負向 fixture 只證明拒絕規則，不能冒充 runtime evidence。JV-45 驗收需包含：

- 真實 local bare remote 與 working repositories 的 Git integration；
- 兩個獨立 fresh-session workspace 對相同 remote truth 的一致結果；
- shared checkout 的實際 `--probe --remote` 結果，dirty 就如實 blocked，不得用 fixture 取代；
- canonical Acceptance Matrix `JV45-A01`–`JV45-A05` 的逐項 fresh evidence。
