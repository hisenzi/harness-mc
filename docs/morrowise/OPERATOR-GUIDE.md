# MorroWise 操作指南

文件集版本：**v0.5.0** · 更新日期：2026-09-10 · 狀態：六情境公開候選，尚未提交或部署；各章版本獨立編號

> Status: public release candidate；not deployed
> Owner: Vincent
> Source of truth: 本檔是六章唯一人工正文；政策、能力實作與 task 狀態仍由各章列出的正本負責
> Updated: 2026-09-10
> Read when: 首次啟動、多人協作、執行驗收、版本交付、文件維護或故障接手
> Write policy: manual；網站只讀投影
> Stale rule: 協作規則、工具入口或原 task 的 ownership／驗收改變時，必須做人工 impact review
> Verifier: `node scripts/verify-morrowise-document-sources.mjs` 與六情境獨立操作驗收

六章與六頁導航／摘要是不同層次：操作正文只在本檔維護；網站與本地 human 摘要由同一 registry／bundle 生成。六章為待驗收的公開候選；本地預覽與公開發布包分開驗證。文件版本、程式版本、runtime 啟用及網路部署分開表示，不互相代替。

操作前提：`$COLLAB` 是既有協作環境的本地來源標籤，不是公開網址。以下命令需要已建置的 MorroWise 環境、指定檔案及相應權限；本指南不是從空白電腦安裝完整系統的教學，也不授予任何操作權限。

<!-- chapter:start entry -->
# 首次啟動與接手：先知道能不能安全開始

文件版本：**v0.4.0** · 更新日期：2026-09-10 · 狀態：公開候選（未部署）

> 文件識別碼：operator-guide-entry；章節鍵：entry
> 內容 owner：Vincent／JV-36；能力 owner：JV-45（account-login-sync-start-v1）
> 適用版本：JV-45 登入後判定契約 v1；實際啟用／repo 狀態以當次可信 probe 為準

## 這項能力能做什麼？

換環境或新開 Agent task 時，先讀對正本，再判斷本機與遠端資料是否足夠新鮮，才能知道下一步能否開始。
JV-45 是**登入完成之後的唯讀判定器**，不是登入器、安裝器或自動同步器。讀到 `ready` 也不代表已核准修改任何檔案。

適合首次接手、久未使用後返回、換裝置後確認現況；已在同一固定版本工作的短問答，不必重新安裝或重跑全部系統。
Vincent 管理帳號與登入；Agent 檢查獲准的 repo；原 task owner 確認工作來源；獨立 checker 核對判定證據。

## 人如何開始？

1. Vincent 先自行完成必要登入，告知 Agent 可以做登入後檢查。未告知前，Agent 不登入、不探測帳號或索取秘密。
2. Agent 讀 `$COLLAB/AGENTS.md` 指定的完整必讀鏈、目標 repo 的 `AGENTS.md`，再讀原 task／原規格。找不到正本就回報路徑缺口。
3. 確認這次要讀的精確 repo、允許的網路讀取，以及哪個 task 承接後續工作。不要用另一台機器的舊健康截圖代替。
4. 已核准 remote read 時執行下列現有 probe；它讀 Git metadata／remote HEAD，不 fetch、pull、commit 或 push。

```bash
node "$COLLAB/harness-mc/scripts/account-login-sync-start.mjs" \
  --probe --remote --root "$COLLAB/harness-mc"
```

5. 看回傳的 local／remote SHA、`observed_at`、`evaluated_at`、freshness、evidence digest 與 next action。不是只看 exit code 或單一 `ready` 字串。
6. `ready` 後仍要過原 task 的 work-anchor、scope 與 ownership 檢查；`blocked`／`degraded` 時保存安全摘要，交原 owner 決定下一步。

沒有 remote read 權限時不執行上述遠端查詢；只能報告本地資訊與 `remote_truth_not_probed` 的限制，不宣稱 remote 已同步。

## 給 AI Agent：從零建制到完成

「從零」指從這次需求開始接上既有能力；不是重寫已存在的 probe。

| 步驟 | 輸入與操作 | 產物／驗收 | 失敗去向 |
| --- | --- | --- | --- |
| 1 確認前提 | 原需求、已完成登入的告知、exact repo 與讀取授權；讀必讀鏈 | 原 home 能定位 owner、範圍與可用環境；不記帳號實值 | 缺前提回 Vincent／原 owner，不自行登入或安裝 |
| 2 查實際入口 | 讀下方契約與 CLI；核對執行檔存在、Node 依賴可用 | 命令與版本有依據，不使用未知副本 | 入口缺失回 JV-45 owner；維持未執行 |
| 3 取得判定 | 僅對核准 repo 執行可信 probe；remote read 另受授權約束 | 原始操作、時間、SHA 與去敏 evidence reference 可回查 | 網路／repo 異常回安全 next action，不變更 Git 狀態 |
| 4 解讀結果 | 核對 freshness、digest、clean 與 local／remote SHA | 只有可信、fresh 且相符的證據才接受 ready | dirty、分歧、缺 SHA 或 stale 交原 owner，不假同步 |
| 5 分辨工作類型 | 使用既有能力只留結果；改判定行為須另有原 task amendment | 程式變更先有失敗案例、最小修正與回歸；純文件不造 RED | 新實作需求回 JV-45，不塞入說明書 task |
| 6 更新與獨立核對 | 操作契約變更時更新本章或提出有證據 no-impact；checker 只靠文件接手 | 新正文、來源版本及受影響驗收一致 | 缺步驟回指南 owner；實作錯誤回能力 owner |
| 7 承接 | 回原 task／唯一 home，附判定與第一個未滿足 gate | 後續 Agent 知道可做什麼、不能做什麼；不把 ready 當工作完成 | 正式寫入未授權則交接等待，不搶寫 tasks.json |

## 必要檔案與 ownership

| 檔案／用途 | Owner 與讀寫邊界 |
| --- | --- |
| `$COLLAB/AGENTS.md`、`$COLLAB/notyet-harness/000_Agent/CORE.md` | Vincent／共享治理；必讀，本能力使用不修改 |
| `$COLLAB/harness-mc/system-workflow/docs/specs/account-login-sync-start.md` | JV-45；判定與秘密邊界正本，改契約才條件式可寫 |
| `$COLLAB/harness-mc/scripts/account-login-sync-start.mjs` | JV-45；既有 probe，使用時唯讀，核准能力修正才改 |
| `$COLLAB/harness-mc/scripts/verify-account-login-sync-start.mjs` | JV-45；修能力時跑相稱測試，fixture 不冒充當次真實 probe |
| `$COLLAB/harness-mc/milestones/morrowise/tasks.json#account-login-sync-start-v1` | 正式 task owner／指定 writer；只在核准 lifecycle 操作寫入 |
| `$COLLAB/harness-mc/docs/morrowise/OPERATOR-GUIDE.md` | JV-36 指定 writer；本章唯一正文，生成的 bundle／human／網站不可手改 |

## 判讀與停止條件

- `ready`：可信 probe、digest 相符、900 秒內且非未來的時間、repo clean、實際讀到 remote，local／remote SHA 相同。
- `dirty`、ahead／behind、diverged、missing／unknown：不是自動修復許可；保留本機工作，回原 owner 決定同步或續作。
- stale、future timestamp、digest 不符、自填 JSON 或 fixture：不得冒充當次 ready；重取核准範圍的可信證據。
- 只完成判定不等於後續 task 完成；帳號、repo 或權限問題只停受影響入口，不要求處理所有其他 repo。

## 驗收例與維護編號

- E-01 正例：給定可信且 fresh 的同版證據，讀者能找到原 task、核准操作與下一步；不存在隱含寫入。
- E-02 負例：把舊 probe 或另一 repo 的 SHA 當輸入，讀者應指出無效／缺口，不沿用 ready。演練不能假稱已執行 remote probe。

## 版本與維護

1. 文件 ID `operator-guide-entry`、目前 v0.4.0；版本描述本章內容，不是本機 ready 或 runtime 啟用版本。
2. E-03 維護：JV-45 契約、CLI 或 freshness 規則變更時，作者記 affected chapter `entry`；具名 reviewer 核對更新／no-impact，更新文件版本、歷史與來源審查後重建。
3. E-01–E-03 是章內引用，不是新 task／驗收矩陣；正文證據回 JV-36，實際能力驗收回原 task 的既有 acceptance IDs。

## 版本歷史

### v0.4.0 — 2026-09-10｜同 repo 正文遷移與部署前接線

- 更新唯一正文定位與公開候選邊界；保留章節 ID、薄來源引用與所有歷史。


### v0.3.0 — 2026-09-08｜首次啟動與登入後判定

- 新增人讀入口、Agent 接手步驟、必要檔案、可信證據與失敗去向。
- 只解說現有 JV-45；未替使用者登入、同步 repo 或執行外部 probe。
- 適用驗收與來源證據回 JV-36／原能力 task；本章仍為本地預覽候選。

<!-- chapter:end entry -->

<!-- chapter:start collaboration -->
# 多人協作：一起完成工作，不互相覆蓋

文件版本：**v0.5.0** · 更新日期：2026-09-10 · 狀態：公開候選（未部署）

> 文件識別碼：operator-guide-collaboration；章節鍵：collaboration
> 內容 owner：Vincent／JV-36；能力 owner：JV-37／JV-32
> 適用版本：multi-machine-repo-coordination v1.4；workbook v1 為具名 opt-in，非預設

### 這項能力解決什麼問題？

兩個以上 Agent 同時工作，可能改到同一個 repo、依賴彼此成果，或碰到同一份檔案。正確做法是：**一人協調、分工並行、共用檔單一整合、獨立驗收。**

Vincent 負責範圍、權限與取捨；Agent 自行完成已核准範圍內的核對與交接，不把 Vincent 當日常傳話人。這不是新增的自動協作服務，不能假設系統會自動替所有錯誤做決策。

### 何時使用？

- 兩個 task 需要交換成果或驗收證據。
- 多個 Agent 使用同一個 repo，或兩案會修改共用檔案。
- 原執行者中斷，需要另一個 Agent 接續。
- 工作完成，需要指定整合者承接正式結果。

單一 Agent、沒有交接或共用檔的短工作，不必為了形式新增協作紀錄。

## 開始前的六項核對

1. 本次要完成什麼，哪些內容明確排除。
2. 每案的原 task、原臨時文件或有效工作本在哪裡。
3. 已核准哪些動作；讀取、修改、傳訊、commit、push、部署不可互相推定。
4. 各自能改哪些精確檔案，哪些檔案已有他人修改。
5. 誰協調、誰寫共用檔、誰獨立檢查、誰承接正式結果。
6. 用什麼證據判定完成，失敗時回哪個原落點處理。

已有正式 task 就保留原身份與驗收條件；不要為協作另建 task 清單、編號表或第二份即時進度正本。

## 五種角色

| 角色 | 負責什麼 | 不能代替什麼 |
| --- | --- | --- |
| 協調者 | 核對範圍、版本、owner、依賴及交接點，整理需要人決定的問題 | 不能替 Vincent 核准新範圍或接管他人檔案 |
| 各案執行者 | 修改自己核准的檔案，維護自己的原文件與證據 | 不能替另一案改進度或宣告完成 |
| 共用檔整合者 | 取得明確交還後，作為該檔唯一 writer 整合需求 | 不能把另一案所有檔案一起收走 |
| 獨立檢查者 | 唯讀比對需求、來源版本、產物及驗收證據 | 不能只看作者的 pass，也不是同步 writer |
| 正式承接者 | 依原流程與寫入授權把結果回到原 task／唯一 home | 不能把聊天、本地測試或 commit 直接當整案完成 |

## Codex Desktop 的任務協作入口

