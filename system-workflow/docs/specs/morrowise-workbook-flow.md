# MorroWise 工作本開發流程 v1

> 實作狀態：預備 opt-in；尚未通過兩 repo／兩 session 實際 pilot，未切換預設。
> 工作身份：`morrowise/work-9510dad5-490b-4b7c-9a90-32e9f7f33aec`。
> 計劃與本次唯一工作本：`$COLLAB/notyet-harness/100_Todo/plan/2026-09-06-MorroWise-MVP-可行性計劃.md`。

本文件定義「各專案開發、验收後集中登錄」的責任邊界。它不變更原 JV-37／P3 的完整驗收，也不授權 commit、push、建立 branch／worktree 或外部同步。既有 canonical 入口保留。新入口完成串接與 pilot 前，只有上述已核准改版的有限 bootstrap 可作人工等價操作；其他新工作不可僅因讀到此文件自行切換。

## 唯一來源

一個 work ID 對應一個 home 工作本。新 ID 為 `work-UUIDv4`，既有身份保持不變。新顯示編號為 null，由中央交易依專案格式序列配置；編號不參與開工契約指紋。一般評估／行政文件沿 write-temporary-doc 的用途裁剪，不因文件完成而新增開發 task、驗收事件或 commit 要求。

工作本的唯一契約區段如下，其內容遵循 `system-workflow/schemas/morrowise-workbook.schema.json`：

````markdown
<!-- morrowise:workbook:start -->
```json
{ "此處放完整 v1 契約": "此例只示範標記，不是有效契約" }
```
<!-- morrowise:workbook:end -->
````

`schema_version`、`contract_revision`、身份、home、repos、baseline、done condition、acceptance、dependencies、budget、allowed actions、approval refs、stop/resume 與正式 project 是穩定契約。進度、owner 接續、收據與配號結果記在區段外。根欄位及重複 JSON key 會檢查；JSON Schema 只驗結構，不代表核准。

repo 區分 canonical root、實際 checkout、產品 `write_paths` 與可選的控制紀錄 `control_paths`。後者納入核准及 ownership，但不納入產品受測 source，避免交接包引用自身。所有 scope 是精確相對檔案，不接受 glob、路徑越界或 symlink。home 綁 canonical repo 的唯一位置，linked checkout 從同一位置讀取；不同獨立 clone 的自動認領不在 v1。

既有 task 的 `canonical_baseline` 保存原 task ref／digest／完整 requirement matrix；每個本地 verifier binding 以相同 ID 及 `requirement_fingerprint` 連回原列。可信 resolver 重讀原矩陣、狀態與 start 條件；不得只保留 ID 卻削弱要求。新工作即使填 `canonical_baseline:null`，也須可信 resolver 確認相同 work ID 的 `exists:false`；未知不等於不存在，不能讓取消的 UUID 任務冒充新工作。改約需明確新版本與核准；停止或釋出原 claim 後才切換版本，不能在活躍 claim 下偷換 home 或 scope。

## 核准與真實驗收

人啟動 session 核對 Vincent 原始訊息、已登錄 project／repo 對應、精確 scope、允許動作與契約版本，再向程式 API 提供可信 `approvalResolver`。來源不可來自工作本中的 `approved:true`、任意 JSON 收據或未核對的 callback 回值。新 session 必須重取可信來源；無法取得時只允許唯讀準備，回 `requires_human_approval`。這是人監督的 adapter 邊界，沒有把本地 JSON 或 hash 冒充簽章核准，也沒有自動代讀聊天授權的服務。

`scripts/lib/workbook-anchor.mjs` 提供 `loadWorkbook`、`evaluateWorkbookGate`、`runWorkbookAcceptance`。依賴與既有 task 由可信 resolver 取得；缺資料停止相關副作用。驗收執行限定核准的絕對 executable、entrypoint、args 及其指紋；使用 `shell:false`，不接受 shell verifier。輸入 source／verifier 前後必須不變；核准的報告輸出可在驗收時生成。每個必要 ID 對應實跑結果、程式版本、輸出摘要與實際 artifact。

`validateAcceptanceEvidence` 只驗內容一致性；不能靠手組 JSON 宣稱測試執行過。commit 重新執行驗收；正式承接要求可信 producer 查核。提交前的受測工作樹與已 review 的 C1 tree 必須有對應證據，不能要求 C1 之後 HEAD 仍等於提交前 HEAD。

## 開工、認領與提交

