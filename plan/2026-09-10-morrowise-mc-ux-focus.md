# MorroWise／MC UX 重整：系統定位與聚焦暫稿

> 狀態：temporary / non-canonical；討論與規劃候選，尚非實作規格
> 文件版本：v0.1
> 建立／更新日期：2026-09-10（Asia/Taipei）
> 主要用途：規劃前聚焦；次要用途：保留本次診斷與接續脈絡
> 專案性質：軟體／系統 × UX 設計。改善對象同時包含資訊判斷、介面互動及說明書整合，因此不能只按首頁視覺改版處理。
> 讀者：Vincent 與接續本次討論的 Agent
> 決策者：Vincent；本輪文件 writer：Codex；後續長期維護者：待指定
> 位置：`$COLLAB/harness-mc/plan/2026-09-10-morrowise-mc-ux-focus.md`
> 本輪授權：依 Vincent 指定，在此位置新增一份臨時文件，然後繼續聚焦。

本文件整理本對話的問題、正式來源與設計候選。它不取代架構契約、tasks.json、registry、read model、操作指南或任何現行驗收條件；不維護第二份即時 task 進度。本輪沒有核准程式修改、正式 task／registry 變更、Loop 啟用、commit、push、部署或外部同步。

## 1. 起點與這次必須修正的方向

Vincent 指出 harness-mc 儀表板「雞肋、難用、很多雜訊」，並進一步指出目前 UX 本身也有問題，且說明書已整合，必須一起理解。要求用 HC 從 MorroWise 整套系統思考，不能每被提醒一個部分才補一個部分。

已確認的討論邊界：

- MorroWise 整體定位、Harness、Loop Engineering、MC、說明書要一起考慮。
- 先確認部分在整體裡的角色、資料與操作如何連動，再決定導覽、頁面和視覺。
- 系統與人機介面沿用同一正本；視覺投影不得成為新 owner 或平行任務系統。
- 架構視角具有理解與追查價值；日常操作還需要工作目標、運行狀態、成果、影響與介入路徑。
- 本文件先保存脈絡，再繼續聚焦；不因文件寫完就進入實作。

先前由 Agent 提出的「總覽、專案、說明書、系統」四入口已撤回：當時尚未完成系統關係與完整工作路徑的推導。它不是核准 IA，也不得作為後續預設。互動草圖在本對話中未製作。

## 2. MorroWise 的整體關係

### 2.1 身份、機制、政策、介面

| 層次 | 正式定位／責任 | UX 應使人理解的內容 |
| --- | --- | --- |
| MorroWise | 唯一的賈維斯／活系統 owner；統整感知、判斷、行動、回報與學習 | 整套系統在替什麼工作服務、如何持續往前 |
| Harness | 提供 context management、工具執行、sandbox／權限、狀態保存、觀測、錯誤恢復與重試機制 | 有哪些能力與限制、使用什麼上下文、依賴哪個環節 |
| Loop Engineering | 決定 trigger、objective、探索與優先級、執行角色、驗證、重試、記憶回寫、升級、停止條件及資源預算 | 為什麼啟動、目前做什麼、如何確認結果、何時要人介入或停止 |
| MC | 顯示／操作 MorroWise 正本所投影的狀態；介面不是系統 owner | 看懂運行、追查關係、取得證據、前往適當處理入口 |
| 說明書 | 由既有操作正文與受管來源產生的人讀入口 | 能力與循環如何使用、預期結果、驗收與故障處理 |

依現行 `morrowise-dev-workflow-catalog.md`：Harness 提供機制，Loop 決定政策；Loop 不得繞過 Harness 的 sandbox、權限、工具或 context 邊界。Loop 終態也不直接等於 canonical task 完成。

舊 Harness 雙層視角（能力層：記憶／工具；紀律層：規劃／評估）可以用來理解結構，但不能以四支柱卡片取代具體 Loop 的政策、執行與結果。細部控制權依現行 Harness／Loop 契約，不能由舊標籤自行推導。

### 2.2 結構、運作、操作理解是同一套系統的不同視角

- **結構視角**：能力、治理、上下文、正本、工具、依賴與責任邊界。
- **運作視角**：工作目的、觸發、當次運行、驗證、結果、卡點、下一步與回饋。
- **操作理解**：在上述物件／階段旁取得對應說明，亦可獨立閱讀完整指南。

設計候選是讓三者以同一工作情境互相定位，而非建立三份各自維護的系統。專案與 task 提供工作脈絡；Loop 描述如何推進；一次運行的證據說明實際發生了什麼。這些身份不可混成同一個「進度」。

現行 catalog 的 `morrowise-live-decision-loop-v1` binding 在本輪檔案查閱時仍標 `planned`。這只說明該 binding 的宣告，不是對所有 Loop 實作或 runtime 的全面驗收。新版介面必須分清架構已定義、能力已實作、當次已啟動、成果已驗證。