這些是本次 Codex Desktop 實際可用的 task 入口，不代表其他 Agent 平台一定有相同 API：

| 目的 | 入口 | 使用邊界 |
| --- | --- | --- |
| 找到任務 | `list_threads` | 用正式回傳的 task ID／標題確認對象，不憑相似名稱猜測 |
| 讀取進度 | `read_thread` | 只讀本次協作需要的範圍、owner、版本與交接資訊 |
| 查詢／等待 | `wait_threads` | 使用 cursor 或 `timeoutMs: 0` 取得精簡現況 |
| 傳送協作訊息 | `send_message_to_thread` | 只交換已核准的路徑、指紋、ownership、task 狀態與驗收證據 |

沒有回覆不能當成同意或交還 ownership；工具不存在、對象不唯一或權限不明時，停相關傳訊，回報最小缺口。

## 從分工到正式交接

### 1. 協調者先對齊範圍

向各案核對原需求、原文件／task、目前版本、可寫檔案與驗收條件。把檔案分成不重疊、可並行的檔案，以及需要單一 writer 的共用檔案。

可觀察結果：每案都能說出自己負責什麼、可寫哪裡、何時需要交接，不靠聊天猜測。

### 2. 不重疊的工作並行

各執行者依自己的核准範圍繼續，進度與證據回自己的原 task／唯一 home。依賴另一案產物時，先約定交付版本、內容及接收驗收，不提前假設對方完成。

### 3. 共用檔先交接，再修改

同一檔案即使是不同 hunk，也不能由兩個 Agent 同時修改。雙方先提出修改需求與驗收條件；原 writer 明確交還後，接手者重讀最新整檔、hash、diff、ownership 與來源。hash 不符就先查明，不套用舊方案。

### 4. 整合後重驗，再交獨立檢查

整合者重跑受影響驗收；有效且未受影響的證據可以保留。獨立檢查者讀原需求、必要來源、版本、實際差異與產物，不只讀整合者結論。每筆結果要能回查輸入、操作、預期與實際觀察。

### 5. 各案接收，正式結果回原處

各案 owner 確認收到成果與證據；正式承接者依適用流程回寫原 task。工作本路徑的本地證據先留唯一 home；中央 owner 未接收時可以排隊，但不能宣稱正式 task 已更新。

## 四個接手情境

### 情境一：兩案修改不同檔案

檔案互不重疊且各有核准 scope。協調者確認共同依賴與交付版本後，各案繼續。通過條件是每案都有自己的 writer、scope、版本及證據落點；某案缺權限時，只停受影響操作。

### 情境二：兩案要改同一檔，還沒交接

即使不同 hunk，也拒絕第二 writer。保留原 diff，讓不重疊工作繼續。測試通過、對方沒有回覆或紀錄 stale，都不能代替明確交還；不可自行開 branch／worktree 解套。

### 情境三：已明確交接共用檔

原 writer 交還，接手者取得最新 hash／diff、雙方需求及驗收條件後，單人整合。重驗受影響項，再由獨立檢查者核對來源與產物，各案確認接收。版本再次變動時，停止該檔與相依步驟並重新確認。

### 情境四：工作未完成，執行者退出

退出者保留版本、已做／未做、證據、未解問題、第一個未滿足步驟及 ownership 是否交還。接手者從原落點接續，不必全案重做；未證實原 writer 停止或未取得交接時，不 takeover。stale 只表示需要查明，不表示無人負責。

## 交接包最小欄位

```text
原 task／唯一 home：
原核准引用與允許動作：
交還者／接手者／獨立檢查者：
精確可寫檔案與禁寫檔案：
文件及必要來源版本／hash：
本次實際差異：
原驗收條件與逐項結果：
證據位置：
已做／未做／未解問題：
下一個未滿足步驟：
正式承接者與接收結果：
本地／commit／正式承接／遠端／runtime 狀態：
```

交接包引用各案原落點，不複製成另一套追蹤系統。證據尚未承接前，不因換人刪除原文件或收據。

## 出問題時回哪裡

| 問題 | 回流方式 |
| --- | --- |
| scope、owner 或版本不明 | 停受影響檔案，回協調者核對原 owner |
| 指南缺步驟或與正本矛盾 | 回指南 owner 修訂並重驗，不偷偷改政策 |
| 實作不符合核准規格 | 回原實作 owner，不降低驗收迎合程式 |
| 證據不足 | 保留 `fail`／`not_run`／`unknown`，補實證後再驗 |
| 缺工具、權限或發布決策 | 回報限制與最小待決策項，不換通道繞過 |
| 新需求或範圍擴張 | 回 Vincent／原決策者核定，不借補漏擴權 |

## 工作本與版本限制

具名工作本入口已接線但不是預設；完整真實 pilot 尚未完成，`default_enabled` 仍為 `false`。讀到本章不代表已選用工作本。

- `workbook-inspect`、`workbook-claims` 是唯讀入口。
- `work-anchor-preflight.mjs --workbook PATH` 已支援；獨立 CLI 缺可信 context 時會拒絕，不是補 `approved` flag 就能開工。
- 寫入、驗收、commit、handoff 與正式 integrate 仍須各自的可信 context、scope、claim 與授權。
- 尚缺必要 verifier 或真實工作證據時，原 owner 必須在對應 acceptance row 保留 `pending_reason`；完整驗收會在任何驗收命令執行前回 `requirements_not_ready`，逐列為 `not_run`。這不是程式已執行而測試失敗，也不是可以略過的提醒。不可刪 pending、改 fixture 名稱或手組收據放行；回原 owner 補真實來源、完成 predicate 與對應 verifier，並取得新契約的可信核准後再驗。
- candidate 或原 task 要求 runtime evidence 時，先依原工作本契約由 owner 核定 verifier 的 `runtime_observation`（`environment_ref`、`check_ids`、`max_age_ms`）；runner 提供單次 context，核對唯一觀測行、當次 checks 與實際 artifacts。handoff／integrate 重用時仍重驗來源與版本；未綁定、fixture、換環境、過期或缺證據仍拒絕。nonce／hash 不證明 verifier 的方法充分，也不代表完整 P8 或預設啟用已驗收。
- Repo Ready 的 `--local-commit` 是明確核准本機 C1 時的狹義入口；保留真實 ahead，不表示已 push、remote-ready 或允許一般實作跳過 ownership。一般本地工作沿當次核准範圍，不因讀到此旗標就自行提交。

這些限制不妨礙已核准的人工／Agent 協作，但不能把人工案例說成工作本完整 runtime 已驗收或已切換預設。

## 給 AI Agent：從零建制到完成

這是 **AI Agent 建制**入口：在既有 MorroWise 專案內，從一個需求到可交付的多人協作能力，需要接上「任務 → 規格 → 權限與 ownership → 操作／實作 → 測試 → 說明書 → 獨立驗收與正式承接」。它不是重新安裝 MorroWise 的教學，也不是看到檔案清單就全部重寫。

先判斷工作類型：**使用既有協作**只需沿用現有規則與工具；**改善協作能力**才可能修改 runtime／契約；**補使用指南**只改正文及必要網站來源。本次 v0.5.0 仍屬第三種，不代表已核准或完成下列所有能力建制。

### 1. 備妥環境與原 task

輸入：可讀取的 `$COLLAB/notyet-harness` 與 `$COLLAB/harness-mc`、本機已安裝的 Node.js／專案鎖版依賴、原需求及明確核准。先讀 `$COLLAB/AGENTS.md`、目標 repo 的 `AGENTS.md`、`CORE.md`，再讀原 task／原規格與其驗收矩陣。缺 repo 或依賴時，回報環境缺口；安裝與外部存取依本次授權處理，不沿用未知副本。

在原 task／原臨時文件填齊目的、輸入、可寫檔案、禁寫範圍、操作、產物、原驗收 ID、證據位置與失敗去向。沒有正式 task 時先依既有 task lifecycle 提案，取得承接與實作授權後才寫入；不要另開一套能力追蹤清單。

只有選用 `requirement_baseline` 的新工作本，才另核對原要求來源的 repo／安全相對 path、唯一 `morrowise:requirements:start/end` markers 所包住的原驗收表資料列區段 SHA256、完整 IDs 與逐列 `requirement_fingerprint`；原基準文件也納入受測 source。要求改版須更新契約版本並重取可信核准，不能只保留 ID 卻弱化原文。未選此欄位的舊契約保留原行為，既有 `canonical_baseline` 約束也仍適用；一般人工協作不因此被要求建立工作本。來源不符時回原 owner 修正或重新核准，不繼續驗收。

本章正文沿 `morrowise/document-source-registry-and-human-sync`（JV-36）；網站沿 `harness-mc/morrowise-fumadocs-manual-surface-v0`（MC-DOCS-01）。協作機制的實作則回其原 owning task，不把 runtime 工作塞進這兩筆說明書 task。

產物／完成條件：下一位 Agent 能由原 task 找到核准範圍與可判定矩陣。缺承接、授權或關鍵決策時，回原規格／決策者，停在提案而非開工。

### 2. 確認需要哪些檔案

以下是本能力的檔案地圖。「先讀」不等於「必改」；只有原核准 scope 中確實受影響的檔案才能修改。其他能力沿其原 owner／來源替換對應落點，不複製這些檔案成新正本。

| 建制項目 | 檔案與用途 | 寫入判斷 |
| --- | --- | --- |
| 正式承接 | `$COLLAB/harness-mc/milestones/morrowise/tasks.json`；網站另由 `$COLLAB/harness-mc/milestones/harness-mc/tasks.json` 承接 | 原 task 的 scope、矩陣或結果確需更新且已核准時；不整檔覆蓋 |
| 可執行規格 | `$COLLAB/notyet-harness/100_Todo/plan/2026-09-05-heptabase-morrowise-manual-sync-spec.md` | 本說明書案的執行依據；其他案維護自己的原文件，不借本檔擴 scope |
| 政策與協作入口 | `$COLLAB/notyet-harness/000_Agent/CORE.md`、`$COLLAB/harness-mc/system-workflow/docs/specs/repo-coordination-gate.md`、`$COLLAB/notyet-harness/000_Agent/skills/multi-machine-repo-coordination/SKILL.md` | 先讀沿用；只有原 owner 核准政策修改才改，不因指南缺字改政策 |
| 執行／驗收／task 寫入 | `$COLLAB/notyet-harness/000_Agent/skills/vincent-superpowers/03-execution/SKILL.md`、`$COLLAB/notyet-harness/000_Agent/skills/review/SKILL.md`、`$COLLAB/harness-mc/system-workflow/docs/task-write-command-map.md` | 選擇適用既有流程／producer，不新增 task writer |
| 開工與協作工具 | `$COLLAB/harness-mc/scripts/work-anchor-preflight.mjs`、`$COLLAB/harness-mc/scripts/repo-coordination-runtime.mjs` | 條件式修改：核准能力缺口涉及這些入口時；使用既有能力不改程式 |
| 工作本契約與實作 | `$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-workbook-flow.md`、`$COLLAB/harness-mc/system-workflow/schemas/morrowise-workbook.schema.json`、`$COLLAB/harness-mc/scripts/lib/workbook-coordination.mjs` | 僅限具名 opt-in 且核准變更工作本；人工協作不必建立工作本 |
| 能力接線 | `$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json`、`$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json`、`$COLLAB/harness-mc/system-workflow/registries/morrowise-wiring-gate.json` | 介面、能力狀態或 wiring 改變時，更新對應既有項目、history 與適用版本審查；補文案不必改 |
| 行為測試 | `$COLLAB/harness-mc/scripts/verify-work-anchor-preflight.mjs`、`$COLLAB/harness-mc/scripts/verify-workbook-flow.mjs`；工作本原要求綁定另見 `$COLLAB/harness-mc/scripts/verify-workbook-requirement-binding.mjs`；其餘沿原 task 指定 verifier | 先新增重現缺陷的案例，再修實作；只跑受影響與原矩陣必要測試。新 verifier 已由原 `test:workbook-flow` 聚合命令涵蓋；只補指南不因此執行 runtime 驗收 |
| 唯一能力操作正文 | `$COLLAB/harness-mc/docs/morrowise/OPERATOR-GUIDE.md` | 操作、限制或維護說明有變化時修改；本檔不是政策正本 |
| 文件登錄與生成 | `$COLLAB/harness-mc/system-workflow/registries/morrowise-document-sources.json`、`$COLLAB/harness-mc/scripts/generate-morrowise-documentation.mjs`、`$COLLAB/harness-mc/scripts/verify-morrowise-document-sources.mjs` | 正文變更需審查 registry 的 hash／summary；只在生成契約需變且核准時改 generator／verifier |
| 網站呈現與測試 | `$COLLAB/harness-mc/app/docs/[[...slug]]/page.local.tsx`、`$COLLAB/harness-mc/app/docs/version-history.mjs`、`$COLLAB/harness-mc/app/docs/docs.css`、`$COLLAB/harness-mc/lib/morrowise-docs-source.ts`、`$COLLAB/harness-mc/scripts/verify-morrowise-docs-surface.mjs` | UI／導覽／搜尋或版本呈現有變化才改；不把正文另存進網頁程式 |
| 自動產物 | `$COLLAB/harness-mc/.tmp/morrowise-docs/bundle.json`、`$COLLAB/harness-mc/.tmp/morrowise-docs/site/` | 只由工具重建；不可手改，不是第二份正文，也不是可直接發布的 public artifact |

