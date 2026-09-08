# MorroWise 工作本開發流程 v1

> 實作狀態：具名 opt-in 入口已接線；尚未通過兩 repo／兩 session 實際 pilot，未切換預設。
> 工作身份：`morrowise/work-9510dad5-490b-4b7c-9a90-32e9f7f33aec`。
> 計劃與本次唯一工作本：`$COLLAB/notyet-harness/100_Todo/plan/2026-09-06-MorroWise-MVP-可行性計劃.md`。

本文件定義「各專案開發、驗收後集中登錄」的責任邊界。它不變更原 JV-37／P3 的完整驗收，也不授權 commit、push、建立 branch／worktree 或外部同步。既有 canonical 入口保留。新入口與必要 fixture 通過前，只有上述已核准改版的有限 bootstrap 可作人工等價操作；通過後才能依具名工作／session 核准進行 pilot。完整 pilot 與必要驗收通過後才可按核准範圍切換預設，讀到本文件本身不構成啟用授權。

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

repo 區分 canonical root、實際 checkout、產品 `write_paths` 與可選的控制紀錄 `control_paths`。後者納入核准及 ownership，但不納入產品受測 source，避免交接包引用自身。所有 scope 是精確相對檔案，不接受 glob、路徑越界或 symlink。home 綁 canonical repo 的唯一位置，linked checkout 從同一位置讀取；不同獨立 clone 的自動認領不在 v1。 repo 根可在共享契約使用 `$COLLAB/<safe relative path>`；舊 absolute 契約保持相容。`workbook.contract`、契約與 verifier 指紋保留原始內容；`getResolvedRepo`／`getResolvedRepos` 只為 IO 解析實际位置，根固定來自已安裝 harness 的相對位置，不讀 caller 提供的環境變數。具名工作本位置支援原本的 relative／absolute PATH 及 `$COLLAB/`，最終仍核同一 canonical home。驗收 executable 保留 absolute path 與 SHA，沒有一般變數展開。

既有 task 的 `canonical_baseline` 保存原 task ref／digest／完整 requirement matrix；每個本地 verifier binding 以相同 ID 及 `requirement_fingerprint` 連回原列。可信 resolver 重讀原矩陣、狀態與 start 條件；不得只保留 ID 卻削弱要求。新工作即使填 `canonical_baseline:null`，也須可信 resolver 確認相同 work ID 的 `exists:false`；未知不等於不存在，不能讓取消的 UUID 任務冒充新工作。改約需明確新版本與核准；停止或釋出原 claim 後才切換版本，不能在活躍 claim 下偷換 home 或 scope。

## 核准與真實驗收

人啟動 session 核對 Vincent 原始訊息、已登錄 project／repo 對應、精確 scope、允許動作與契約版本，再向程式 API 提供可信 `approvalResolver`。來源不可來自工作本中的 `approved:true`、任意 JSON 收據或未核對的 callback 回值。新 session 必須重取可信來源；無法取得時只允許唯讀準備，回 `requires_human_approval`。這是人監督的 adapter 邊界，沒有把本地 JSON 或 hash 冒充簽章核准，也沒有自動代讀聊天授權的服務。

`scripts/lib/workbook-session-context.mjs` 將這個人監督邊界接到 Codex Desktop 的固定 host reader。`inspectWorkbookHumanSource({sessionId,messageId,contentIndex})` 從本機使用者的 `.codex/sessions` 取得具名原訊息，只接受 root user session 的 `user.text`；AGENTS、環境說明、工具及 Agent 轉述不當成授權。來源不接受任意檔案或 module 路徑。先讀原文並完成語意審查，才呼叫 `createWorkbookSessionContext`，將 work ID、唯一 home、契約指紋、repo 對應、動作、原訊息 hash 與已讀人訊息水位綁在程序記憶體中。`commit`／`handoff`／`integrate` 還須綁精確 operation 指紋；一般 implement／verify 授權不推導出這些動作。

`getWorkbookSessionResolvers` 只接受原程序產生的 context；序列化／複製的 JSON 不具授權能力。每次使用重新讀契約、原授權來源及當前執行 session 的人訊息水位。新的人訊息出現時，先重讀及重新判斷語意；這不等於每次都再問一次核准。換 session 則由新的人啟動 Agent 重建 context，既有 claim 仍須明確交接。 品牌 context 另私有保存 canonical／checkout／Git common-dir 的真實位置及 directory identity，每次 refresh 重核；同一路徑換成另一個 repo 也會失效，正常 commit／HEAD 前進不因此失效。這個邊界防止把資料誤當授權，不宣稱能防禦同一 OS 帳號下可任意改程式的惡意程序。