## 3. 證據、觀測與限制

來源查閱／畫面觀測發生於本對話的 2026-09-10。共享 checkout 同時有其他變更；下表是帶日期的診斷依據，不是可永久沿用的現況。落實修正前須重新核對目標版本與實際畫面。

| 證據 | 本對話已觀察到的內容 | 限制 |
| --- | --- | --- |
| 首頁程式與本機首頁 | 大量工程欄位、freshness／attention／boundary 重複；側欄有 13 個 surface；數個不同項目回到同一摘要 anchor | 是本對話稍早的畫面，不宣稱後續仍完全相同 |
| 首頁摘要生成邏輯 | Primary Next Action 取最高 attention 等級中第一個具有 action 的 surface | 可證明選擇方式；不能單靠此判定每一次排序都錯 |
| System Attention 邏輯 | stale 清單接在 blocked 之前，再取前三；stale 達三筆時 blocked 可被排出前三 | 是具體排序機制；仍需對照實際工作影響定義正確結果 |
| 專案頁與詳情操作 | 長卡片清單、領域篩選；詳情以長 modal 展開，已完成／歷史項目大量佔位；開啟專案仍停在 `/projects` | 未做完整裝置、鍵盤或無障礙測試，不可宣稱全面驗收 |
| 說明書程式與 registry | `/docs` 已整合 Fumadocs、搜尋、導覽、回 MC 入口；正文來源為 OPERATOR-GUIDE，網站讀取受驗證 bundle | 正式整合已存在，不重新發明一套文件庫 |
| 本機 `/docs` | 開啟時出現 `documentation_impact_blocked:collaboration:invalid_or_stale_review,delivery:review_missing,documentation:invalid_or_stale_review`，顯示 runtime error | 未修復或重跑文件審查；此錯誤是觀測當下結果，非永久故障判定 |
| 使用者回饋 | 雞肋、難用、雜訊多；目前 UX 本身也是問題 | 是直接相關的使用者證據；不應再要求使用者解釋儀表板的基本用途才開始判斷 |

資料過期本身也會影響體驗與判斷。不能把重新排版當作資料可信度修復，也不能以畫面上有警示就認為已妥善交付處理路徑。

## 4. HC 判斷與設計候選

HC 用於問題定義與偏誤檢查；下面是設計推論，不是完成證據或新的正式契約。

### #rightProblem：先確定介面要支援的判斷與行動

候選核心問題：MC 雖然呈現很多系統狀態，卻把「整理其工作意義、判斷影響、找到下一步」的負擔留給人。

應支援的結果是：掌握全局、接續工作、處理例外、判斷成果、理解能力、追查故障。若刪掉一半卡片仍做不到這些，資訊量減少就不是充分解法。

### #audience：同一個人有使用與建構系統的不同情境

Vincent 同時是工作負責人、系統建構者與決策者。架構應可查可理解，但日常進入 MC 不代表每次都要閱讀完整維運資訊。

設計候選：從工作需要的答案展開必要資訊；可追到其架構與證據。這不是以「使用者不懂技術」為前提，也不是把架構藏到無法發現。

### #systemDynamics：處理會持續產生雜訊的機制

已見要求「新能力必須接 MC surface」與「首頁應簡潔回答是否需要介入」並存。可能的累積機制是：新增能力 → 新增卡片／狀態／驗證資訊 → 更多常駐內容 → 人自行篩選的負擔增加。

候選修正原則：新增能力要能被定位、觀察及追查；是否常駐首頁，另由它對當前工作與人類介入的意義決定。不得藉減噪移除必要證據、失效提示或安全邊界。

只有已證明同一原因或同一事件的警告才聚合；主題相似、關鍵字相同或上下游關係不足以證明可合併。聚合後仍須可追到受影響項目與原證據。

### #organization：能力、運作與指南必須可互相定位

候選路徑：工作／Loop → 當前階段 → 成果或卡點 → 對應能力與說明 → 適當處理入口 → 返回原工作及結果。

說明書保留獨立閱讀入口，也在能力及工作階段提供相關章節。查看「如何驗收」後能回到原工作；文件載入失敗仍應有可理解的狀態、返回入口與處理方式。未驗證正文不能因 UX fallback 被當成有效指南。

## 5. 規劃順序與預期產物（候選）

以下是討論順序，不是已核准 execution plan；不先指定四個主導覽、頁面數或新資料結構。