產物／完成條件：原文件有本輪精確檔案清單及每檔 writer，並能區分必讀、需改、條件式與生成檔。若檔案已改名、入口不存在或來源衝突，先回 owner 修正 mapping，不猜路徑繼續。

### 3. 通過開工與分工檢查

一般 canonical task 路徑可執行既有 preflight；先將占位符換成原核准 ID，以下不是批次建立 task 指令：

```bash
node "$COLLAB/harness-mc/scripts/work-anchor-preflight.mjs" \
  --project "<原 project ID>" --task-id "<原 task ID>" --intent "開始"
```

檢查 `result: allow`，但不能把它當成新授權或 ownership 證明。再依協作 skill 核對 Repo Ready、dirty files、必要版本與五種角色；Repo Ready 可能涉及 fetch，須按本次權限執行。本案已有「既有未 push commit 不阻擋本地實作」的限定核准，不外推成其他 gate 豁免。

透過實際可用的 task 工具找對象與讀進度，取得目標／資料範圍授權後再傳訊。`send_message_to_thread` 可能啟動對方工作；送達不等於接受 ownership。工作本缺可信 context 時必須拒絕，不偽造批准欄位。

產物／完成條件：原落點記錄協調者、各 writer、共用檔唯一整合者、獨立 checker、正式承接者與交接版本。同檔未明確交還就停該檔；不重疊工作照常繼續。

### 4. 完成操作或實作必要缺口

使用既有能力：依「從分工到正式交接」完成一輪實際分工、並行、交接與接收，不修改 runtime。改善能力：從原 task 的缺口新增會失敗的正反測試，修改最小相關入口，再跑測試；契約改動才連動 schema／registry／catalog 與原版本審查，不能只補一個函式就稱已接入系統。

只補指南：跳過 runtime 實作與操作 pilot，以正文 diff、來源核對及第 5–6 步的文件／網站驗證作適用證據，在原 task 註明不適用理由，不填造 RED／GREEN；若同時新增網站互動，該程式行為仍先做失敗測試再實作。

涉及工具的命令按實際改動選用，**不是每次更新說明書都必跑**：

```bash
npm --prefix "$COLLAB/harness-mc" run test:repo-coordination-runtime
npm --prefix "$COLLAB/harness-mc" run test:workbook-flow
node "$COLLAB/harness-mc/scripts/verify-work-anchor-preflight.mjs"
npm --prefix "$COLLAB/harness-mc" run test:capability-registry
npm --prefix "$COLLAB/harness-mc" run test:morrowise-wiring
```

產物／完成條件：有實際差異、RED／GREEN 與受影響 regression；使用既有協作則交付實際操作紀錄。任何失敗回實作 owner；不能刪測試或降矩陣。fixture 不代替原 task 要求的 runtime pilot；工作本仍受前節 opt-in／未完成完整 pilot 的限制。

### 5. 把能力變化接到說明書

輸入是能力／架構的實際差異，不只檢查 Markdown 是否改過。作者指出受影響正文、維護 owner 與更新需求；checker 核對「工具改了但正文沒動」時，是否有充分、可回查的 `no-impact` 理由。需更新則修唯一正文與文件版本，重新核對命令、路徑、限制及使用情境，再由實際 reviewer 審查 registry 的摘要與 hash。

```bash
npm --prefix "$COLLAB/harness-mc" run docs:generate
npm --prefix "$COLLAB/harness-mc" run docs:check
npm --prefix "$COLLAB/harness-mc" run test:morrowise-documentation
npm --prefix "$COLLAB/harness-mc" run docs:build:local
```

產物／完成條件：正文與 bundle 逐字一致、來源 fresh、同輸入重建一致，本地產物只在上述 `.tmp` 位置。瀏覽器實看 `/docs/capabilities/collaboration` 的新正文、導覽、搜尋及版本 toggle；漂移時回正文／registry owner 查明，不只改 hash 壓掉錯誤。只有 build 綠燈仍不足以證明可操作。

`docs:build:local` 只產生靜態檔，不會啟動網站。先確認本案 loopback 預覽是否已存在；沒有時，在獨立終端啟動以下既有 Next 開發入口（使用已安裝依賴，不執行安裝）：

```bash
npm --prefix "$COLLAB/harness-mc" run dev -- --hostname 127.0.0.1 --port 3001
```

服務使用 `$COLLAB/harness-mc`，讀取已審查的 bundle；開啟 `http://127.0.0.1:3001/docs/capabilities/collaboration`。端口已占用時先確認 owner 與是否為本案服務，不終止他人 process；經核對可改用空閒 loopback port，證據同步記實際 URL。正文／registry 更新並重新生成後，若 dev 仍快取舊 bundle，重啟自己啟動的預覽再讀回；來源 hash 不符仍按失敗處理，不停用 gate。結束時在啟動終端按 Ctrl+C，只停止自己的服務。dev 預覽與靜態 build 是兩份不同證據，都不是部署。

### 6. 用正反情境做獨立接手驗收

checker 只拿固定版原規格、task、檔案與交接包，按原矩陣逐項重現，不靠作者補充關鍵步驟。以下是前述四情境及維護風險的操作檢查，不是取代原 task 矩陣的新編號表。

| 操作 | 必須看見的結果 |
| --- | --- |
| 兩案操作不同檔 | 各 writer 在自己的 scope 並行；證據回各自原 task |
| 兩案要求同檔、未交接 | 第二 writer 不寫該檔；不同 hunk、stale 或沉默都不能放行 |
| 明確交接後整合 | 單一 writer，以最新版本整合；受影響測試與獨立檢查通過，雙方確認收到 |
| 未完成退出後接續 | 下一位找到原 home、未完成 gate、ownership 與下一步；未交接前不接管 |
| 工具改動、沒有更新說明也沒有理由 | 文件就緒檢查不通過，回 owner 補 impact review／正文；首階段是人工檢查，第二階段已加本地 gate，仍不是自動 merge gate |
| 合法 `no-impact` 或正確更新 | checker 核對實際差異、理由與來源；無影響不強制空改，有影響則重驗新正文與網站同版 |
| 只有離線測試通過 | 報告只記離線結果，不升格成真實 pilot、預設啟用或線上完成 |

產物／完成條件：每筆證據有輸入版本、操作、預期、實際與 producer。缺步驟回規格／指南 owner，實作錯誤回 writer，checker 漏抓則補其檢查案例；修訂後重驗受影響項，未跑保留 `not_run`，不寫假 pass。

整案 canonical task 驗收須依 `$COLLAB/notyet-harness/000_Agent/skills/vincent-superpowers/03-execution/SKILL.md` 的 acceptance event 流程：從當前 `acceptance_matrix` 計算指紋，以原 ID 的精確覆蓋與逐項實跑結果執行 `work-anchor-preflight.mjs --event acceptance`。只有 top-level／event allow、current fingerprint 相符、exact coverage 與 all_passed 才是成功 receipt；blocked 也可能回傳 receipt，不能看到收據就當通過。有效 opt-in 工作本沿其原驗收路由與完整要求，不額外強制中央 event。本地 slice 只回原落點的階段證據，不送假全項 pass、不刪未跑的 runtime／WEB 條件。

### 7. 正式承接與完成邊界

把收據交給各案正式承接者；本章來源證據回 `$COLLAB/harness-mc/milestones/morrowise/tasks.json#document-source-registry-and-human-sync.test_contract.evidence_refs`，網站證據回 `$COLLAB/harness-mc/milestones/harness-mc/tasks.json#morrowise-fumadocs-manual-surface-v0.test_contract.evidence_refs`。機制改良的證據回其原 task。用既有 task 寫入流程及授權更新，未承接就明記等待接收。

**「能力完成」必須是原核准範圍的操作／實作、必要測試、文件、獨立驗收與正式承接全部接上。** 若本輪只完成文件或本地 slice，只能回報該層完成；原矩陣尚有 runtime／線上條件時，不把整案設為 completed。退出時留下已做／未做、未過 gate、版本、ownership 是否交還與下一步。

Git commit、push、部署、預設啟用不是這份指南的隱含授權。後續網路呈現沿核准的 **GitHub → Zeabur → Fumadocs** 路線，以原 WEB 矩陣取得版本綁定的 live 證據，不把 local build 當上線。

## 規則與維護來源

本章是人讀操作解說，不是另一份政策或 task 正本。衝突時回以下正本：

- `$COLLAB/notyet-harness/000_Agent/CORE.md`
- `$COLLAB/harness-mc/system-workflow/docs/specs/repo-coordination-gate.md`
- `$COLLAB/notyet-harness/000_Agent/skills/multi-machine-repo-coordination/SKILL.md`
- `$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-workbook-flow.md`
- `$COLLAB/notyet-harness/000_Agent/skills/vincent-superpowers/03-execution/SKILL.md`
- `$COLLAB/notyet-harness/000_Agent/skills/review/SKILL.md`
- `$COLLAB/notyet-harness/000_Agent/skills/write-temporary-doc/references/closed-loop.md`
- `$COLLAB/harness-mc/milestones/morrowise/tasks.json#document-source-registry-and-human-sync`

## 版本與維護

### 1. 版本識別

| 項目 | 本章定義 |
| --- | --- |
| 文件識別碼 | `operator-guide-collaboration`，沿用文件來源登錄 ID，不新增 task ID |
| 目前文件版本 | `v0.5.0`；版本描述正文內容，不代表協作 runtime 的版本 |
| 維護 owner | Vincent／JV-36；本次文字修訂者為 Codex |
| 唯一正文 | `$COLLAB/harness-mc/docs/morrowise/OPERATOR-GUIDE.md` |
| 來源指紋 | 由文件 registry 的 `source_refs[].fingerprint` 與 `summary_reviewed_source_fingerprint` 綁定本檔；不在正文內放自身 hash |
| 發布狀態 | 公開候選，尚未提交或部署；Git commit、Main 合入版本、Zeabur deployment 與 live acceptance 尚須各自證據，不能從文件版本推定 |