本地 `inspectWorkbookRepo` 不 fetch、不寫中央、不以 unrelated dirty／ahead／pending push 阻擋本地工作。原有遠端 Repo Ready／Remote Closeout 僅在該動作需要遠端交付時適用；目標與真實依賴仍必須可用。

`scripts/lib/repo-coordination-runtime.mjs` 延伸既有入口，匯出 `acquireWorkbookClaim`、`inspectWorkbookClaims`、`inspectWorkbookRepo`、`handoffWorkbookClaim`、`releaseWorkbookClaim`、`markWorkbookPending`。claim 存在 Git common-dir 的 `morrowise-workbooks-v1`；同檔不同 hunk 仍衝突。dirty scope 未取得可信 ownership 交接時不認領。過期只標 stale，不自動接管。

`commitLocalC1({workbook,...})` 轉入同一 coordinator 的 workbook 路徑。先取得精確 diff／group／message 的 commit 授權，再跑驗收；進短鎖後重查 HEAD、scope、index、active owner 與契約，使用 `git commit --only`。他方 staged 內容保持原樣。提交後核對 parent、實際 paths、blob、mode 與 message；中間 commit 只記 `committed_local/pending_delivery`。

持久 intent 先於 commit。commit 後 receipt 失敗時，從原 intent 與唯一符合的實際 commit 恢復，不重提。重送也重驗 commit object 與 Git note。真正 process crash 留下的鎖不按 TTL 刪除：`recoverWorkbookLocks` 必須查證同機原 PID 已停止，且可信 `lockRecoveryResolver` 確認具名 session／nonce 交接，才將鎖封存；接著從原 intent 繼續。

目前 CLI 的 `workbook-inspect --workbook PATH --session SESSION`、`workbook-claims --repo PATH` 僅唯讀。帶工作本的 mutation 使用已驗來源的 session adapter API；沒有 `--approved` 或任意 adapter module 的載入開關。`work-anchor-preflight.mjs` 的既有 canonical 路徑保留；其明確工作本 adapter 串接仍待本次同檔 ownership 交接，不得捏造已支援的參數。

## 完工後正式承接

本地 producer `writeLocalTaskHandoff` 在核准的 control path 建立不可變包；開發期間不寫中央 pending。正式整合呼叫既有 `applyTaskEvents` 的明確 `localHandoffs` 分支，與 legacy event 互斥。preview 不寫檔、不釋出同步；apply 使用既有中央鎖、可信正式寫入／ownership、task 級 CAS、完整 candidate validator、語意查重與中央配號。

相同交接內容重送回原結果；同 ID 不同內容、同工作改 event ID 偷重送、中央 task 取消／改約都不覆寫。journal 以本 task before/after 恢復，保留其他 task 的最新內容；definition、state、歷史與必要投影逐步讀回。canonical 成功後才釋出同步；投影失敗保留 `projection_pending`，恢復不可重做已完成的外部請求。無程式取消／暫停不製造 commit。

開發完成、本地 commit／main 整合、中央承接、中央紀錄 commit、遠端／runtime 分欄報告。中央 owner 未交接時包留本地排隊，不否定已成立的本地成果，也不宣稱正式 task 已完成。證據承接前不刪工作本、note、intent 或交接包。

## 提醒、接續與停用

既有 attention／cleanup generator 接受 `workbook` 與可信 `workbookContext`；在讀中央 task 前分流。CLI `--workbook PATH` 回唯讀 JSON；禁止此模式的中央 write／notify。它依完整 scope 規劃，不因同 repo 有多個獨立工作或 pending push 一律擋住。序列化 read model 不含核准能力，cleanup 重新取得原工作本與來源。

只從 claim 指向的 home 讀 active／pending_writeback／stale／unknown，中央 status 另列；unknown 不等於 idle。Daily 自動消費與新 dashboard 不在本次。新接案可用 `setWorkbookAdmissionPolicy` 經可信授權停用，既有 active／pending 的 v1 reader、claim 與 recovery 保留。未知 contract／journal 版本不執行副作用。

## 啟用證據

新增行為測試入口為 `npm run test:workbook-flow`，涵蓋 `scripts/verify-workbook-{anchor,coordination,workers,visibility}.mjs` 與 `scripts/verify-local-task-handoff.mjs`。workers 使用真正獨立 Node 程序在隔離 Git fixture 測 claim／commit 競爭；fixture 的成功不等於真實 pilot。兩 repo／兩 session 需各有具名已核准工作，記錄中斷接續、中央排隊與正式承接、必要中央寫入數、人工協調及返工。完成所有必要情境與同版規則／入口核對後，再按具名切換授權啟用。