| 順序 | 要聚焦什麼 | 討論產物 | 進入下一步的條件 |
| --- | --- | --- | --- |
| 1 | 整體關係：MorroWise／Harness／Loop／MC／說明書 | 一張關係圖與物件身份說明，指回既有正本 | 能解釋角色、接法及結果歸屬，沒有平行 owner |
| 2 | 人如何完成工作與介入 | 掌握、接續、例外、成果、能力、故障的完整路徑 | 每條路徑有入口、判斷／操作與結束條件 |
| 3 | 資訊架構與互通視角 | 運作與結構的切換、物件詳情、搜尋、說明書關聯 | 能雙向定位且返回原處；主導覽再由此推導 |
| 4 | 資料品質與互動需求 | 每個畫面問題的來源、更新條件、有效性、排序、聚合與操作規則 | 分清需改 MorroWise 判斷／資料和只需改 MC 介面的部分 |
| 5 | UX 草圖與完整情境走查 | 可檢查的互動路徑，含正常、過期、缺資料、失敗情境 | 草圖通過候選判準；示例與實際 runtime 不混用 |
| 6 | 正式承接與分段實作 | 對既有 task／spec 的 reuse、amend 或拆分提案 | Vincent 核定設計與實作範圍後，才進正式實作流程 |

目前可交付的是這份規劃前聚焦暫稿。正式 IA、欄位／狀態映射、互動草圖、實作切片與改版驗收均未完成。

## 6. UX 候選驗收：驗的是能否用，不只是否有卡片

本表是供後續討論的候選標準，尚未核定。若正式 task 已有驗收，後續應沿原 ID 修訂／補充，不以此表取代。所有新版 UX 實測結果目前為 `not_run`。

| 情境 | 應可觀察到的結果 | 不應被當成通過的反例 |
| --- | --- | --- |
| 掌握運行 | 知道工作目標、目前階段、已得結果、卡點與下一個責任角色 | 只看到 task 完成率、系統數量或一片紅燈 |
| 追查原因 | 從卡點追到受影響工作、能力與證據；可返回原定位 | 不同連結全部回同一摘要；讀完找不到原項目 |
| 正常與需介入 | 正常運作可簡潔掃讀；需要人的項目有原因、影響及處理入口 | 把每個 stale 一律當最高優先、為降低噪音隱藏無法判斷的風險 |
| 讀說明書 | 可獨立查找，也可從當下階段進對應章節 | 只加一個 `/docs` 連結，操作與章節無關聯 |
| 文件過期／審查未過 | 保留可理解的說明、導覽與處理入口；清楚標出指南有效性限制 | 整頁 runtime error；或直接顯示未驗證正文為現行指引 |
| 任務與運行身份 | task 狀態、Loop 定義、當次執行及成果驗證清楚區分 | fixture／planned binding 被呈現成正在運行；Loop 終態直接關閉 task |
| 真實操作 | 按鈕文案與實際效果一致；查閱／準備／已送出／成功／失敗可辨識 | 按下後只出提示卻宣稱已執行；無 executor 的控制項偽裝可操作 |
| 閱讀與導航 | 主要資訊有清楚層級、不被截斷；保留篩選／返回位置；鍵盤可完成關鍵路徑 | 長 modal 加巢狀捲動讓工作失去上下文；顏色是唯一狀態訊號 |
| 來源一致性 | 畫面可回查同一正本及資料時間；受契約約束的重建內容一致 | schema 通過但重建內容不同，仍宣稱資料有效 |
| 能力變更與文件 | 受影響指南有更新或有效 no-impact；與呈現版本一致 | 能力已變而文件未更新、沒有有效 no-impact；或純內部無影響變更被強迫改正文 |

需要討論的易用性量測包括辨識時間、錯選率、返回成本與是否能完成工作；目前不自行宣告秒數／點擊數門檻，更不把它們記為已通過。

## 7. 正式來源與後續承接

下列來源於本對話查閱。引用檔案／task 身份是為了接回既有系統，不表示其現行 task 狀態或所有能力已完成。