本章採 `v主版.次版.修訂版`：不相容的操作／責任契約改動升主版（仍需原政策核准）；新增相容步驟升次版；錯字、連結與不改語意的澄清升修訂版。每次可交付的修訂都更新頁首、此表及下方歷史，三者必須一致；舊版紀錄保留，不覆寫成新版已完成。

### 2. 維護流程

1. **辨識影響**：協作規則、實際工具入口、檔案契約或原 task 驗收改變時，變更作者在原 task／原臨時文件記錄受影響段落、owner，以及更新／`no-impact` 的理由與來源版本；沒有正文差異時保留版本，不製造空修訂。
2. **先修唯一正文**：由取得 ownership 的 writer 修改本檔、版本及歷史，重新核對建制步驟與四個接手情境。正文與政策矛盾時回政策 owner，不在指南私自創新規則。
3. **審查後重建投影**：實際 reviewer 確認內容與來源後，更新 `$COLLAB/harness-mc/system-workflow/registries/morrowise-document-sources.json` 內本章來源 hash、reviewed hash、日期及 reviewer；不能只換 hash 壓掉 drift。依本章建制命令生成 bundle，驗 source parity 與網站。
4. **把證據交回原處**：JV-36 承接正文／來源證據，MC-DOCS-01 承接頁面／互動證據；失敗回原 writer 修正，版本變動後重跑受影響驗收。GitHub → Zeabur 是後續發布路線，須通過原 task 的發布授權與 WEB 驗收，不能因本地 pass 就同步上網。

合入 Main 不代表 runtime 已啟用。發布時另記 exact commit SHA、bundle digest、deployment ID、URL 與 live 驗收；回退只能採已審查的相容版本，仍依發布授權執行。本章沒有授權部署或變更工作本預設值。

## 版本歷史

### v0.5.0 — 2026-09-10｜同 repo 正文遷移與部署前接線

- 更新唯一正文定位與公開候選邊界；保留章節 ID、薄來源引用與所有歷史。
- 接上新版具名 runtime observation 與狹義本機 C1 邊界，不宣稱 P8 完成。


點擊版本列展開／收合；鍵盤可聚焦版本列後按 Enter 或空白鍵。原 Markdown 中各版本仍是可直接閱讀的段落。

### v0.4.1 — 2026-09-09｜對齊本地文件路由

- 網站檔案地圖改指向 `page.local.tsx`；公開建置不納入本地說明書，協作規則與正文來源不變。
- 本次僅修路徑引用，不代表公開發布或協作 runtime 已啟用。

### v0.4.0 — 2026-09-08｜接上原要求綁定與驗收未就緒處理

- 依工作本契約補條件式 `requirement_baseline`、來源版本核對，以及 `pending_reason`／`requirements_not_ready` 的停止與回流；保留舊契約相容、runtime gate、具名 opt-in 與未完成真實 pilot 的限制。
- 檔案地圖補原要求綁定 verifier；原聚合命令不變，不把 fixture 通過當成真實工作驗收。
- 來源：`$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-workbook-flow.md`，程式提交 `279f4e088b501462c555fa19345ed1509ed05d49`。文件影響審查與本版實跑證據回原 JV-36／MC-DOCS-01；沒有修改協作 runtime 或核准部署。

### v0.3.0 — 2026-09-08｜六章指南中的協作入口

- 保留四個接手情境、Agent 七步、十二類檔案、原 ownership 與完整歷史；用章節邊界接入同一份六章投影。
- 更新當前版本與 runtime 證據限制；文件更新及版本交付詳見本版對應章，不新增協作制度。
- 舊版驗收不自動適用本版；受影響證據回 JV-36／MC-DOCS-01，workbook 仍非預設且非完整 pilot 完成。

### v0.2.0 — 2026-09-08｜Agent 建制指南與版本維護

- 變更：補上從零建立多人協作能力所需的檔案、步驟、產物、驗收與失敗去向；區分必備規則與條件式 runtime 實作。
- 維護：加入文件編號、版本規則、來源審查與更新流程；網站把本節各版本呈現成原生展開區塊。
- 依據：Vincent 對首章提出「給 AI Agent 的建制做法／檔案」與「編號／toggle 歷史」回饋。
- 邊界：本地預覽候選；不是工作本完整 pilot、全案完成或已部署版本。實跑收據回原 JV-36／MC-DOCS-01 的 `test_contract.evidence_refs`，不在此另立進度正本。

### v0.1.0 — 2026-09-08｜多人協作首章基線

- 首次編號：為本次修訂前的首章基線補列歷史編號，原文當時未顯示版本號。
- 內容：六項前置核對、五種角色、Codex 任務工具、五步交接、四個情境與工作本使用限制。
- 狀態：曾完成該版的本地來源／網站驗證，仍未發布；舊驗證不自動適用於 v0.2.0。
- 可追溯來源：正文 SHA-256 `5371dde6fe2666bf8b0ff8e7f23974acd4a86e07d34cb77d827a42b116d38b00`；舊版收據留在原 task。

<!-- chapter:end collaboration -->

<!-- chapter:start execution -->
# Task 執行與驗收：把需求做到有證據的結果

文件版本：**v0.4.0** · 更新日期：2026-09-10 · 狀態：公開候選（未部署）

> 文件識別碼：operator-guide-execution；章節鍵：execution
> 內容 owner：Vincent／JV-36；能力 owner：JV-40／JV-32，臨時文件方法沿 JV-51
> 適用版本：execution v1.7、review v1.3、CLM-1；具名 workbook 的替代路由另受可信核准約束

## 這項能力能做什麼？

讓 Agent 接到核准需求後，知道要改哪裡、如何驗證、不通過回哪裡，以及成果如何回原 task。
它適合實作、修正與正式驗收；純查詢／盤點按原用途交付，不為形式新增 task、測試或程式。
臨時文件是執行依據，不能取代正式 task、政策或程式行為。Ready 只表示足以進入指定下一步，不是授權。

## 人如何操作？

1. Vincent 說明目標、non-goals 與允許動作；Agent 先找原 task，不依標題相似就另建一筆。
2. 作者把需求接到原規格與原驗收 ID，列精確可寫檔案、writer、獨立 checker、輸入／產物及停止點。
3. 正式承接與實作授權成立後，Agent 過 preflight／ownership，再按核准範圍逐步執行。
4. 每步保留實際差異與證據。行為修改先做能重現問題的失敗案例；只補文件則使用適用替代驗證，不造 RED。
5. checker 對固定版本獨立驗收；有缺陷就回原 writer 修正並重驗，沒有缺陷就記同版 no_change。
6. 正式承接者核對原矩陣與完整證據後回寫原 task；未跑條件保留 not_run／unknown，不以聊天說「完成」代替。

## 給 AI Agent：從零建制到完成

| 步驟 | 輸入與操作 | 產物／驗收 | 失敗去向 |
| --- | --- | --- | --- |
| 1 定位工作 | 原需求、相關 tasks、四維 scope 比較；沿既有 lifecycle 決定 reuse／amend／replace／genuinely_new | 唯一 work anchor、原 home、核准與可判定矩陣 | 沒有正式承接／有效具名 bootstrap，回原決策者提案 |
| 2 固定執行契約 | 讀原規格及來源版本，填 scope、writer、checker、產物與失敗去向 | 下一位不用聊天補關鍵決策；不得另造平行矩陣 | 缺步驟回規格 owner，未知 ownership 停該檔 |
| 3 開工檢查 | 跑下方既有 preflight；依原規則核 HC、Repo Ready 與 ownership | allow 且授權／來源／矩陣仍有效；allow 不代表新增批准 | blocked 回原 gate 的 next step，不繞過或擴 scope |
| 4 操作或實作 | 使用既有能力留操作證據；改行為做 RED→最小修正→GREEN／回歸；純文件做來源與接手驗證 | 原需求、diff 與實測對應；未變能力不用重建 | 失敗回實作 owner；不得刪測試、降 expected |
| 5 文件接上 | 功能／規則 diff 對應章節與 owner，更新或有證據 no-impact | 本文、版本、來源 review 與生成結果一致 | 有變更無處置則文件未就緒；回文件 owner |
| 6 獨立驗收 | checker 讀固定輸入、原 IDs、實際產物，重現正反例 | pass／fail／not_run／unknown 分開；receipt 可回查 producer | 缺實證不送 all-pass；修正後重驗受影響範圍 |
| 7 承接與退出 | 依 task-write map 回原證據位置，記剩餘條件與 first unmet step | 正式接收有證據；本地 slice 不冒充全案 completed | 缺中央 writer 就交接等待，不搶寫；新需求回 Vincent |

既有開工命令如下；占位符先換成原核准的 project／task ID，不使用本文的文件編號：

```bash
node "$COLLAB/harness-mc/scripts/work-anchor-preflight.mjs" \
  --project "<原 project ID>" --task-id "<原 task ID>" --intent "開始" --json
```

## 必要檔案與 ownership

| 檔案／用途 | Owner 與讀寫邊界 |
| --- | --- |
| `$COLLAB/harness-mc/milestones/morrowise/tasks.json` | 原 task／中央指定 writer；必讀，具批准 lifecycle 才可寫；UI 工作另回 harness-mc 原 task |
| `$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-task-lifecycle.md`、`$COLLAB/harness-mc/system-workflow/docs/task-write-command-map.md` | JV-40／JV-32；沿既有 semantic intake／writer 路由，不另建 task 系統 |
| `$COLLAB/notyet-harness/000_Agent/skills/vincent-superpowers/03-execution/SKILL.md`、`$COLLAB/notyet-harness/000_Agent/skills/review/SKILL.md` | 共享 skill owner；必讀不必改，實作／驗收的操作正本 |
| `$COLLAB/notyet-harness/000_Agent/skills/write-temporary-doc/references/closed-loop.md` | JV-51／方法 owner；修訂、no_change、blocked 及交接分流，本文不接管方法 |
| `$COLLAB/harness-mc/scripts/work-anchor-preflight.mjs`、`$COLLAB/harness-mc/scripts/validate-tasks.mjs` | 原 gate owner；核准修改 gate 才可寫，使用或寫指南不改 |
| `$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json` | JV-32；工作流狀態正本，generated read model 只能重建不能手改 |
| `$COLLAB/harness-mc/docs/morrowise/OPERATOR-GUIDE.md` | JV-36 指定 writer；本章唯一正文；原任務規格另沿各 task 的 exact path |

## 驗收不是看見 receipt 就算過

canonical task 已有 acceptance_matrix 時，從當前來源解析完整 ID 集合與 fingerprint，逐項實跑，再依 execution skill 呼叫 `--event acceptance`。
成功須同時有 top-level／event allow、current fingerprint 相符、exact_id_coverage、all_passed 及逐項實證。blocked 也可能帶 receipt。
有效具名 workbook 使用原 requirement binding／可信實跑 receipt，不強制套中央 acceptance event；原必要 runtime 條件不降低。
只有本地 slice 通過、全案尚有 R5／WEB／runtime 未跑時，只交階段證據，不把未跑填 pass／N/A，也不為拿收據擴做排除項。

## 修正、無修改與失敗

- X-01 修正：固定 finding／版本→最小修訂→原負例與回歸→checker 複核；不能事後改 expected 湊 pass。
- X-02 無修改：確實重讀且對標後，保留同版 hash、no_change 理由與證據；不製造空 diff。
- X-03 停止：來源改版、同檔未知 owner、兩輪相同 blocker 無改善或超出約定預算，停止受影響 slice，留下 first unmet step。
- X-04 負例：拿舊矩陣 hash、少一筆實測或只提供作者 pass；checker 應拒絕完整驗收。合法對照是版本一致且原必要項逐項有證據。

## 版本與維護