`scripts/lib/workbook-anchor.mjs` 提供 `loadWorkbook`、`evaluateWorkbookGate`、`runWorkbookAcceptance`。依賴與既有 task 由可信 resolver 取得；缺資料停止相關副作用。驗收執行限定核准的絕對 executable、entrypoint、args 及其指紋；使用 `shell:false`，不接受 shell verifier。輸入 source／verifier 前後必須不變；核准的報告輸出可在驗收時生成。每個必要 ID 對應實跑結果、程式版本、輸出摘要與實際 artifact。

新工作可選 `requirement_baseline`，以 repo／安全相對 path、原要求區段 SHA256 與精確 IDs 綁定原文；區段由 `morrowise:requirements:start/end` 唯一 markers 包住原驗收表的資料列，每列保留原文字與 ID。`loadWorkbook`、實跑與收據查核都讀實際來源，驗每列 requirement_fingerprint、完整 IDs 與區段版本；基準文件也納入受測 source。進度區改動不改要求摘要；原要求改版則須更新契約版本與可信核准。舊契約未選此欄位時保持原行為，既有 canonical_baseline 約束仍適用。

尚缺必要 verifier／實際工作證據時，該 acceptance row 必須明記 `pending_reason`；完整驗收在任何命令執行前回 `requirements_not_ready`、逐列 `not_run`，舊／手組收據也不能通過。不能刪此欄位或只把 fixture 命令改名來宣稱已具備 live 驗收；移除 pending 需要具名真實來源／完成 predicate、相应 verifier 及新契約的可信核准。這是完整要求的版本綁定與拒絕機制，並未新增可信 live producer。`verify-workbook-requirement-binding.mjs` 驗正常來源、錯誤 ID／摘要、重複 markers、符號連結、pending 與偽造收據；隔離 fixture 正例不計 P8 真實試行。

`validateAcceptanceEvidence` 只驗內容一致性；不能靠手組 JSON 宣稱測試執行過。commit 重新執行驗收；正式承接要求可信 producer 查核。提交前的受測工作樹與已 review 的 C1 tree 必須有對應證據，不能要求 C1 之後 HEAD 仍等於提交前 HEAD。

## 開工、認領與提交

本地 `inspectWorkbookRepo` 不 fetch、不寫中央、不以 unrelated dirty／ahead／pending push 阻擋本地工作。原有遠端 Repo Ready／Remote Closeout 僅在該動作需要遠端交付時適用；目標與真實依賴仍必須可用。

`scripts/lib/repo-coordination-runtime.mjs` 延伸既有入口，匯出 `acquireWorkbookClaim`、`inspectWorkbookClaims`、`inspectWorkbookRepo`、`handoffWorkbookClaim`、`releaseWorkbookClaim`、`markWorkbookPending`。claim 存在 Git common-dir 的 `morrowise-workbooks-v1`；同檔不同 hunk 仍衝突。dirty scope 未取得可信 ownership 交接時不認領。過期只標 stale，不自動接管。

`commitLocalC1({workbook,...})` 轉入同一 coordinator 的 workbook 路徑。先取得精確 diff／group／message 的 commit 授權，再跑驗收；進短鎖後重查 HEAD、scope、index、active owner 與契約，使用 `git commit --only`。他方 staged 內容保持原樣。提交後核對 parent、實際 paths、blob、mode 與 message；中間 commit 只記 `committed_local/pending_delivery`。

持久 intent 先於 commit。commit 後 receipt 失敗時，從原 intent 與唯一符合的實際 commit 恢復，不重提。重送也重驗 commit object 與 Git note。真正 process crash 留下的鎖不按 TTL 刪除：`recoverWorkbookLocks` 必須查證同機原 PID 已停止，且可信 `lockRecoveryResolver` 確認具名 session／nonce 交接，才將鎖封存；接著從原 intent 繼續。