| 來源 | 用途／資料齡 |
| --- | --- |
| `$COLLAB/notyet-harness/000_Agent/CORE.md`、`$COLLAB/notyet-harness/000_Agent/USER.md` | 整體先行、資料所有權、工作方式與介面定位 |
| `$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md` | 系統人讀入口、Harness 雙層理解；generated 區塊日期另辨，不當成本輪 runtime 驗收 |
| `$COLLAB/notyet-harness/000_Agent/decisions/ADR-004-jarvis-system-ownership.md` | Accepted：MorroWise 為唯一活系統 owner，surface 與系統分層 |
| `$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-dev-workflow-catalog.md`、`$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json` | 現行 Harness／Loop 控制邊界；registry 更新日期 2026-09-08；planned binding 不作 runtime 完成證據 |
| `$COLLAB/harness-mc/milestones/morrowise/maps/operating-loop.json` | 既有關係圖入口；`as_of: 2026-07-20` 的節點狀態是歷史快照，僅以關係作聚焦線索 |
| `$COLLAB/harness-mc/milestones/morrowise/project.json`、`$COLLAB/harness-mc/milestones/harness-mc/project.json` | 系統／介面定位與正式所有權 |
| `$COLLAB/harness-mc/milestones/morrowise/tasks.json#mc-dashboard-priority-ia-v2` | 已存在的 MC 資訊優先級與繁中化治理議題；後續先比對既有核准內容，不重新創造同義議題 |
| `$COLLAB/harness-mc/milestones/harness-mc/tasks.json#morrowise-priority-dashboard-surface-v2` | 已存在的介面實作承接線索；包含真實下鑽、上游 read model 與 fresh-session 要求 |
| `$COLLAB/harness-mc/milestones/morrowise/tasks.json#document-source-registry-and-human-sync` | 文件治理／人讀同步正本 task；不以改 UX 自動擴大為整個文件治理工程 |
| `$COLLAB/harness-mc/system-workflow/registries/morrowise-document-sources.json`、`$COLLAB/notyet-harness/000_Agent/docs/morrowise/OPERATOR-GUIDE.md` | 目前已整合的 local_only 說明書來源；registry reviewed_at 2026-09-09，review 是否仍有效需實測 |
| `$COLLAB/harness-mc/app/page.tsx`、`$COLLAB/harness-mc/app/projects/page.tsx`、`$COLLAB/harness-mc/scripts/generate-morrowise-live-dashboard.mjs` | 首頁、詳情、排序的實作證據 |
| `$COLLAB/harness-mc/lib/morrowise-docs-source.ts`、`$COLLAB/harness-mc/app/docs/layout.local.tsx`、`$COLLAB/harness-mc/app/docs/[[...slug]]/page.local.tsx` | 說明書載入、導覽、版本與錯誤影響的實作證據 |
| `$COLLAB/notyet-harness/300_Obsidian_brain/HC/_combos/problem-diagnosis.md` 及 `#rightProblem`、`#evidenceBased`、`#audience`、`#systemDynamics` 操作手冊 | 思考方法；不取代事實正本、判定政策或驗收收據 |

正式承接方式尚待此次聚焦完成後決定。系統判斷、資料模型、Loop／verifier／routing 修正歸 MorroWise；單純顯示與互動歸 harness-mc。說明書的正文／摘要／網站投影沿現有治理鏈處理。

## 8. 下一輪先聚焦什麼

建議先固定「人進入 MC 時，如何看到並接續一個有目的的工作循環」。這是待討論的 UX 主軸，不是新建 Loop registry、task 類型或追蹤器的授權。

下一輪以既有工作與證據核對：

1. 畫面上的主要物件如何連回專案、task、Loop 定義與當次運行？沒有可信運行證據時如何表達？
2. 哪些內容先顯示即可幫人判斷，哪些在查架構、證據或說明時展開？
3. 從「需要介入」到「取得可檢查結果」有哪些真實可用入口，哪些只是提案／待實作？

可先用兩條既有情境來壓測設計：工作成果待驗收；能力／文件變更後的審查與恢復。前者檢查日常工作價值，後者檢查 Loop、架構、文件與故障處理是否接通。它們是設計案例候選，尚未在新 UX 實跑。

## 9. 寫入邊界、驗證與退場

- 目標 `plan/` 在寫入前已存在且為空，未找到同名文件；採排他新增，若檔案先被建立即停止，不覆寫。
- 既有 Repo Ready 的本輪觀測為 `BLOCKED / needs_push`，fetch 成功、main ahead 4／behind 0，另有 owner 未明的 dirty。此收據不等於本 repo 已可執行一般開發或交付。本次依 Vincent 明確指定的單檔寫入範圍新增本暫稿；既有提交與其他檔案不在寫入範圍，未推送或處理它們。
- 本次產物只有此臨時文件；未建立正式 task、未修改 UI／資料／規則／說明書正文、未製作互動草圖、未 commit／push／部署／同步。
- 文件交付檢查：寫後重讀，核對 temporary 身份、來源可定位、事實／推論／候選分開、已撤回方案未被沿用、無本機絕對路徑或秘密；新版 UX 驗收保持 `not_run`。此檢查不證明實作完成。
- 發生架構／policy／來源版本／現有介面變更，或 Vincent 確認／修正設計方向時，由獲准的 writer 更新本文件並保留日期與歷史觀測。同檔若有他人變更，先核對 owner 與交接再續寫。
- 當必要決策由既有正式 task／spec 承接，核對承接位置後可提議將本文件標 `superseded`；不自行封存或刪除。若長期維護者仍未指定，接續 Agent 應在本文件內續接，不另開第二份草稿。