1. 文件 ID `operator-guide-execution`、目前 v0.4.0；X-01–X-04 只作章內引用，不是新 task 或新驗收正本。
2. execution／review／lifecycle／閉環方法更新時，由變更作者提出本章更新或 no-impact；具名 reviewer 查原 diff 與版本，不只換 hash。
3. 正文 owner 更新版號與本節歷史，原 JV-36 登記／生成 owner 重建受影響產物；正文驗收回 JV-36，能力實作證據回原 task。
4. JV-51 有本地閉環證據不等於 remote closeout；catalog 的 accepted 是治理路由，不代表外部 intake skill 已安裝。

## 版本歷史

### v0.4.0 — 2026-09-10｜同 repo 正文遷移與部署前接線

- 更新唯一正文定位與公開候選邊界；保留章節 ID、薄來源引用與所有歷史。


### v0.3.0 — 2026-09-08｜執行、驗收與回饋接成一輪

- 新增 Agent 七步與必要檔案；保留純文件、有效 workbook、no_change 與 blocked 的合法分支。
- 明訂原矩陣／producer／版本與階段證據邊界；沒有新增 task writer 或自動執行機制。
- 驗證引用回原 task；本章 local_only，不宣稱整案驗收完成。

<!-- chapter:end execution -->

<!-- chapter:start delivery -->
# 版本交付與接續：本機完成和送到遠端分開看

文件版本：**v0.6.0** · 更新日期：2026-09-14 · 狀態：公開候選（未部署）

> 文件識別碼：operator-guide-delivery；章節鍵：delivery
> 內容 owner：Vincent／JV-36；能力 owner：JV-32 與原交付 task
> 適用版本：worktree-commit v2.8、cc-push v2.3；local-c1-commit 已定案（2026-09-10）；不改 MW-GIT-AUTH-01 或原 done condition

## 這項能力能做什麼？

把已驗證成果整理成精確版本，知道本機完成了什麼、哪些尚待交付，以及中斷後從哪一步繼續。
「尚未 push」不會否定已符合本機 done condition 的 task completion；但 local commit 也不能證明遠端、CI、部署或 runtime 成功。
本章教現有交付路由，不授權 staging、commit、push、merge、branch／worktree 或部署。

## 人如何操作？

1. 先確認原 done condition 要求的是本機完成、遠端交付，還是另有線上／runtime 驗收；不要臨時改完成定義。
2. Agent 讀完整 diff，列每筆 message、精確 files、verifier、4C，以及他方 dirty／staged 的保留方式。
3. Vincent 確認這份 exact plan 允許哪些 Git 動作；只有 commit 的授權不等於 push 或部署。
4. 執行者按核准方案逐筆處理，共用 Git 寫入區仍單一 owner；每筆用實際 commit object 核對，不靠工作區印象。
5. 本機驗收與正式 completion evidence 齊全時，回原 task 記本機完成；未核准 push 則獨立記 pending_push。
6. 已核准完整 delivery 時，協調者沿同一 exact plan 繼續，不每一步重問相同許可；scope／版本／ownership 等不變量改變則停止。

## 兩條交付路徑

| 本次批准 | 路徑與可宣稱結果 |
| --- | --- |
| 本機完成／精確 commit，沒有 push | 原驗收→必要 review／C1→核准的 canonical local closeout→必要 C2；task_completed 與 pending_push 可以並存 |
| exact plan「確認完整交付」 | C1 commit→C1 正常 push→remote verification→task event／單 writer apply→必要 sync／generator／MC→C2 commit→C2 正常 push→只讀 Terminal Gate |

原 task 明定 live／runtime／部署驗收時，那些仍是原完成條件，不因本機／遠端分層而刪掉。完整 delivery 也不隱含新外部系統或網站部署授權。
已在核准工作本路由內時，commit 與本地不可變交接包受原可信 context 約束；中央未接收就保持等待，不搶寫中央。

## 給 AI Agent：從零建制到完成

| 步驟 | 輸入與操作 | 產物／驗收 | 失敗去向 |
| --- | --- | --- | --- |
| 1 定義交付 | 原 task、完成證據與 Vincent 選定的 local／remote 範圍 | exact plan 說清 destination、local completion、delivery 處置 | 缺決策回原 owner；不要自行開 isolation |
| 2 查版本與 ownership | 讀目前 branch／HEAD／diff／index；標出本 scope 與 baseline exclusions | 每檔 writer、版本與他方 staged 可核對 | 同檔 overlap／unknown 停該檔，保留原工作 |
| 3 分組與驗證 | 每筆完整 diff、message、4C、相關 verifier；按既有 skill 檢查 | 核准前提供 Context／Change／Cause／Check 具體內容，不只 PASS | 缺證據回作者補測；多目的 diff 拆分 |
| 4 執行獲准 Git | 只在本次 exact Git 動作批准成立後依原 skill／短鎖處理 exact paths | 實際 commit paths／diff／message 符合；他方 index 未變 | 鎖或版本衝突停；不 stash／reset／rebase／force |
| 5 本機承接 | 原 verifier、review、completion evidence 與必要 task event | 指定 writer 接入 canonical；必要生成在 C2 前，無 scope-owned 本機殘留 | event_pending 不當完成；交中央 owner 接收 |
| 6 可選遠端交付 | 只有原批准含 delivery 才跑正常 push、remote／CI／必要 live 檢查 | exact SHA／映射、遠端證據及相應 terminal 結果 | 分歧／新人工決策停，不借舊批准吸收變更 |
| 7 退出或完成 | 分列本機與 delivery 狀態、immutable evidence、first unmet step | 下一位可從各自未滿足 gate 接續，無重複 commit 或 hash 回填鏈 | 缺收據先核實原 commit，不能盲目重提 |

可先使用唯讀 Git 檢查確認目標；這不是 fetch／push 的批准：

```bash
git -C "$COLLAB/harness-mc" status --short --branch
git -C "$COLLAB/harness-mc" diff --stat
git -C "$COLLAB/harness-mc" diff --cached --stat
```

實際 staging／commit／push 命令與鎖程序依當前 worktree-commit／cc-push；不在本章複製成另一份 Git 政策。

## GitHub PR 的 CI 與正式 Review（小範圍試行）

狀態：導入中；修復 PR #1 已合併，唯讀 secret 名稱已核對。首次 CI 執行與合併證據以本次 CI PR 為準，未成功前不得標為啟用完成。

- **入口與範圍**：`$COLLAB/harness-mc/.github/workflows/required-publish-flow.yml`。同 repo、目標為 main 且改動此 workflow、`scripts/verify-required-publish-flow.mjs` 或 `scripts/collab-root.mjs` 的 PR 會觸發；人工入口是 Actions → Required publish flow → Run workflow，須先將設定交付到預設分支。只跑發布守門 verifier（內含 Adapter 測試），不跑整站 prebuild，也不執行發布。
- **前置**：修復後的 verifier 需在受測版本中；共享 `hisenzi/notyet-harness` 固定為 workflow 的 `NOTYET_REF`。Vincent 在 harness-mc 的 Settings → Secrets and variables → Actions 設定 `NOTYET_HARNESS_READ_TOKEN`，僅授予指定共享 repo 的 Contents read 權限。token 值只放 GitHub secret，不貼聊天或文件。此試行只接受同 repo PR；fork、缺少憑證、checkout 失敗均拒絕，不略過測試當成功。
- **最小操作與預期**：依原核准範圍 commit／push PR 分支後，在 PR Checks 打開該 run；或在設定進 main 後人工 Run workflow。確認輸出列出實際受測程式 SHA、共享 SHA，以及成功的 verifier 和完整 job 結果。修改共享來源不會自動更新固定版本；需要時審查並更新 `NOTYET_REF` 再重跑，不能拿固定版本結果冒充最新共享來源健康。
- **正式 Review**：在 PR 的 Files changed → Review changes 提交 Comment／Approve／Request changes，或使用 `gh pr review`；記受審 SHA、方法、結果與限制。若作者和審查 Agent 共用同一個 GitHub 帳號，Comment 是可追溯的審查紀錄，但不是另一帳號的 Approve；本機驗收也不等於 CI 通過。
- **失敗與恢復**：看第一個失敗步驟；憑證缺失／到期回 Vincent 更新，來源版本錯誤回原 writer，規則或 Adapter 測試失敗回功能 owner。修正後才重新執行，不反覆空跑。Cancel workflow 停止單次 run；停用整個試行須依原授權選 Disable workflow，保留歷史證據與人工 Review 途徑。
- **完成與交接**：首次真實 run 的 URL、兩個來源 SHA、結果與必要反例證據回原工作 Issue／PR；指引與必要薄連結及生成版本同步後才算收尾。只更新本機檔案、設定 secret 或留下 Review 都不算 CI 已啟用。首次完成回報附文件證據與提醒次數，未完成的前置不記成零提醒成功。

CI 通過不授權 merge 或部署；目前不啟用 required checks。Git branch、commit、push、PR 與 merge 仍沿原具體批准。本試行不要求每個專案套用，也不擴入原單檔 verifier 修復 PR。

## 本機階段 commit（local-c1-commit）

已驗收的單一 task scope，可用 `local-c1-commit` 建立精確的本機 commit receipt。這是 `worktree-commit` 的 `--local-commit` 入口，不是一般 commit 的替代品。

### 使用條件

- 該 task 的精確 scope、ownership 與 4C 檢查已完成。
- 指定 verifier 已通過，且結果可重跑。
- 不得把他方 staged、untracked 或中央 registry 的變更納入同一 C1。

### CLI 操作

```bash
node "$COLLAB/harness-mc/scripts/repo-coordination-runtime.mjs" local-c1-commit \
  --repo "$REPO" \
  --event "<stable-event-id>" \
  --project "<project-id>" \
  --task "<task-id>" \
  --session "<session-id>" \
  --actor "<actor>" \
  --message "<approved conventional-commit message>" \
  --scope-path "<exact-owned-path>" \
  --verifier-id "<verifier-id>" \
  --verifier-command "<command>" \
  --verifier-arg "<argument>"
```

`--scope-path` 只接受本 task ownership 內的精確路徑，可多次指定。runtime 在 `git add → commit → receipt` 短區段取得 repo-local lock，完成後立即釋放。commit 使用 `git commit --only -- <scopePaths>`，確保他方已 staged 檔案不被吸收（LC-02 防護）。

### receipt 內容

receipt 附在本機 `refs/notes/jv37-local-c1`，必含：event、project、task、session、actor、base SHA、C1 SHA、精確 paths、verifier 結果、時間戳，狀態為 `committed_local` 且 `pending_delivery=true`。

### `local_commit_pending_push` 生命週期

```text
本機 task completion：local verification → local review/commit → canonical task_completed
遠端 delivery：      pending_push → pushed → remote_verified
```

- **task_completed**：已滿足 task 的 done condition，且本機驗收、完整 verifier 與 completion evidence 可重跑。對本機完成的 task，這就是完成。
- **pending_push**：只表示尚未依 Vincent 的批次授權交付到遠端；不是功能缺口，也不得把 completed task 降回 in_progress。
- **remote_verified**：只允許宣稱「已交付／已上線」時使用。

兩者是獨立狀態，不可互相冒充。task 標完成不需要先 push；delivery 標 pending 不否定 task completion。

### 查詢待交付項目

```bash
node "$COLLAB/harness-mc/scripts/repo-coordination-runtime.mjs" local-c1-pending --repo "$REPO"
```

此模式禁止自行 `fetch`、`push`、remote comparison、C2 或 task event apply。

## 必要檔案與 ownership