目前 CLI 的 `workbook-inspect --workbook PATH --session SESSION`、`workbook-claims --repo PATH` 僅唯讀。帶工作本的 mutation 使用已驗來源的 session adapter API；沒有 `--approved` 或任意 adapter module 的載入開關。`work-anchor-preflight.mjs` 已支援明確 `--workbook PATH`／`--workbook=PATH`，在讀中央 tasks 前分流；缺值、重複與來源混用會拒絕。獨立 CLI 沒有可信 context 時回 `requires_human_approval` 及非零 exit，支援 JSON／Markdown 輸出；已審查的 host adapter 以公開 `runPreflight(args, context)` 接續。既有 canonical／proposal 路徑保留。

`scripts/lib/workbook-preflight-adapter.mjs` 提供 `runWorkbookPreflight(args, context)` 與 `getWorkbookRuntimeContext(context, workbook)`。前者接受具名 `workbook`（或 API 名稱 `workbookPath`）及 `implementation`／`acceptance` event；工作本不能混用 `tasks` 覆寫、proposal 或手填 acceptance results。後者從既有 project/tasks/state、project topology 取得來源，既有 task 重用原 preflight 的 HC／weekly-core gate，原 dependencies 與 acceptance 不能省略；新 UUID 亦保留適用的 project-level weekly-core gate。呼叫端不得從工作本 JSON 或 CLI 注入來源 root、canonical／approval resolver。

implementation preflight 只讀，`allow` 與 `execution_ready` 分開：未有 active owned claim 時，下一步是依原 coordinator 認領；dirty scope 或他方 claim 必須先交接。acceptance 必須已取得每個 repo 的有效 claim，才執行原完整 verifier；它可能生成核准的報告，結果會標 `read_only:false`。執行後再次查核契約、來源、依賴與 claim，才回傳實跑收據。公開入口、Architecture Admission 與真實 pilot 的結果各自記錄；API／CLI 測試通過不等於真實 pilot 通過。

## 完工後正式承接

本地 producer `writeLocalTaskHandoff` 在核准的 control path 建立不可變包；開發期間不寫中央 pending。正式整合呼叫既有 `applyTaskEvents` 的明確 `localHandoffs` 分支，與 legacy event 互斥。preview 不寫檔、不釋出同步；apply 使用既有中央鎖、可信正式寫入／ownership、task 級 CAS、完整 candidate validator、語意查重與中央配號。

相同交接內容重送回原結果；同 ID 不同內容、同工作改 event ID 偷重送、中央 task 取消／改約都不覆寫。journal 以本 task before/after 恢復，保留其他 task 的最新內容；definition、state、歷史與必要投影逐步讀回。canonical 成功後才釋出同步；投影失敗保留 `projection_pending`，恢復不可重做已完成的外部請求。無程式取消／暫停不製造 commit。

`scripts/lib/workbook-intake-adapter.mjs` 將上述低階 producer／apply 接到同一人監督 session，沒有新增中央寫入器。`inspectWorkbookIntake` 唯讀取得當前正式來源、task 基準、具體 paths、dirty／claim 與 peer task 快照，供原 owner 審查。審查結果以 session decision 的 `intake_reviews` 將 `review_fingerprint` 綁定精確 `handoff`／`integrate` operation；`intakeReviewResolver` 每次重核原人訊息與目前 session 水位，序列化 review 不能自證核准。新工作仍逐筆以問題、owner、輸入輸出與完成邊界作語意查核，不能靠名稱匹配自動 distinct。

`runWorkbookIntakeAcceptance` 真正執行原工作本驗收，回傳 acceptance receipt 及私有程序內 producer；`createWorkbookIntakeContext` 明確區分 `purpose:handoff` 與預設 `purpose:integrate`：前者另帶精確 `outputPath`，僅提供本地輸出／producer 所需權限，中央有人使用也能先保存合格包；後者才核 central ownership、semantic 與正式整合權限。兩者分別交給原 `writeLocalTaskHandoff`／`applyTaskEvents`，本地 context 不能拿來正式寫入。偽造或複製的 producer 物件、改過的 review／source、中央他方 active claim、缺必要產品驗收均不得通過。中央快照在正式 mutation 前與原交易恢復邊界重核，合法交易之外的他方修改仍須重讀並重新審查。

