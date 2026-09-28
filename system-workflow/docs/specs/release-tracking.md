# 跨專案版本發布與變更追蹤工作流實作規格 (release-tracking)

> 文件識別碼：`$COLLAB/harness-mc/system-workflow/docs/specs/release-tracking.md`  
> 文件版本：v1.4（2026-09-27）；Phase A 固定驗收契約仍為 v1.3
> 需求入口：[GitHub Issue #2](https://github.com/hisenzi/notyet-harness/issues/2)  
> 執行階段：A 本機驗證＋B 接線實作；B 真實 GitHub 驗收 NOT_RUN

---

## 1. 目的與適用邊界

本規格定義跨專案「版本發布與變更追蹤（release-tracking）」工作流之核心資料契約、分流邏輯、防重複機制、故障恢復流程與命令介面。

- **A 階段（本機試行）**：實作共用核心 `scripts/lib/release-tracking.mjs`、正式 CLI `scripts/release-tracking.mjs`、測試驗證器 `scripts/verify-release-tracking.mjs` 及固定契約材料。透過本機一次性 Git fixture 與 loopback HTTP 服務驗證全流程（RT01–RT15）。
- **B 階段（真實 GitHub 接線與啟用）**：待 A 階段完成自測與獨立複驗後，由 Vincent 明定正式 repo、測試 Tag、目標入口與外部寫入權限，於 `activation.json` 授權後另行啟用。A 通過不得冒稱 B 通過或整案結案。
- **邊界限制**：第一版僅支援 `tag_push` 事件；不支援 PR merge / release publish 觸發，不跨主機分散投遞，A 階段嚴禁任何對真實外網或 GitHub 的寫入。

---

## 2. 核心行為契約與分流規則

### 2.1 R1：明確 Routing 分流
輸入必須包含明確 `routing.mode` 與目標欄位，第一版不以 AI 猜測標題或自然語言配對：

1. **`mode: "existing"`（首選）**
   - 適用於發布成果對應既有 Issue 或 PR。
   - `routing.target = { kind: "issue" | "pr", repo: "<owner>/<name>", number: <int> }`。
   - `target.repo` 必須與事件 `repo` 一致（第一版不支援跨 repo 配對）。
   - 行為：在該入口追加一則含版本證據之 Markdown 留言，**零新 Issue，零 Release**。
2. **`mode: "followup"`**
   - 適用於無既有入口且明確有獨立後續待辦工作。
   - 必填欄位：`work_key`（string）、`title`（string）、`reason`（string）、`acceptance`（string，不可空白）。
   - 若 `acceptance` 空白、同時提供了 `existing` 的 `target`、或無獨立後續工作，拒絕處理（exit 2）。
   - 行為：建立 1 則新 Issue，**零 Release，零既有留言**。
3. **`mode: "release"`**
   - 適用於無既有入口、無後續待辦，且被發布專案契約之 required 案例全部 `PASS` 的純發布完成存檔。
   - 必填欄位：`changelog`（string）。
   - 若 required 案例存在 `FAIL`、`NOT_RUN` 或 `BLOCKED`，拒絕建立 Release，狀態標為 `BLOCKED`（exit 3）。
   - 行為：建立 1 筆 GitHub Release，**零 Issue**。
4. **衝突與無效路由**
   - 模式矛盾、未宣告模式：exit 2；`existing` 空目標：exit 3。
   - API 回報目標不存在或不可讀（如 404）：輸出 `BLOCKED`（exit 3），零寫入，不得自動改走新 Issue。

### 2.2 R2：Tag 與事件正規化
- **支援事件**：第一版僅處理 `tag_push` 事件。PR merge、release publish、branch push 標為 `IGNORED`（exit 0），零寫入。
- **Tag 命名規則**：嚴格符合 `^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$`。不符規則之 Tag 標為 `IGNORED`（exit 0），零寫入。
- **事件正規化欄位**：
  ```json
  {
    "schema_version": 1,
    "event_id": "string",
    "event_type": "tag_push",
    "repo": "owner/repo",
    "ref": "refs/tags/<tag>",
    "tag": "<tag>",
    "commit_sha": "<40-char-commit-sha>",
    "observed_at": "ISO-8601-UTC",
    "deleted": false,
    "routing": {}
  }
  ```
- **輕量與 Annotated Tag Peel**：
  - 本機 fixture 對所建 Tag 做 peel。Actions adapter 以原始 push payload 的 `after^{commit}` 核對 `GITHUB_SHA` 與 checkout HEAD；重跑不得解析已移動的現行 Tag ref。
  - 嚴格禁止使用 short hash、tag object SHA 或動態 branch 名稱充當 `commit_sha`。
- **Tag 刪除事件**：
  - `deleted: true` 標為 `IGNORED`（exit 0），本機寫入 tombstone 紀錄，零外部寫入，不刪除歷史 Release／Issue／證據。
- **同名 Tag 改指向（Force-pushed / Repointed）**：
  - 當收到同名 Tag 但解析之 commit SHA 與歷史紀錄不一致時：
    - **禁止覆寫**：保留原紀錄與有效參照（仍綁定原 SHA）。
    - **追加通知**：在原留言入口（A/B）或 Release 正文末尾追加 1 次異動通知（含 Tag 名稱、舊 SHA、新 SHA、時間戳記）。
    - **標示審查**：狀態輸出為 `REVIEW_REQUIRED`（exit 3），不自動變更有效版本。重試不重複追加通知。

### 2.3 R3：真實證據與驗證
- **`result.json` 結構**：
  ```json
  {
    "schema_version": 1,
    "contract_sha256": "<hash-of-project-contract.json>",
    "source_commit": "<40-char-commit-sha>",
    "environment": {
      "os": "darwin",
      "arch": "arm64",
      "node": "v24.x",
      "git": "git version 2.x"
    },
    "ci": {
      "kind": "local"
    },
    "cases": [
      {
        "id": "F-PASS-01",
        "status": "PASS",
        "command": "node -e ...",
        "exit_code": 0,
        "started_at": "ISO-8601-UTC",
        "duration_ms": 12,
        "evidence": [
          { "path": "evidence/run.log", "sha256": "..." }
        ]
      }
    ]
  }
  ```
- **證據檢核**：
  - `source_commit` 必須完全等於事件 `commit_sha`。
  - 專案契約中的 required cases 必須全部且僅出現一次。重複、漏案、未知 ID、未知狀態均屬無效輸入（exit 2）。
  - `status: PASS` 必須配對 `exit_code: 0`；若已執行（非 null）但 evidence 陣列為空，屬無效輸入（exit 2）。
  - Evidence artifact 檔案必須實際存在於 `--evidence-root` 內，SHA-256 吻合，且不可逸出根目錄或指向根外之 symlink。
  - `FAIL`、`NOT_RUN`、`BLOCKED` 可誠實回報至 A／B，輸出 DELIVERED（exit 0），但內文必須明確標示「未通過／未完成」，且不可走 C（Release）。未執行者必須填寫 `reason`，禁止假造 exit 0。

### 2.4 R4：防重複、冪等、原子鎖與故障恢復
- **事件指紋**：
  `event_key = SHA256(repo + "\n" + tag + "\n" + commit_sha)`
- **固定機器 Marker**：
  外部發布內容（Comment / Issue / Release）一律附帶包含 `event_key` 之機器 Marker：
  `<!-- morrowise-release-tracking-marker: {"event_key": "...", "repo": "...", "tag": "...", "commit_sha": "..."} -->`
- **原子鎖**：
  依據 `repo` 與 `tag` 於 `state-dir` 內建立鎖檔案進行序列化。競跑時未獲取鎖者輸出 `LOCK_FAILED`（exit 3）。
- **遠端 Marker 查核（含分頁）**：
  在 POST 前必須先向目標 API 查詢既有 Marker（支援分頁）。若已存在且內容一致，回讀並回傳 `ALREADY_DELIVERED`（exit 0）。
- **寫入後 GET 回讀核對**：
  POST 成功後必須立即發起 GET 請求核對 body、target 與 marker。核對一致始標為 `DELIVERED`。
- **不確定狀態處理（Reconciliation）**：
  - 若 POST 時發生網路中斷或逾時（timeout），不可直接二次 POST。
  - 優先執行最多 2 次 GET 查詢 Marker 進行 reconcile：
    - 若查詢到 Marker，完成回讀並收斂為 `DELIVERED` / `ALREADY_DELIVERED`。
    - 若查詢依然失敗或狀態不明，輸出 `PENDING_RECONCILE`（exit 4），保留現場供後續人工重試。
- **防竄改**：
  - 本機 ledger 損毀時 fail-closed（exit 3），不自動清空或重建。
  - 相同 `event_key` 但目標 target 或內容被改動者，判定為 `CONFLICT`（exit 3），零寫入。

---

## 3. CLI 命令介面與 Exit Code

所有指令工作目錄為 `$COLLAB/harness-mc`。

### 3.1 `plan` 指令
```bash
node scripts/release-tracking.mjs plan \
  --event <path-to-event.json> \
  --contract <path-to-project-contract.json> \
  --result <path-to-result.json> \
  --evidence-root <path-to-evidence-dir> \
  --out <path-to-plan-out-dir>
```
- **性質**：零 API 請求，不改動投遞 ledger；只建立本機輸出材料。
- **行為**：校驗輸入與檔案 Hash，決定 routing 動作，渲染發布 Markdown 內文。
- **產物**：`plan.json` 與 `message.md`。若 `--out` 目錄已存在則拒絕覆寫（exit 2）。

### 3.2 `apply` 指令
```bash
node scripts/release-tracking.mjs apply \
  --plan <path-to-plan.json> \
  --mode fixture \
  --api-base <loopback-url> \
  --state-dir <path-to-state-dir> \
  --out <path-to-apply-out-dir>
```
- **fixture 限制**：`--api-base` 只允許 `127.0.0.1` / `localhost`；非 loopback exit 2，不使用 token。fixture 支援三種 routing。
- **live 入口**：
  ```bash
  node scripts/release-tracking.mjs apply \
    --plan <immutable-plan-dir/plan.json> --mode live \
    --activation <activation.json> --state-dir <state-dir> --out <new-apply-dir>
  ```
  API origin 預設且只允許 `https://api.github.com`；token 只讀 job 環境的 `GITHUB_TOKEN` 或 `GH_TOKEN`。live 僅接受與 activation 完全相同、同 repo 的 `existing` target。缺少／越界 activation 或 token 以 exit 3 阻擋，在 HTTP 前停止。§5 是設定與驗收程序。
- **共同處理**：重新核對 plan、event、contract、result、message 與 evidence hash；取得原子鎖後查远端、POST、GET 核對 body／target／marker，再寫 ledger。GET 不符為 `CONFLICT`（exit 3），401／403／404／422 為 `BLOCKED`（exit 3）。
- **產物**：進入 delivery 後記錄 `delivery.json`、`requests.json`；已取得遠端資料才有 `remote-before.json`／`remote-after.json`。前置檢核失敗不保證有這些檔案。stdout／stderr 由呼叫端或 Actions 保存。
- **不可覆寫**：`plan`、`apply`、verifier 及 Actions `capture`／`restore` 的 out 必須未存在；每次另取名稱，保留既有證據。

### 3.3 Exit Code 定義
| Exit Code | 意義 | 代表狀態 |
|---|---|---|
| `0` | 成功 / 冪等跳過 | `PLANNED`, `DELIVERED`, `ALREADY_DELIVERED`, `IGNORED` |
| `2` | 輸入或契約無效 | `INVALID_INPUT`, `CONTRACT_INVALID`, `HASH_MISMATCH` |
| `3` | 阻擋 / 衝突 / 需人工審查 | `BLOCKED`, `CONFLICT`, `REVIEW_REQUIRED`, `LOCK_FAILED`, `LEDGER_CORRUPTED` |
| `4` | 投遞狀態未定，待對齊 | `PENDING_RECONCILE` |

---

## 4. 驗收案例映射 (RT01–RT15)

| 案例 ID | 驗收重點 | 測試方法與預期 |
|---|---|---|
| **RT01** | R1/R3 最小全流程 | existing #101：plan -> apply -> GET。產出 1 則留言，0 新 Issue，0 Release。完整包含 40 位 SHA、實際指令、exit code、耗時與 fixture 標示。 |
| **RT02** | R1 原入口 (PR 與 404) | 子案 1：PR #102 產生 1 則留言。子案 2：不存在之 #999 回應 404，CLI exit 3，零寫入。 |
| **RT03** | R4 重送與分頁查詢 | 重送相同 event_key 輸出 ALREADY_DELIVERED；遠端 marker 置於第 2 頁仍能成功回讀，總留言數維持 1 則。 |
| **RT04** | R1 後續工作 (followup) | 有效案建立 1 新 Issue，重複執行 ALREADY_DELIVERED；空白 acceptance 或同時提供 existing target 各 exit 2 拒絕。 |
| **RT05** | R1 完成存檔 (Release) | required 全 PASS 建立 1 Release；重送不覆寫。未通過（FAIL/NOT_RUN）輸入 exit 3，零 Release。 |
| **RT06** | R2 Tag Peel 與 SHA 檢核 | lightweight 與 annotated Tag 均正確 peel 出 40 位 commit SHA。短 SHA、tag object SHA 或與 result 不合均 exit 2 拒絕。 |
| **RT07** | R3 證據反例 | 檔案不存在、Hash 不合、路徑逸出根目錄、symlink 逸出、缺 required case、重複 case、未知狀態、PASS 配非零 exit、空 evidence 等 10 種反例，各 exit 2 拒絕。 |
| **RT08** | R3 未執行誠實回報 | FAIL、NOT_RUN、BLOCKED 誠實投遞 exit 0，內文標記未通過/未完成，無虛假 CI；未跑卻填 exit 0 視為矛盾 exit 2 拒絕。 |
| **RT09** | R4 故障注入與斷線 | POST 成功但連線中斷藉由 GET reconcile 成功收斂；POST 前斷線且 reconcile 失敗輸出 exit 4 PENDING_RECONCILE；GET 回讀 body 異常輸出 exit 3。 |
| **RT10** | R4 同主機競跑 | 同 state-dir、同 key 同時啟動兩行程，一者 DELIVERED，另一者因鎖占用 exit 3；重跑受阻者輸出 ALREADY_DELIVERED，留言維持 1 則。 |
| **RT11** | R2 Tag 改指向 | 同 Tag 名稱接收新 commit B：追加 1 則異動通知（含 old/new SHA），輸出 REVIEW_REQUIRED (exit 3)；有效版本參照維持 A，重跑不多發。 |
| **RT12** | R2 忽略事件 | PR merge、Release publish、branch push、無效 Tag、Tag 刪除五種事件均輸出 IGNORED (exit 0)，零外部寫入；Tag 刪除保留本機 tombstone。 |
| **RT13** | R3/R4 防竄改與不可替換 | plan 後篡改證據或契約 exit 2；改動 target exit 3 CONFLICT；損毀 ledger exit 3，零寫入且保留損毀現場。 |
| **RT14** | R1/R4 無副作用與隔離 | plan 指令 0 API 呼叫；未知 routing / 跨 repo / 非 loopback API URL 拒絕執行（exit 2），空目標 exit 3。 |
| **RT15** | Runner 可信度與自我驗證 | 全套測試覆蓋 RT01–RT15；單案 `--case RT09` 正常執行；未知 case 與已存在 out 拒絕執行；突變測試（刻意竄改 RT01 message SHA）觸發斷言失敗。 |


## 5. Phase B：固定既有入口的真實 GitHub 試行

本節描述已實作介面與待執行程序，**不是 B 通過紀錄**。候選 repo／入口沿用 `hisenzi/notyet-harness#2`，不新建 repo 或平行追蹤。真正執行前的 activation 必須落實本次已授權範圍；本地測試、HTTP mock、workflow 檔存在或 commit 成功都不能替代真實 run 與 GET 證據。

### 5.1 Activation 與來源版本

`validateActivation` 讀取下列 JSON。以下尖括號值是待填欄位，不是已存在的 SHA 或批准；填實際操作人、Vincent 當次授權來源與時間。`workflow` 保存啟停定位，不是 core 的授權判斷替代品。

```json
{
  "schema_version": 1,
  "status": "authorized",
  "repo": "hisenzi/notyet-harness",
  "target": { "kind": "issue", "repo": "hisenzi/notyet-harness", "number": 2 },
  "allowed_tags": [
    { "tag": "v0.0.0-issue2-test-<unique-run>", "commit_shas": ["<sourceSha-A-full-40>", "<sourceSha-B-full-40>"] },
    { "tag": "v0.0.0-issue2-test-<unique-run>-readonly", "commit_shas": ["<sourceSha-A-full-40>"] },
    { "tag": "v0.0.0-issue2-test-<unique-run>-stopped", "commit_shas": ["<sourceSha-A-full-40>"] }
  ],
  "allowed_write_types": ["issue_comment", "tag_repoint_notice"],
  "operator": "<actual-operator>",
  "authorization": { "source": "<actual-user-authorization-and-issue-reference>", "approved_at": "<actual-ISO-8601-time>" },
  "workflow": { "path": ".github/workflows/release-tracking.yml", "disable_command": "gh workflow disable release-tracking.yml --repo hisenzi/notyet-harness" }
}
```

- repo、Tag 名稱及 full commit SHA 都採精確 allowlist；`target.kind` 可為 `issue` 或 `pr`，number 與 repo 必須等於 plan，且 target repo 等於 event repo。跨 repo、`followup`、`release` live routing 均阻擋。
- `issue_comment` 是必要寫入種類；只有列入 `tag_repoint_notice` 才可發改指向通知。標示 `authorized` 本身不能取代實際使用者授權證據。
- 先核對目標 repo 的已發布 workflow/source commit，**建立 Tag 前**擷取並記錄 sourceSha A；另選已存在、已核准的 B SHA 供改指向測試。當時即把精確 SHA／Tag 填入 activation，不能跑完後取新 HEAD 補值。
- 共用核心另外固定到已審查、已發布的 harness-mc full SHA，設為 `RELEASE_TRACKING_CORE_REF`；目標 repo 的 sourceSha 與 core SHA 分開保存。repo variable `RELEASE_TRACKING_ACTIVATION_JSON` 保存上述非機密 JSON。token 由 job 環境提供，不寫入 variable／artifact。

### 5.2 薄 workflow 與不可變材料

來源為 `$COLLAB/harness-mc/.github/workflows/release-tracking.yml`，只將此 adapter 安裝至已核准事件 repo 的相同路徑。它只觸發 `v0.0.0-issue2-test-*` push；不處理任意產品版本。依 repo/ref 序列化，`cancel-in-progress: false`。

| Job | Tag 選擇 | GitHub permissions |
|---|---|---|
| writer | 測試前綴且不以 `-readonly` 結尾 | `contents: read`、`actions: read`、`issues: write` |
| readonly | 測試前綴且以 `-readonly` 結尾 | `contents: read`、`actions: read`、`issues: read` |

`release-tracking-actions.mjs` 使用同一 core；首跑 `capture`、重跑 `restore`，不另做產品邏輯。adapter 核對原始 `event.after^{commit}`、`GITHUB_SHA` 與 target checkout HEAD，支援 annotated Tag 的不可變 object peel。它產生明確標記 `fixture: true` 的 synthetic `RT-PIPELINE` contract/result，記錄 RT01–RT15 verifier 真實 exit、命令、時間、stdout／stderr 與結果 hash。這個 synthetic case 不是新的需求驗收 ID，也不代表目標產品功能已通過。

```bash
node scripts/release-tracking-actions.mjs capture \
  --event <github-event.json> --activation <activation.json> \
  --checkout <event-checkout> --out <new-bundle>
node scripts/release-tracking-actions.mjs verify --bundle <original-bundle>
node scripts/release-tracking-actions.mjs restore \
  --bundle <original-bundle> --event <github-event.json> --activation <activation.json> \
  --checkout <event-checkout> --out <new-restored-bundle>
```

這些命令須在實際 Actions 環境執行，依赖真實 `GITHUB_EVENT_NAME`、`GITHUB_REPOSITORY`、`GITHUB_REF`、`GITHUB_SHA`、`GITHUB_RUN_ID`、`GITHUB_RUN_ATTEMPT`。bundle 綁定 input、plan、message 與 evidence hash；manifest 記錄事件／core source hashes。重跑只容許同一 run/event/core，驗證全部檔案後搬移 plan 的絕對材料路徑並記 `replay.json`，原始 message／result 不變。不可重新跑 verifier、修改時間或重新渲染 body 來冒充同事件重送。

首跑在投遞前上傳 `release-tracking-original-<run_id>`；每次另存 `release-tracking-attempt-<run_id>-<attempt>`，包含原材料、delivery、HTTP 記錄、GET snapshot、ledger、空 state 證明、stdout／stderr／exit。每個 job 從不存在的 state-dir 開始，遠端 marker 仍須防重。任何首次 bundle 遺失或 hash 不合都停止，不以新材料替代。

### 5.3 B 的真實驗收與停用

原 B 完成條件不變，依次保留下列真實證據；此文稿完成時五項均尚未執行：

1. **正常 Tag**：核對 sourceSha A 與原始 event／checkout／result／GET 留言一致；CLI exit 0 `DELIVERED`，既有入口新增一則版本留言，零新 Issue／Release。保存 run URL、core SHA、artifact、留言 URL、POST＋GET、完整 body 與 marker。
2. **同 run 重跑**：使用首次 immutable bundle、新 ledger；exit 0 `ALREADY_DELIVERED`，GET 同一留言且內容完全相同，版本留言數不增加。不能只看 workflow 綠燈。
3. **同名 Tag 改指向**：只把 activation 已允許的測試 Tag 從 A 改到 B；新事件輸出 exit 3 `REVIEW_REQUIRED`，追加一次含 old/new SHA／時間的通知，A 的原文與有效參照不動。重跑此事件不再新增通知；job 非零是預期結果。
4. **只讀 token**：推送獨立 `-readonly` 測試 Tag，同 CLI 在 GitHub 真實 token 權限下寫入遭 403、exit 3 `BLOCKED`，零新增留言；保留 request status、job 權限與 GET 前後數量。mock 403 不能取代此項。
5. **停用後無新投遞**：停用 workflow，記錄停用狀態／時間、明確觀察窗、run 清單與目標 sink before；再推送 activation 精確列入、從未投遞的新 `-stopped` 測試 Tag。窗內再讀 run 清單及 sink after，證明無新 run／留言，舊紀錄與有效參照仍保留。未實送新事件或僅口頭說已停用，不能判定通過。

錯誤 body／錯 target 的 GET 是 `CONFLICT`（exit 3），不是成功；POST 結果不明且至多兩次後續 GET 仍未確認則 `PENDING_RECONCILE`（exit 4）。復原只以原 bundle／新 out 接續，保留不確定現場。停用時在目標 repo 停用 `Release tracking pilot` workflow，完成上述停用反例後停止測試 Tag push；保留歷史留言、原始 bundle、attempt artifacts、activation 與 Tag 變更證據，不自動刪除或重寫。

各項證據由 canonical task 的原 A1／A2／B 完成條件承接，Issue 只作外部鏡像。真實 B 及獨立驗收未齊之前，task 維持 `in_progress`、capability 維持 prototype，Issue 不結案。