| 檔案／用途 | Owner 與讀寫邊界 |
| --- | --- |
| `$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md` | 共享 Git 政策 owner；必讀，明定 local completion／4C／短鎖／exact-path commit，本次交付不改 skill |
| `$COLLAB/notyet-harness/000_Agent/skills/cc-push/SKILL.md` | 共享 Git 政策 owner；批准 push 才適用，不用它推定 commit 授權 |
| `$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json#closeout-commit-routing` | JV-32；完整 delivery 路由正本，不能套成所有 task 都須先 push |
| `$COLLAB/harness-mc/system-workflow/docs/task-write-command-map.md` | JV-40／JV-32；跨 repo event 與正式 writer 入口，依批准條件讀取沿用 |
| `$COLLAB/harness-mc/scripts/task-event-outbox.mjs`、`$COLLAB/harness-mc/scripts/apply-task-events.mjs` | 原正式 writer；條件式本地 handoff／apply，只有接收權完整才執行 |
| `$COLLAB/harness-mc/milestones/morrowise/tasks.json` | 原 task／中央 writer；只改核准 task 的 completion／delivery 證據，不吸收他方變更 |
| `$COLLAB/harness-mc/docs/morrowise/OPERATOR-GUIDE.md` | JV-36 writer；本章正文；generated dashboard／bundle／網站只可由所屬工具重建 |

## 正反驗收與停止

- D-01 正例：本機必要條件已過、canonical 已承接、push 未批准；回報 task_completed／pending_push，不擅自 push，也不降回 in_progress。
- D-02 正例：已核准完整 exact plan，所有不變量仍成立；協調者從 first unmet state 續跑，不重問同一許可。
- D-03 負例：base 前進且碰到同檔、diff／message／grouping／verifier 或 ownership 改變；停止並更新 plan。不同 hunk 也算 overlap。
- D-04 負例：本地 commit 成功或 push 回傳成功，但缺 target ancestry／適用 CI、部署或 runtime 實證；不能稱 remote_verified／已上線。

## 版本與維護

1. 文件 ID `operator-guide-delivery`、目前 v0.6.0；D-01–D-04 是本章維護／情境引用，不另配 task 編號。
2. worktree-commit、cc-push 或 closeout contract 改動時，作者核對兩條路由、授權與 first unmet state；具名 reviewer 查實際 diff，記更新／no-impact。
3. 新版本正文與歷史一起更新；指南證據回 JV-36，實際 Git／交付證據回原 task。本文不存其他專案的 commit 清單或 runtime 私人資料。


### 夜間批次交付的範圍與隔離原則

多個 session 或多個 task 於日間完成本機 C1 後，夜間由 Vincent 集中呼叫 `cc-push` 或批次交付流程進行推送。

#### 1. 逐 repo 審查與阻擋隔離
每個 repo 先核准並審查連續的 `origin/main..HEAD` commit chain、audited tip、逐筆 owner 與 exact scope。
- **隔離原則**：若某單一 repo 出現未知／未核准的 interleaved commit、衝突或 lock 阻擋（`needs_push` 但非 clean ready），該 repo 立即被**單獨隔離並阻擋（Blocked）**。
- **其餘暢通**：其他審查通過且狀態為 ready 的 repos 繼續正常執行 push，不受被阻擋 repo 拖累。

#### 2. LC-02 外層暫存區防吸收機制
在執行任何交付前，必須確保本機 C1 提交已嚴格依 `--scope-path` 限制範圍。任何外部工作區檔案（foreign staged 或 untracked）均不得被當前 task 的 commit 吸收或覆蓋，維持工作樹乾淨隔離。

#### 3. 批次交付報告格式
批次推送完成後，必須產出結構化之逐 repo 狀態報告，清晰呈現哪些已送出、哪些被阻擋：

```text
[Batch Delivery Report] 2026-09-10 23:00
- notyet-harness: PUSHED (main: abc1234..def5678, 2 commits)
- harness-mc:     BLOCKED (reason: unapproved commit by external session, local tip: 7890abc)
- hisenzi-site:   SKIPPED (clean, no pending commits)
```

C2 只依原 task 的必要 closeout 契約，不因批次而自造；本地完成與遠端驗證分開。完整命令與規則薄連結回原 `cc-push`，不在本文重建政策。

## 版本歷史

### v0.6.0 — 2026-09-14｜小範圍 CI 與正式 Review 指引草稿

- 補必要測試、固定共享依賴、最小權限、PR 操作及故障恢復入口；明示尚未遠端啟用。
- 保留本機驗收、GitHub CI、正式 Review、merge 與文件收尾的個別證據邊界。

### v0.5.0 — 2026-09-10｜local-c1 準入與夜間批次交付隔離

- 補入 `--local-commit` CLI 參數規格與 `local_commit_pending_push` 生命週期。
- 明確批次交付時單一 repo blocked 隔離原則、LC-02 外層暫存防吸收機制與結構化報告格式。
- 更新交付維護版本至 v0.5.0。


### v0.4.0 — 2026-09-10｜同 repo 正文遷移與部署前接線
- 更新唯一正文定位與公開候選邊界；保留章節 ID、薄來源引用與所有歷史。
- 接上 cc-push v2.3 的每 repo 批次範圍與 task-specific C2。


### v0.3.0 — 2026-09-08｜本機完成、遠端交付與中斷接續

- 依現行 v2.8／v2.2 skill 整理兩條路由、精確批准、必要檔案與正反例。
- 保留 local task completion 與 remote delivery 分離，以及完整 delivery 一次批准的條件。
- 本章沒有執行 Git 寫入、外部同步或部署；本地文件驗證不代替版本交付證據。

<!-- chapter:end delivery -->

<!-- chapter:start documentation -->
# 文件更新與同步：能力變了，說明書也要接上

文件版本：**v0.5.0** · 更新日期：2026-09-10 · 狀態：公開候選（未部署）

> 文件識別碼：operator-guide-documentation；章節鍵：documentation
> 內容／來源與生成 owner：Vincent／JV-36；網站 owner：MC-DOCS-01
> 適用版本：manual-local-v2 本地六章契約；薄連結 Marker 自動同步已整合；impact／changed-only 本地入口已實作，本輪完整驗收以原 task evidence 為準

## 這項能力能做什麼？

當功能、架構或協作規則微調，先判斷哪些操作說明會受影響，再更新唯一正文、來源審查與生成內容。
它不只是「Markdown 改了就重新發布」：**能力改了，文件完全沒動，也必須有人判斷是否合理。**
網站只讀已審查 bundle，不讓網站、Heptabase 或 generated human 頁面反過來修改政策、任務或正文。

來源逐字一致（source parity）不是只比 schema 或自填 hash：由當前唯一正文重新抽取各章、重建摘要，比對磁碟上的 bundle／human 產物；再讓頁面與搜尋讀取同一份已驗證正文。

## 人如何更新？

1. 變更作者提出實際能力 diff、受影響章節與 owner，不只列「改過哪些 Markdown」。
2. 對每個受影響文件選「需要更新」或有證據的 no-impact；後者須說明為何使用方式／契約沒有改變。
3. 指定單一 writer 修本檔對應章節、版號與歷史；independent reviewer 核對實際來源及語意，不只核 hash。
4. JV-36 writer 更新既有 document-source registry 的來源／review metadata，通過 gate 後生成本地 bundle 與六摘要頁。
5. MC-DOCS-01 核對本地網站正文、導航、搜尋、來源 banner 與版本歷史同版，回原 task 留證據。
6. 要上網時再確認 GitHub repo／branch、Zeabur service／URL、可見性及發布權限，取得版本綁定 live 證據；本地通過不自動發布。

## 唯一正文到網站的路徑

```text
canonical capability／規則／程式差異
  → 受影響 chapter／owner＋更新或有證據 no-impact
  → OPERATOR-GUIDE.md 唯一人工正文＋既有 registry 審查
  → 同一 bundle＋六頁生成摘要
  → Fumadocs 本地正文／導航／搜尋
  → 原 task 的版本綁定驗收；另核准才進 GitHub → Zeabur
```

本版六章固定 entry、collaboration、execution、delivery、documentation、troubleshooting。
六摘要為 README、01-entry、02-rules、03-capabilities、04-runtime、05-governance；網站路由依序為 `/docs`、`/docs/entry`、`/docs/rules`、`/docs/capabilities`、`/docs/runtime`、`/docs/governance`。
操作章路由為 `/docs/capabilities/<chapter-id>`。沒有已審查正文的能力，不新增假連結或標成可用。

## 給 AI Agent：從零建制到完成

| 步驟 | 輸入與操作 | 產物／驗收 | 失敗去向 |
| --- | --- | --- | --- |
| 1 確認承接 | 原能力 task／diff、JV-36 與網站 task 的 scope／授權，固定本版 corpus | 精確 paths、正文／registry／surface writers、checker 及原 IDs | 超出六章或涉及發布先回原 owner／Vincent |
| 2 定位影響 | 讀既有 capability→source→chapter mapping，核對來源版本與 Git diff | 逐文件 update_required 或有證據 no-impact、reviewer 與版本綁定 | 未知 mapping／缺 owner／失效來源阻擋文件就緒 |
| 3 修唯一正文 | 調整受影響章的操作、Agent 步驟、檔案地圖、版本與歷史 | 正文能獨立接手，必要 code／link 語意不丟失 | 同檔未交還停寫；政策矛盾回政策 owner |
| 4 審查與生成 | reviewer 查語意；指定 writer 更新 review metadata 後跑適用生成 | 同輸入 deterministic；只改受影響本地 targets，失敗保留最後好版本 | 不為消 drift 只換 hash；錯誤回來源／生成 owner |
| 5 預覽與對版 | 來源／sync verifier、本地 build 與 loopback browser | 六章／六摘要 coverage、banner／導航／搜尋／toggle 同版 | source drift、錯頁或快取回原 owner，不停用 gate |
| 6 獨立驗收 | 固定正反輸入，checker 查能力改而文件漏改的拒絕及合法對照 | 原 IDs 有版本／producer／結果；文字與機械檢查各自有實證 | 缺實證保留 not_run，不拿作者 pass 冒充獨立結果 |
| 7 回原處 | JV-36 接來源／impact／sync；MC-DOCS-01 接頁面／互動 | 原 evidence refs 可追溯，本地與 WEB／Zeabur 分別記錄 | 缺正式接收留交接；未核准不做外部發布 |

## 必要檔案與 ownership

| 檔案／用途 | Owner 與讀寫邊界 |
| --- | --- |
| `$COLLAB/harness-mc/docs/morrowise/OPERATOR-GUIDE.md` | JV-36 指定單 writer；六章唯一人工正文，本次核准章節才可寫 |
| `$COLLAB/harness-mc/system-workflow/registries/morrowise-document-sources.json` | JV-36 指定 writer；來源、chapter mapping、visibility、review 與生成責任正本 |
| `$COLLAB/harness-mc/system-workflow/schemas/morrowise-document-source.schema.json`、`$COLLAB/harness-mc/scripts/generate-morrowise-documentation.mjs` | JV-36；只有核准生成契約修改才改，日常正文維護只讀沿用 |
| `$COLLAB/harness-mc/scripts/verify-morrowise-document-sources.mjs`、`$COLLAB/harness-mc/scripts/verify-morrowise-docs-surface.mjs` | JV-36／MC-DOCS-01；來源與呈現驗證入口，測試通過不等於 live 上線 |
| `$COLLAB/harness-mc/scripts/lib/morrowise-documentation-impact.mjs`、`$COLLAB/harness-mc/scripts/verify-morrowise-documentation-impact.mjs`、`$COLLAB/harness-mc/scripts/verify-morrowise-documentation-sync.mjs` | 本版新增的本地入口已實作；JV-36 writer 負責，完整驗收看原 task evidence，不假裝舊版已有這些 gate |
| `$COLLAB/harness-mc/app/docs/[[...slug]]/page.local.tsx`、`$COLLAB/harness-mc/app/docs/version-history.mjs`、`$COLLAB/harness-mc/lib/morrowise-docs-source.ts` | MC-DOCS-01；只有呈現契約受影響才改，不在 UI 另存正文 |
| `$COLLAB/harness-mc/.tmp/morrowise-docs/bundle.json`、`$COLLAB/harness-mc/.tmp/morrowise-docs/human/`、`$COLLAB/harness-mc/.tmp/morrowise-docs/site/` | generated-only；human/ 下固定 README.md、01-entry.md、02-rules.md、03-capabilities.md、04-runtime.md、05-governance.md；不寫 shared human/ 或 public/out |
| `$COLLAB/notyet-harness/100_Todo/plan/2026-09-05-heptabase-morrowise-manual-sync-spec.md` | 本案規格 owner；只改核准範圍，原 task／規格不是第二份操作正文 |
| `$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md` | Vincent／共享治理；架構導覽地圖正本，內部 Marker 區塊由腳本維護，嚴禁手寫長篇程式碼 |
| `$COLLAB/notyet-harness/000_Agent/skills/SKILLS-INDEX.md` | 共享治理；52 skills 薄索引正本，技能清單 Marker 區塊由腳本自動同步 |
| `$COLLAB/harness-mc/system-workflow/registries/morrowise-architecture-subsystems.json` | JV-29；子系統 Admission Record 正本，唯有通過審查方可標 promoted |