換 session 或程序後不還原 JSON producer。排隊但尚無 journal 時，先核原 handoff 與未變的正式 before、當前依賴／原 gate 及明確移交的 claim，再重跑原驗收；已有部分 apply／projection_pending 時，先從固定中央路徑查原 journal、candidate 與 before／after，僅以已核定的原 before 重驗。新實跑結果必須與原受測 source files、verifier 與 artifact 一致，正常 C1 帶來的 HEAD 差由原 commit tree 證據核對，驗收時間與 stdout hash 可跨 run 不同，保留原、新兩份結果並將 producer ref 綁新實跑，不能宣稱證明舊 stdout 曾被產生；已變的產品不自動還原或補假 PASS。pending_writeback 只允許這項承接重驗，不因此重新開發。這些流程的隔離跨程序案例不計作 P8 人啟動的真實 session 試行。 中央 repo 若不屬於產品工作本的 repo 清單，也要在正式審閱快照綁其 root／common Gitdir 實體 identity；同路徑換 repo 後原審閱失效。

**目前的 runtime 限制**：此 adapter 的 producer 證明工作本 verifier 真正執行，尚不提供通用可信 live producer。candidate 或原 canonical task 的 `test_contract.runtime_evidence_required:true` 若要求 completed，`handoff` 與 `integrate` 都回 `runtime_evidence_unverified`；不能靠非空字串、fixture 收據或自填旗標替代。local-only 合法工作可承接；需要 runtime 的工作保留原完成條件及既有 canonical／remote 路由，待具名能力的可信 live producer 接妥後再驗，不藉此切換全域預設。

開發完成、本地 commit／main 整合、中央承接、中央紀錄 commit、遠端／runtime 分欄報告。中央 owner 未交接時包留本地排隊，不否定已成立的本地成果，也不宣稱正式 task 已完成。證據承接前不刪工作本、note、intent 或交接包。

## 提醒、接續與停用

既有 attention／cleanup generator 接受 `workbook` 與可信 `workbookContext`；在讀中央 task 前分流。CLI `--workbook PATH` 回唯讀 JSON；禁止此模式的中央 write／notify。它依完整 scope 規劃，不因同 repo 有多個獨立工作或 pending push 一律擋住。序列化 read model 不含核准能力，cleanup 重新取得原工作本與來源。

只從 claim 指向的 home 讀 active／pending_writeback／stale／unknown，中央 status 另列；unknown 不等於 idle。Daily 自動消費與新 dashboard 不在本次。新接案可用 `setWorkbookAdmissionPolicy` 經可信授權停用，既有 active／pending 的 v1 reader、claim 與 recovery 保留。未知 contract／journal 版本不執行副作用。

## 啟用證據

行為測試入口為 `npm run test:workbook-flow`，涵蓋 `scripts/verify-workbook-{requirement-binding,session-context,preflight-adapter,anchor,coordination,workers,visibility,portable-paths,intake-adapter,acceptance-coverage}.mjs` 與 `scripts/verify-local-task-handoff.mjs`。來源測試只在隔離 child 的 fixture host 模擬訊息，不提供正式程式的測試旗標或來源覆寫入口。workers 使用真正獨立 Node 程序在隔離 Git fixture 測 claim／commit 競爭；fixture 的成功不等於真實 pilot。公開 preflight 另由 `node scripts/verify-work-anchor-preflight.mjs` 檢查工作本先分流及舊 canonical 路由；helper 通過不可代替公開入口通過。

啟用分兩個階段：入口串接及必要 fixture 通過後，才能對具名工作／session 使用 pilot；完整 WF-V01～20、真實 pilot、同版規則及 Architecture Admission 通過後，才依具名切換授權啟用預設。`workbook_source_adapter.pilot_policy` 表達前者，`default_enabled` 與 activation evidence 表達後者；metadata 欄位不是授權。`node scripts/verify-morrowise-dev-workflow-catalog.mjs --workbook-metadata-only` 只驗 schema 與 metadata 反例，完整 Architecture Admission 仍須跑不帶此參數的 verifier。

兩 repo／兩 session 需各有具名已核准、用途獨立的真實工作，記錄中斷接續、中央排隊與正式承接、必要中央寫入數、人工協調及返工。新的人啟動 session 從原 home、原始訊息與已交接 claim 恢復；兩個 Node 程序或本次工作的兩個子步驟不算兩件真實工作。故障、取消及竞争反例在隔離 fixture 驗證，正式 tasks 不作破壞性測試資料。完成兩工作正式收尾及所有必要情境後，再按核准範圍切換；缺少協調時間基準時記 `not_observed`，不據此宣稱效率已提升。
