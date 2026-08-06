# JV-45 登入後同步與開始工作契約

此契約只回答：在受支援工作環境中，登入必備帳號後，是否已可安全從 canonical sources 開始工作。它不是登入器、同步器、scheduler、task writer 或秘密儲存。

## 安全 metadata

`account-login-sync-start.v1` 只接受以下欄位：

```json
{
  "schema_version": "account-login-sync-start.v1",
  "approval": {
    "approved_by": "Vincent",
    "approved_at": "YYYY-MM-DD"
  },
  "required_capabilities": [
    { "id": "git-remote-access", "status": "available" }
  ]
}
```

它不保存帳號名稱、email、token、password、Cookie、credential、runtime auth 或任何秘密值。必備 capability 清單由 Vincent 核准；實際登入只由使用者在外部帳號／安全儲存完成。

## Safe probe

```bash
node scripts/account-login-sync-start.mjs --probe --remote --root "$COLLAB/harness-mc" --account-metadata /path/to/safe-metadata.json
```

probe 只讀取 Git metadata：是否為 Git repo、origin 是否設定、working tree 是否 dirty、以及本機已知的 upstream ahead／behind。只有明確指定 `--remote` 時，才額外執行唯讀 `git ls-remote --heads origin <branch>` 比對 remote HEAD；它不執行 fetch、pull、reset、checkout、commit、push 或登入，origin URL 也不會輸出。沒有帳號 metadata、upstream 不存在或資料不足時，輸出必須是 `blocked` 或 `degraded`。

## Completion evidence

fixture 可證明 schema、秘密邊界、差異分類與 deterministic decision；不能取代真實登入後 evidence。JV-45 關閉前仍須提供兩個獨立 fresh-session／硬體環境對同一 remote truth 的 safe-probe evidence，並由 acceptance matrix A01–A05 逐項裁決。