## 本地影響審查記錄

資料只放在既有 document-source registry；以下是本版機械接線契約，不另建追蹤器。命令與驗收邊界見下一節。

| 既有 registry 內欄位 | 必填內容與責任 |
| --- | --- |
| `capability_mappings[]` | 原 mapping `id`、精確 `source_refs[{path,fingerprint}]`、以 record ID 對應章節 SHA 的 `document_fingerprints`；由 JV-36 writer 維護，不能以目錄／萬用字元替代 |
| `impact_reviews[]` | `mapping_id`、當前 `source_fingerprints`、當前 `document_fingerprints`、`decision`、`reason`、`evidence_refs`、`author`、獨立 `reviewer`、`reviewed_at`；作者提供差異，reviewer 查語意後才由 writer 寫入 |

`decision` 只選 `no_impact` 或 `update_required`；後者要求對應章節確有變更。理由／證據不是任意非空字串即可，reviewer 必須能依其回查實際變更。
先保留原 mapping 基線，再對當前 source／章節產生 review；不能先把 baseline hash 換成新值以消除需要審查的差異。
reviewer 不得等同 author；來源或正文再改，原 review 的指紋綁定失效，重審受影響項。機械 gate 驗欄位與版本，語意是否真無影響仍由獨立 reviewer 負責。

v2 首次尚未 commit 的 mapping，須由獨立 reviewer 核實初始來源、章節與版本基準；之後 production 以已 commit registry 中最近一次有效 review 的來源／章節指紋為 baseline，沒有既有 review 才使用初始 mapping。不能刷新 fingerprints 掩蓋漏更新，也不能在能力第二次變更時，沿用上次正文卻宣稱本次已更新。讀取 Git 現況只提供差異證據，不代表已 merge、啟用或取得 Git 寫入授權。

## 本地命令與驗收邊界

下列本地入口已實作；先完成來源／reviewer 審查，再按順序檢查與生成。本輪完整驗收結果仍以原 JV-36／MC-DOCS-01 evidence 為準，寫出命令不等於所有驗收已通過：

```bash
npm --prefix "$COLLAB/harness-mc" run test:morrowise-documentation-impact
npm --prefix "$COLLAB/harness-mc" run sync:morrowise-docs -- --changed-only
npm --prefix "$COLLAB/harness-mc" run docs:check
npm --prefix "$COLLAB/harness-mc" run test:morrowise-documentation-sync
npm --prefix "$COLLAB/harness-mc" run test:morrowise-documentation
npm --prefix "$COLLAB/harness-mc" run docs:build:local
```

命令作用不同，不把 fixture 測試與當前來源 gate 混為一談：

- `test:morrowise-documentation-impact`：對當前來源跑唯讀 impact gate；追加 `-- --self-test` 只跑 fixture，不證明當前正文／來源就緒。
- `sync:morrowise-docs -- --changed-only`：本地寫入受影響的 bundle／human targets，不改 canonical 正文；相同輸入不作無謂改寫。
- `test:morrowise-documentation-sync`：對當前 source 跑 impact、在記憶體重建 expected，再唯讀比對磁碟上的 bundle＋六個 human 產物；成功應為 `synced=true`、`save_count=0`、`checked=7`。它不是 fixture suite，也不啟動網站。
- changed-only、無變更二跑與失敗回復的 fixture 位於 `verify-morrowise-document-sources.mjs`，由 `test:morrowise-documentation` 聚合執行；fixture 不代替使用者實際網站驗收。
- 首次建立或必要的完整本地重建，可用 `npm --prefix "$COLLAB/harness-mc" run docs:generate`；`--local`、`--check`、changed-only 與 consumer 讀 bundle 都不能略過 impact gate。

任一 gate 失敗就停相關生成／呈現，回 source／review／generator owner；不使用忽略未知旗標的舊入口、也不停用 gate。部署未批准時止於本地產物，不能把這組命令當發布流程。

## 系統優化與架構薄連結同步（Marker-based Sync）

當 MorroWise 子系統完成能力優化、修復或新增時，除了更新操作正文與 Fumadocs 網站之外，還必須同步控制平面之架構導覽地圖（`ARCHITECTURE.md`）與技能索引（`SKILLS-INDEX.md`）。

### 1. 「地圖不是倉庫」（Map is not a warehouse）原則
`ARCHITECTURE.md` 是導向正本的「薄索引地圖」，絕不是實作細節的倉庫。
- 嚴禁在 `ARCHITECTURE.md` 手寫詳細程式碼、長篇 SOP 或第二份 task 清單。
- 架構文件的動態區塊必須由機械化腳本讀取正本 registry 自動填入標記區塊，人工只維護大綱與非動態說明。

### 2. 核心 Marker 標記區塊三件組
系統透過專屬 Marker 註解實現非破壞性的局部自動同步：
1. **技能清單**：`$COLLAB/notyet-harness/000_Agent/skills/SKILLS-INDEX.md`
   - 標記：`<!-- marker:skills-list:start -->` ... `<!-- marker:skills-list:end -->`
   - 維護腳本：`python3 000_Agent/scripts/update-skills-index.py`
2. **架構子系統清單**：`$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md`
   - 標記：`<!-- marker:architecture-subsystems:start -->` ... `<!-- marker:architecture-subsystems:end -->`
   - 維護腳本：`python3 000_Agent/scripts/sync-architecture-subsystems.py`
   - 資料正本：`$COLLAB/harness-mc/system-workflow/registries/morrowise-architecture-subsystems.json`
3. **架構當前狀態與拓撲 Inbox**：`$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md`
   - 標記：`<!-- marker:architecture-current-state:start -->` ... `<!-- marker:architecture-current-state:end -->`
   - 維護腳本：`python3 000_Agent/scripts/sync-architecture-current-state.py`

### 3. 四組必備防漂移檢驗指令（--check）
完成同步後，或於提交前，必須依序執行下列唯讀檢驗，確保無未提交漂移：

```bash
# 1. 檢驗子系統標記區塊是否同版
python3 "$COLLAB/notyet-harness/000_Agent/scripts/sync-architecture-subsystems.py" --check

# 2. 檢驗當前狀態標記區塊是否同版
python3 "$COLLAB/notyet-harness/000_Agent/scripts/sync-architecture-current-state.py" --check

# 3. 檢驗技能索引清單是否同版
python3 "$COLLAB/notyet-harness/000_Agent/scripts/update-skills-index.py" --check

# 4. 系統脈搏綜合健康檢查
npm --prefix "$COLLAB/harness-mc" run test:system-pulse
```

任一指令回傳非 0（Drift detected）即代表投影與正本不同版，禁止進行 Git 提交。

### 4. 優化收尾六步閉環（Closeout Seam）
子系統優化或 bug 修復完成後，Agent 必須執行標準六步收尾：

功能驗收後，Agent 須自行判斷說明書影響，完成必要正文、薄連結及對應驗證；無影響須附理由。未處理前不得回報整體收尾完成。依本章[既有文件更新流程](#文件更新與同步能力變了說明書也要接上)辦理。

| 步驟 | 動作對象 | 工具／指令 | 產物與預期 |
|---|---|---|---|
| **Step 1: 功能驗收** | 實作檔案與測試腳本 | `node scripts/verify-<name>.mjs` | 功能驗收通過，確認改動無 regression。 |
| **Step 2: Admission 審核** | Architecture Registry | `morrowise-architecture-subsystems.json` | 若為 `promoted` 或既有 entry 邊界變更，更新其 Admission Record。 |
| **Step 3: 標記區塊同步** | Markdown 人讀入口 | `sync-architecture-subsystems.py`<br>`update-skills-index.py` | 自動更新 `ARCHITECTURE.md` 與 `SKILLS-INDEX.md` 的 Marker 區塊。 |
| **Step 4: 防漂移檢驗** | 4 組 `--check` 指令 | 上述四組 `--check` 命令 | 全部通過（exit code 0），確認 100% 同步。 |
| **Step 5: Task 結案** | MC Task 正本 | `milestones/morrowise/tasks.json` | 填入 `status: completed`、`completed_at`、verifier 結果與 C1 SHA。 |
| **Step 6: 本機 C1 提交** | Git 寫入區 | `local-c1-commit` | 建立本機 C1 receipt，delivery 維持 `pending_push`，等晚間集中 push。 |

## 本地預覽與發布邊界

同一 harness-mc repo 的唯一正文經 registry／impact 審查，產生公開候選 release；正式站為同一 origin 的 `/`（MC）與 `/docs`（說明書）。本地 3001 保留開發用途；既有 Pages 在正式切換驗收前保留。公開方向已核准，不等於本機候選已部署。

本地 bundle／site 留在 `.tmp/morrowise-docs`；受版本控制的 `release/morrowise-docs/manifest.json`／`bundle.json` 只由原生成工具產生，不手改正文。公開建置從同 repo 的固定輸入重建並比對，不能依賴 sibling checkout 或以預覽旗標绕過保護。候選無 source commit，只能作明確標記的本地驗收；部署前另核准 Git、固定來源版本並重驗。

新增公開模式的命令與發布操作見同 repo `docs/morrowise/DEPLOYMENT.md`；該文件是操作入口，正文身份仍由原 registry 管理。缺包／錯 hash／來源改版／review 過期必拒絕；本地／公開交替建置不得覆寫其他輸出。雲端只能證明已審查的固定發布版本，不能假稱即時檢查本機共享來源。

build 不會開服務。先確認既有本案 loopback preview；沒有時，才用已安裝依賴啟動自己的服務：

```bash
npm --prefix "$COLLAB/harness-mc" run dev -- --hostname 127.0.0.1 --port 3001
```

從 `http://127.0.0.1:3001/docs` 開始，核對各章的 source／version banner；3001 已占用時先核 owner，不殺他人程序。核准改空閒 loopback port 後記實際 URL；結束在自己的終端按 Ctrl+C。
重新生成後若 preview 快取舊 bundle，只重啟自己的服務再核版本，不停用來源檢查。dev 與 static build 各自留證據。
六章須在原 `public_allowlist` 逐項登記並綁定本版公開審查；公開包、Git 待提交內容、索引與資產全部受檢。未固定服務／release owner 或未做 artifact scan，不得部署。需要本地正本的 `$COLLAB` 標籤不是可點擊的公開網址；讀者需已具備本地協作環境與原權限。
Heptabase adapter 仍為 prototype；MANUAL 是另一薄入口，不能要求它與網站全文相同。本章不包含 live apply、MANUAL 遷移或 R5 排程。

## 驗收與維護編號

- M-01 負例：能力可觀察行為變了，受影響章未更新且無有效 no-impact；文件就緒與相關生成／發布應拒絕。
- M-02 正例：純內部重構，不影響操作契約；逐文件理由、來源版本與獨立 reviewer 證據完整，可保留正文不變。
- M-03 正例：能力、正文、版本與 review 同步更新；生成後正文／導航／搜尋同版，第二次同輸入無不必要改寫。
- M-04 負例：缺／重複／巢狀 chapter marker、版本與首筆歷史不符、未知來源或錯 hash；不得發布半套產物。
- M-05 回復：依本次 exact diff／最後已驗證本地產物處理；遇他方同檔變更先交接，不整檔覆寫或刪除人工內容。

## 版本與維護

1. 文件 ID `operator-guide-documentation`、目前 v0.5.0；M-01–M-05 是章內引用，實測仍沿原 DOC／WEB／JV36 IDs。
2. 變更作者記 affected chapter、來源 diff、更新／no-impact、reviewer 與證據；generator 只能核證據完整及版本綁定，不替代 reviewer 判斷語意。
3. 正文、章內維護版號、首筆歷史與 registry／bundle metadata 同版；runtime 啟用、Main SHA、部署 ID／URL 各自記錄，不從 v0.4.0 推定。
4. 本地成果回原 JV-36／MC-DOCS-01；WEB／GitHub／Zeabur 未實跑就保留未完成，不為文件補漏擴做發布。

## 版本歷史

### v0.5.0 — 2026-09-10｜架構薄連結標記同步與優化收尾閉環

- 增補「系統優化與架構薄連結同步」專節，落實「地圖不是倉庫」原則。
- 規範三大 Marker 標記區塊、四組 `--check` 防漂移檢驗指令及優化收尾六步閉環。
- 更新文檔維護版本至 v0.5.0。


### v0.4.0 — 2026-09-10｜同 repo 正文遷移與部署前接線

- 更新唯一正文定位與公開候選邊界；保留章節 ID、薄來源引用與所有歷史。
- 區分本地 impact、固定公開發布版本與尚未執行的部署。


### v0.3.1 — 2026-09-09｜澄清公開與本地建置邊界

- 對齊本地路由檔名、公開／本地輸出位置、交替建置及失敗證據保留規則。
- 保留來源指紋、版本與 local-only gate；本版沒有核准公開說明書或部署。

### v0.3.0 — 2026-09-08｜能力變更接說明書與本地投影

- 固定六章／六摘要、唯一正文、影響審查、檔案 ownership、版本與安全發布邊界。
- 新 impact／changed-only 本地入口已實作；納入初始獨立基準審查與後續 committed registry baseline，完整驗收以原 task evidence 為準。
- 本版只做核准本地切片；R5、MANUAL 遷移、Heptabase 修復與外部部署排除。

<!-- chapter:end documentation -->

<!-- chapter:start troubleshooting -->
# 故障處理與交接：先找斷點，再做可驗證的修正

文件版本：**v0.4.0** · 更新日期：2026-09-10 · 狀態：公開候選（未部署）

> 文件識別碼：operator-guide-troubleshooting；章節鍵：troubleshooting
> 內容 owner：Vincent／JV-36；診斷路由 owner：JV-32，實際修復回原能力 task
> 適用版本：canonical diagnosing-bugs 路由、systematic-debugging 四階段與 CLM-1；不是新自動修復服務

## 這項能力能做什麼？

遇到錯誤、驗收紅燈、來源漂移或交接失敗時，除錯（debugging）先分清是資料、文件、程式、權限還是 ownership 問題。
目標是找到可重現的斷點、最小修正與可接續證據，不是把所有紅燈一次清空。診斷請求本身不授權實作修復。
它適合既有任務的異常處理；不包含讀憑證、重新登入、安裝工具、清他人 dirty 或自動部署回退。

## 人如何處理？

1. 記「在哪一步、預期什麼、實際看到什麼」、來源／產物版本及安全錯誤摘要，不貼秘密或完整 raw log。
2. 告知原 task owner，讓 Agent 先唯讀找出斷點與可重現方法；無法重現時記 unknown，不猜修法。
3. 對照相同環境的合法案例，只改一個假設／變因；診斷與實作授權分開，必要實驗也守原 scope。
4. 有實作授權後，先建立失敗案例再做最小修正，跑原負例與受影響回歸；不順手重構無關系統。
5. 由獨立 checker 核對來源、修前／修後及原成功標準；如需改規格或政策，回對應 owner，不降標準。
6. 修好、無需改動或 blocked 都回原落點，留下 evidence、ownership 與下一個未滿足步驟。

## 先把問題送對地方

| 看到的症狀 | 先查什麼／owner | 停止點 |
| --- | --- | --- |
| 文件正文舊、hash／版本不合 | 唯一正文→review metadata→bundle→preview；JV-36／MC-DOCS-01 | 不只換 hash、手改 bundle 或停用 gate |
| task gate blocked、matrix／receipt 不合 | 當前原 task、原 IDs、fingerprint、實跑結果；JV-40／原 task owner | receipt 存在不等於 allow，不自行補 pass |
| 同檔衝突、claim stale、鎖仍在 | 原 writer、交接與最新 diff；協調者／原 owner | 不用沉默或 TTL 接管，不刪他人鎖／工作 |
| 工具不存在、repo／網路權限不足 | 實際工具介面、能力 registry、當次批准；原能力 owner | 不換帳號、讀 auth 或安裝未知工具繞過 |
| 通知沒送達、scheduler 狀態過期 | 既有安全狀態／契約的 source、generated_at、next_action；原 runtime owner | 合約 ready／歷史某機成功不是本機現在 live；不自行試發通知 |

## 給 AI Agent：從零建制到完成

| 步驟 | 輸入與操作 | 產物／驗收 | 失敗去向 |
| --- | --- | --- | --- |
| 1 固定故障 | 原 task、症狀、預期／實際、版本、scope 與允許讀取 | 可回查的去敏問題描述；修復是否核准清楚 | 缺資料只問最小缺口，不擴讀私人來源 |
| 2 重現與定位 | 完整讀相關錯誤，查來源／產物及最近 diff，沿鏈找第一個不符處 | 可重現命令或人工步驟、失敗層與證據 | 無法重現保持 unknown；缺權限停該層 |
| 3 比較合法對照 | 讀同契約正常案例，提出單一有證據假設 | 哪個輸入／版本差異能解釋症狀，不用猜測補丁 | 新證據否定假設就回定位，不疊加修法 |
| 4 核准後修正 | 原 owner 核准 exact 修復，建立 RED，再改最小根因 | GREEN、原負例與受影響回歸；純文件以對標／演練替代 | 問題是規格或政策就回其 owner，不改程式掩蓋 |
| 5 更新文件 | 行為／操作改變時修對應章，或提出有證據 no-impact | 文件版本／來源 review 與產品契約一致 | 能力改但說明漏改，文件仍未就緒 |
| 6 獨立核對 | checker 讀固定輸入與修前／修後證據，重現原失敗 | 實際問題消失且必要回歸未壞；未跑層明記 | 作者 pass 不代替獨立結果，失敗回 writer |
| 7 結果與接續 | 回原 task／home，記 disposition、版本、ownership、first unmet step | resolved／no_change／blocked 可區分，接手不必重猜 | 新需求／外部依賴／超時回原決策者 |

## 必要檔案與 ownership

| 檔案／用途 | Owner 與讀寫邊界 |
| --- | --- |
| `$COLLAB/notyet-harness/000_Agent/skills/systematic-debugging/SKILL.md` | 共享方法 owner；必讀四階段，診斷本身不改 skill |
| `$COLLAB/notyet-harness/000_Agent/skills/write-temporary-doc/references/closed-loop.md` | JV-51；修訂／no_change／blocked、有限迭代與正式交接正本 |
| `$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json#diagnosing-bugs` | JV-32；accepted 是診斷路由，不代表 external intake skill 已安裝 |
| `$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json` | 能力 registry owner；讀 status／entrypoint／boundary，不能由本次症狀自行提升全域狀態 |
| `$COLLAB/harness-mc/system-workflow/registries/morrowise-architecture-subsystems.json` | Architecture Admission owner；讀 promoted／degraded／detail refs，不掃目錄自封新能力 |
| `$COLLAB/harness-mc/system-workflow/registries/morrowise-notification-adapter-contract.json`、`$COLLAB/harness-mc/system-workflow/docs/morrowise/trusted-notifier.md` | 原 notification owner；僅在送達故障適用，讀安全契約，不讀 auth／目的地實值 |
| `$COLLAB/harness-mc/milestones/morrowise/tasks.json` | 原能力 task／中央 writer；診斷唯讀，回寫／修復依另外已具備的批准 |
| `$COLLAB/harness-mc/docs/morrowise/OPERATOR-GUIDE.md` | JV-36 指定 writer；本章及受影響操作章才可改；generated read model 只能由原工具重建 |

實際程式／測試檔案由原 task 的 source refs／verifier 定位，再加進核准 exact scope；不能把整個 scripts/ 或所有 test:* 當必改清單。
對本版文件漂移，可先跑既有不改生成產物的檢查；這不是修復命令：

```bash
npm --prefix "$COLLAB/harness-mc" run docs:check
```

其他驗證先讀原命令的作用：名稱是 test／check 不保證零寫入，有些測試建立 fixture，generator／pulse 可能重寫報告。未核對作用與權限前不為排錯跑全套。

## 正反驗收與回復

- T-01 正例：原錯誤能重現，最小修正後原負例與相關回歸通過；checker 能由證據說明修的是哪個根因。
- T-02 負例：把來源 hash 換成新值、關閉驗證或重跑直到碰巧綠；原需求未被證明，不算修好。
- T-03 合法無修改：問題來自已查明的來源／環境限制，本文無缺陷；保留相同正文 hash、no_change 理由、待解 owner 與 next action，不製造空 diff。
- T-04 回復：只回復本次核准 diff／產物；來源已被他方改動先交接，不整檔覆蓋、reset 或擅自回退線上部署。
- T-05 停止：本案依 CLM-1 的預算與最多兩輪針對性修訂；同 blocker 無改善、來源／ownership 變更或新人工決策需求即交接，不無限修補。

## 版本與維護

1. 文件 ID `operator-guide-troubleshooting`、目前 v0.4.0；T-01–T-05 是章內維護引用，結果仍回原 acceptance IDs。
2. 方法、失敗碼或安全邊界改變時，作者記受影響章節，具名 reviewer 對照來源版本審查更新／no-impact；不把未知診斷升格成正式規則。
3. 指南改版更新正文／歷史及 JV-36 metadata；bug fix 證據留原能力 task，環境／權限缺口留可逆下一步，不複製 raw logs。
4. 故障處理完成不自動觸發改 skill／記憶、新 task、Git、外部同步或部署；需要時回原決策者。

## 版本歷史

### v0.4.0 — 2026-09-10｜同 repo 正文遷移與部署前接線

- 更新唯一正文定位與公開候選邊界；保留章節 ID、薄來源引用與所有歷史。


### v0.3.0 — 2026-09-08｜故障分流、最小修正與安全接續

- 新增人讀處理步驟、Agent 七步、必要檔案與五類故障 owner／停止點。
- 沿用既有診斷與閉環方法，保留 no_change、unknown、blocked 與有限迭代，不新增自動修復 runtime。
- 本地指南與實際修復／送達證據分開，未執行任何 live、通知或外部回退。

<!-- chapter:end troubleshooting -->
