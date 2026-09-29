# Zeabur 開發交付與伺服器維運

版本：1.0｜2026-09-20｜Owner project：MorroWise／runtime-delivery｜工作身份：`morrowise/zeabur-development-operations`｜排序代碼：`MW-ZEABUR-01`。

**目的：任何 Agent 接手都能找到主機、服務、開發部署方式、固定維護、備份與還原紀錄；日常運作不依賴 Vincent 重述背景或 Mac 保持開機。**

## 1. 接手入口與目前狀態

- 本規格唯一位置：`$COLLAB/harness-mc/system-workflow/docs/specs/zeabur-development-operations.md`。任務狀態正本：`$COLLAB/harness-mc/milestones/morrowise/tasks.json#zeabur-development-operations`；MC、聊天與 Issue 不是第二份任務正本。
- Vincent 於2026-09-20指定「歸MorroWise專案」，在檢閱工作內容、頻率及驗收後回覆「以上可以」。本輪承接規格與todo任務；沒有聲稱主機已開始維護。首次實機建置前取得具名服務、目的地與操作範圍；既有有效授權內的例行執行不逐次重問。
- **下一步 S0：唯讀盤點現有 Zeabur 主機及服務，填齊下表缺項，挑選一個已存在的服務作首次納管；不等待0052開發完成。** 查既有安全設定reference，缺的才詢問，不重問本文件已回答的產品需求。
- 當前工程／部署／自然排程／通知／備份／還原：全部`not_run`。值班維護者、雲端IDs與備份目的地未核實；任務為`todo`，不設定weekly_core。
- 接手閱讀順序：本節 → 當步S階段 → 該服務runbook → 最新執行與驗收收據。遇到故障讀第7節；新增服務讀第4節。

| 已知基線 | 內容 |
| --- | --- |
| 來源 | 使用者提供的Zeabur截圖；不是live盤點 |
| 主機 | Akamai／Tokyo, JP／ZeaburOS（K3s）；2CPU／4GB；磁碟78.2GB |
| 畫面用量 | CPU11%；記憶體2738/3911MB（70%）；磁碟31%；流量10.7GB/4TB |
| 費用／到期 | 主機US$20/月、2026-10-08到期；是否續費成功及平台訂閱另核 |
| 告警 | 畫面主機告警未啟用，不推論其他應用監控狀態 |
| 待S0確認 | server/project/service IDs、主機架構、全部服務與Volume、24h尖峰、備份現況、平台方案、唯讀存取方式、主／備維護者、停機窗口、收件reference、站外儲存與解密金鑰reference、增量費用上限 |

先用現有主機評估，不能把畫面剩餘RAM全配給新服務，不能因70%使用率直接升級。記錄24小時資源峰值及一次取數／備份尖峰，再設定限制與錯開時間。無live存取只阻擋依賴它的盤點與啟用，不阻擋離線程式及規格工作。

## 2. 範圍與責任

| 責任 | Owner／落點 |
| --- | --- |
| 跨服務固定巡檢、覆蓋率、故障通知、容量費用及清理建議 | MorroWise本工作項目 |
| 主機維運常駐程式與設定 | 待建於`$COLLAB/notyet-harness/schedule/services/zeabur-ops/`；獨立Zeabur服務，不能嵌在0052程序，也不依賴Codex thread automation或Mac launchd |
| 每個應用的功能、資料一致性、備份export與實際還原 | 各服務原專案／owner。0052仍在`$COLLAB/wealth-system/modules/market-watchtower/` |
| 狀態顯示 | 既有MorroWise／MC只讀結果；本版不新增Dashboard、任務系統或共用資料庫 |
| 系統元件 | ZeaburOS／供應商依其實際支援範圍；應用、資料、續費與復原仍須有人負責 |
| 帳戶、費用與具體刪除 | Vincent決策；不把未知owner默認為執行Agent |

本案不改0052訊號算式、金融研究、持倉、券商接線或其他網站功能；雷達原文件保留自身規格，日後只引用此共享維運入口。舊R5、16.9研究及停用的盤中流程不動。也不擴張JV-33本機非Git備份的scope。

本計畫不預先授權自動升級、重灌、擴容、刪檔或停止其他服務。日常巡檢、已採用範圍的備份及報告可在首次啟用驗收後自動執行；清理固定report-only。

## 3. 最小技術架構與程式落點

MorroWise維運服務採Node.js24、ESM、內建HTTP、單一程序scheduler、JSON/Markdown產物與獨立Volume；Dockerfile固定受測Node patch／image digest與必要restic版本，npm lock固定。無Next.js、Redis或PostgreSQL依賴。實作時核當時支援／安全版本，不把本文major當永遠免更新。

維運服務只讀平台允許的服務目錄／指標與各服務的安全備份收據，不掛主機root、K3s socket或其他服務Volume，不讀出所有服務環境變數。若Zeabur沒有適當唯讀存取路徑，該巡檢欄位標`unknown`與coverage gap；不以全面admin權限繞過。

**備份分工是單一責任，不是共享檔案系統：**各服務的既有／新增備份job由它的owner配置，擁有自己的資料與備份憑證；本維運服務讀取安全收據，核漏跑／過期並報告。相同服務只登記一個backup schedule owner（`service`或`platform`）。不要在MorroWise和應用各排一份相同備份。主機維運服務自己的catalog、設定與收據索引，另以本身的restic job備份。

程式待建位置均相對上述`zeabur-ops/`：

| 檔案 | 責任 |
| --- | --- |
| `src/server.mjs`、`scheduler.mjs`、`store.mjs` | HTTP、自然排程、單writer及重啟狀態 |
| `src/inventory.mjs`、`health.mjs` | 平台唯讀adapter、服務比對、資料齡與門檻 |
| `src/backup.mjs`、`receipts.mjs` | 自身一致export／restic、各服務備份收據核對；不讀別的Volume |
| `src/notify.mjs`、`reports.mjs`、`cleanup-report.mjs` | 雲端Telegram adapter、日週月報、清理建議；沒有delete/prune執行命令 |
| `config/operations.json`、`config/services.json` | 非秘密設定、服務catalog；source版本與採用hash記入DATA_DIR，秘密僅reference |
| `scripts/ops.mjs`、`test/*.test.mjs` | 維護CLI及必要正反測試，Node內建test runner |
| `Dockerfile`、`.dockerignore`、`package.json`、lock、`README.md` | 固定映像、非root權限、啟動及實際操作入口；ignore秘密與runtime |

`DATA_DIR=/data/zeabur-ops`，只掛本服務`/data`；`PORT`讀平台環境，監聽`0.0.0.0`。HTTPS及私人報告存取由本服務處理；只提供受保護的固定報告路徑，不公開raw、路徑、服務清單或秘密。HTTP health例外見第8節。無資料時not_initialized，不能回fixture。

待建立命令契約（目前不存在，不可當已能執行）：`npm ci`、`npm test`、`npm start`、`npm run ops -- inventory --read-only`、`report --kind daily|weekly|monthly`、`backup-self`、`backup-check --snapshot <id>`、`restore-self --snapshot <id> --target <empty-isolated-dir>`、`cleanup-report --read-only`。各ops子命令均透過`npm run ops --`呼叫；不接受任意shell、URL或跨服務路徑。0=操作成功，2=有gap/partial，1=失敗；exit0不代表全主機coverage100%。

## 4. 服務清單與每案完整交付流程

`services.json`每筆必含：`server_id,project_id,service_id,name,owner,purpose,state,code_ref/image_digest,volumes[{logical_id,mount,data_kind,uid,gid}],dependencies,secret_refs,backup_schedule_owner,backup_method,repository_ref,retention,rpo_hours,rto_hours,allowed_pause_window,restore_runbook_ref,receipt_ref,last_inventory_at,coverage_status,gaps[]`。未知用null；秘密值不入catalog／Git／日誌。移除或停止服務只改盤點狀態，不自行刪資料。

S0選一個當前已存在、owner可確認、可安全備份的服務試行；隨後將同主機每個持久資料來源列為已覆蓋或具名gap。若該主機沒有DB，不為演練自行建一套DB；有DB則代表性還原必須包含DB類型。

每個新專案或重大更新沿固定流程：

1. **需求與規格**：明確使用目的、資料及驗收；指向該專案正本，不抄成MorroWise的功能規格。
2. **開發與本機驗證**：原專案執行必要測試、錯誤／缺資料案例；fixture與真實資料分開。
3. **CI與固定版本**：鎖檔、版本、Docker build及必要測試；部署收據固定commit SHA/image digest。無條件push自動部署若不等待CI，先改為只部署已測版本。
4. **部署前準備**：catalog、資料mount、secret references、資源限制、備份、回復版本、停機窗口、域名／HTTPS。新費用先具體列出；不預購。
5. **部署與線上驗收**：核實真內容、資料來源可達性、驗證／權限、重啟持久保存及其他服務影響；HTTP200不是全部通過。
6. **納管與試運轉**：配置服務自己的備份job、將安全收據交本維運服務核對、外部監控與指定收件者測試；Mac關機等待自然slot。
7. **還原與交接**：固定snapshot隔離還原；服務內容實際可用。記runbook、owner、下一步及未覆蓋項，未完成的檢查不打pass。

日後每次新增服務、Volume、schema、部署方式或秘密取得方式，該服務owner必須更新catalog/runbook並只重驗受影響項。原服務停用不能使主機維運服務停用。

## 5. 固定日曆與執行語意

全部時間`Asia/Taipei`。這是核准計畫的預設；實際採用值寫入唯一config，config hash隨收據保存。

| 工作 | 時間／條件 | 產物／執行者 |
| --- | --- | --- |
| `ops-health` | 每5分鐘 | 維運端核應用健康、可取得主機指標、排程tick、備份齡；2分鐘上限 |
| `inventory-refresh` | 每日08:30 | 維運端比對服務／Volume，新增或未知服務列gap |
| `ops-daily` | 每日09:00 | JSON＋Markdown日報；正常只存檔，異常通知 |
| 服務資料備份 | 預設每日11:30、23:30；部署／重要變更前另作一致備份 | 各服務唯一backup owner；平台排程不足兩次時須明列實際頻率及RPO能否達成，不能假報兩次 |
| `backup-self` | 每日11:30、23:30 | 維運服務自己的catalog／設定／收據索引站外備份 |
| `ops-weekly` | 週六09:30 | 覆蓋率、容量、到期與清理建議；發一則摘要 |
| `backup-check` | 週日03:00 | 各備份owner結構check＋輪替讀回；維運端核檢查收據 |
| 第二目的地副本 | 週日04:00，與同repo check互斥 | 各備份owner複製至獨立目的地；未配置列third_copy_pending |
| `ops-monthly` | 每月1日10:00 | 版本、權限、費用及保留量建議，不自動升級 |
| 季度還原演練 | 每季首月首週六10:00 | 由已指定維護者使用事先核定隔離目標／服務範圍實跑；缺目標則報blocked／逾期，不能只建待辦就算已演練 |
| 主機外HTTP監控 | 每5分鐘 | 獨立監測提供者；主機失聯仍可發Email／已驗證通道 |

設定必要欄位：`schema_version,mode,timezone,jobs[{id,enabled,schedule/event,timeout_seconds}],notifications{enabled,destination_ref},backup_self{enabled,repository_ref,key_ref},host_inventory{enabled,server_id,read_only_access_ref},cleanup_mode,maintenance_owner,backup_maintainer,budget_usd,restore_target_ref`。只接受已知job ID；允許backup事件與固定schedule共同請求同一job，合併去重，不執行動態JS。

mode固定`disabled|active|restore_validation`：首次部署disabled，scheduler、發送及備份不自動啟動；active僅執行enabled且必填值有效的job；restore_validation由啟動參數強制，優先於還原的active設定，禁止live取數、排程、對外發送及遠端寫入，只允許隔離讀回與驗證。缺必要設定阻擋該功能並報gap，不關掉可讀網站。

`job_key=job_id+scheduled_for+scope_id`。保存排定／開始／結束、狀態、attempt、config hash、產物refs及error_code。重啟只補最近一個漏跑slot；超24h的觀測slot記missed，另查現在，不倒填成歷史當時已知。互斥衝突延後，不丟掉最後一個待辦；取數10分鐘、backup/check預設60分鐘上限，首次量測後可有據調整。逾時／中斷不提升last_success。

每個DATA_DIR使用exclusive create owner lock；第二writer拒絕。正常結束由原owner釋放；崩潰留鎖需維護者證明原程序已停止再受控恢復，不依PID或鎖齡自動破鎖。同程序store鎖僅涵蓋capture，export完成釋放；restic repo鎖涵蓋backup/check/copy，不能把整段上傳鎖住應用writer。會寫DATA_DIR的CLI只供服務writer停妥後離線使用，不能與server競寫。

## 6. 備份契約

Volume是持久化，不是備份。每個有狀態服務按以下類型選定方法，產生同一安全收據；選定之後不讓Agent每輪重猜：

| 類型 | 一致性與責任 |
| --- | --- |
| JSON／原檔 | 原服務store短暫阻擋writer、生成不再改寫的export，再恢復writer；snapshot包含相符metadata及不可變run引用 |
| DB | DB owner採與實際版本相容的原生一致dump／已驗證平台DB備份；保留版本、roles/extensions重建需求與退出結果。禁止直接複製正在寫入的DB目錄 |
| uploads與關聯DB | 原owner提供相符的一致時點及恢復順序，不各抓一份卻假稱相符 |
| 無狀態服務 | 可重建程式／映像、版本、設定及secret references；先證明無未登錄持久資料 |
| 未知 | coverage gap；不得擅自停機或複製整台主機 |

選定的長期方案：一致export → restic加密 → Vincent持有帳戶的S3相容站外儲存，各服務獨立prefix/repo與最小權限。對現有服務可保留已驗證且符合復原要求的原生備份，不為統一工具強制搬家；短期平台副本不能冒充已驗證長期保留。

備份集合含資料、引用原檔、current及完成的執行metadata、通知ledger／scheduler cursor（如有）、相容code SHA/image digest、schema/config版本與secret references；秘密值／解密金鑰須由獨立密碼管理來源備援，主機損毀時仍可取得。不要只備資料卻遺漏重建必要設定。

manifest：`backup_set_id,capture_at,service_ids,code_sha/image_digest,schema_version,config_hash,files[{relative_path,bytes,sha256}],secret_refs`。採allowlist排除export自身、cache、lock、半成品、.env及秘密，拒絕指向集合外的symlink。禁止遞迴備份export造成無限增長。

receipt：`service_id,backup_set_id,snapshot_id,repository_ref,capture_at,started_at,completed_at,tool_version,exit_code,status,manifest_sha256,verification_scope,verified_at,error_code`。完成後才原子發布；restic exit3、來源拒讀、漏檔、斷網都是partial／failed，即使有snapshot ID。讀回指定snapshot的manifest與代表檔核hash，結構check與實際資料讀回分列。維運端只讀安全receipt，不持有其他服務解密金鑰。

保留目標：30份每日＋12份每月；每週第二獨立目的地副本保留4週，不跟隨第一處刪除。未核定目的地就列gap。刪除預設report-only，所以目標不是硬上限；不得暗中forget/prune。容量增長如實列週報與費用。

預設`RPO_target=24h`、`RTO_target=4h`作初始pilot驗收目標；各服務必須核定自己的值，不能外推全主機保證。RPO用最新完整可恢復狀態的capture_at算，不用upload時間／行情日期洗新；20h預警、超24h失敗。每週結構check及讀回樣本，每月覆蓋現存pack或明示未覆蓋量，抽樣不稱全量驗證。

## 7. 還原與變更

事故順序：記故障與scope → 停受影響服務排程／通知 → 選已核snapshot＋相容程式 → 空的隔離目標 → 取獨立保管的秘密 → 還原與hash/版本/UID/GID核對 → 啟動唯讀驗內容 → 決定切換 → 取當期資料／重建通知baseline → 恢復核定排程 → 記實測RPO/RTO及gap。

拒絕覆寫production、current或非空且歸屬未知目標。演練不能藉機啟動原先停用服務；所有暫停／恢復要記原狀。主機全毀依catalog的依賴順序復原，不能假定雲端仍存原環境變數。備份庫解密與程式映像取得方式須在原主機不可用時仍可找到。

通知pending在重啟後轉unknown，不能因缺回執就自動重送。舊snapshot還原後維持通知停用；記notification_gap，以首次當期觀測作baseline，不重播歷史市場事件；既有真實品質／系統故障可成新incident。不宣稱exactly-once。

程式更新先備份、隔離驗schema相容，再部署受測版本；程式rollback和資料還原分開，新schema不相容不能直接回舊程式。主機OS更新、重灌或升級要列影響服務、停機窗口、具體範圍與回復；重灌會清資料，不自動執行。

## 8. 告警與外部監控

Telegram為主要日常報告候選，沿既有通知回執語意新增可雲端運行的adapter；不能呼叫Mac上的notify.sh。收件與token只在runtime由secret provider注入，報告僅reference。區分pending／provider_accepted／failed／unknown；API接受不代表手機收到，首次指定測試由Vincent實際確認。只有可證未送出請求的失敗才有限重試。

incident key：`scope,check_id,incident_started_at`；首次告警、持續24h提醒一次、恢復一次，severity升級即時通知。日報正常不發；每週一則摘要。主機全停由主機外監控告警，不能依賴這個同機服務自救。先評估5分鐘HTTP＋Email的獨立服務，Telegram支援依實際方案驗證。

CPU／RAM>85%連續15分鐘提醒，必須有有效連續樣本；磁碟>70%連續兩次提醒、>85%critical；OOM、read-only或寫入失敗立即critical。缺指標不是正常。HTTP連續3次失敗告警、連續2次恢復；續費14／7／3／1日前提醒，以live日期為準。

`GET /healthz`只表示程序存活，用於平台restart。另有`GET /health/application|scheduler|backup|inventory`，只回`{check,status:ok|degraded|unknown|disabled,code,checked_at}`，ok=200其餘503，no-store；不曝露財務內容、路徑、服務清單或秘密。每次GET按當下時間與持久收據計算，不沿用舊scheduler綠燈；這些503不觸發平台restart。

- application核本程序與store可讀性；沒有完整catalog不能推導全面健康。
- scheduler需active且tick未超10分鐘、應跑job未漏跑／超時；收據不全unknown。
- backup依各服務RPO與完整成功／讀回receipt；任何缺覆蓋服務顯示非ok，partial不能當整台通過。
- inventory超7日未核、平台取不到或服務對不上即unknown／degraded。

disabled／restore_validation不冒充healthy；P5未啟用功能前不打開相應正式告警check。外部provider能力不足則列未涵蓋項，不能只驗healthz稱OP10通過。

## 9. 固定清理建議與費用

每週只讀產出「可評估／先核對或備份／保護項目」三類。候選欄位：`candidate_id,service_id,owner,path_or_prefix,kind,bytes,last_used_evidence,referenced_by,retention_rule,backup_snapshot_id,restore_verified_at,reclaim_estimate,proposed_action,risk,reason`。未知用null。不因檔案老、叫tmp、服務停止就判可刪。

中斷export須無active引用、保留診斷且至少7日才可建議；image需無運行服務引用且非rollback版本；logs需有已採用期限並保護事故證據；snapshot只列保留策略dry-run。DB、uploads、秘密、current、研究原檔不是普通暫存。沒有cleanup-execute、rm、prune或刪Volume權限。

日後具體清單取得授權才重新核owner／引用／備份並執行，範圍變就停該項；保存回復方法與釋放量。一份清單授權不等於永久刪除授權。

月費分主機既有費、平台訂閱、站外容量／請求／流量、外部監控及網域。已知只有主機US$20/月，其餘unknown；不能寫全部20美元。增量預算上限S0填，80%提醒／100%需處理，未填budget_unknown。續費失敗告警不等於代替付款。

## 10. 開發階段與退出條件

| 階段 | 工作／輸入 | 產物／完成條件 |
| --- | --- | --- |
| S0 盤點 | 現有主機、服務、存取reference、24h容量、owner／窗口／預算 | 完整catalog初版、代表pilot、具名gap；已有資訊不重問 |
| S1 固定每案交付與備份契約 | 本文件＋每服務原規格 | config schema、runbook、backup/export與receipt方式；未知服務列gap |
| S2 開發與本機測試 | 上述契約 | 獨立ops服務、日週月報、scheduler、通知、health、report-only清理；必要故障／重啟／去重案例通過 |
| S3 備份與隔離還原 | pilot實際資料與核定目的地 | 完整備份、讀回、空目標還原及服務內容驗證；無live只可local_verified |
| S4 CI／部署 | 受測SHA／image、現有主機資源與Volume | 部署版本一致、HTTPS及持久化正常；不影響其他服務；仍預設disabled |
| S5 啟用試運轉 | 填齊設定及具名維護／收件者，採用config hash | Mac關機，自然slot巡檢／備份成功；測試通知收到、外部故障與恢復測試通過 |
| S6 全機覆蓋與交接 | 全服務catalog、各backup owner收據、操作手冊 | 全持久資料有方法與最近成功收據；還原覆蓋另計；新Agent冷讀可接手。仍有gap只稱partial |

各階段只重驗受修改影響項；不預建更多平台。首次實作前確認既有MorroWise runtime可用接口，再新增雲端adapter；現有本機scheduler標completed不代表雲端可用。部署地必須實測來源可達性。本案不因MC顯示頁尚未開發而重建Dashboard。

正式執行參數／程式是Git正本；runtime在`DATA_DIR/{inventory,jobs,receipts,reports,restore-drills,exports}`。外部成功心跳不替代收據。安全的完整備份收據由各owner存其站外目的地，本維運端保存索引及副本；主機全毀仍可從指定站外根目錄定位。

每次交接更新同一份`handoff.json`：`task_ref,phase,next_action,blocking_gaps,owner,last_checked_at,code_sha,config_hash,acceptance_refs`。實機完成後README指向實際可用指令及各服務runbook，本文不複製另一份現況表。任務只在全部必要實測成立才關閉；日常維護啟用及長期owner不能隨建置task關案一起消失。

## 11. 驗收OP01–OP13

此矩陣供canonical task引用，首次記錄全部not_run；每項收據含ID、scope/service_ids、版本、操作時間、expected/actual、結果、checker、evidence refs與gap。

| ID | 操作 | 通過條件／拒絕反例 |
| --- | --- | --- |
| OP01 部署 | 核host/service、SHA/image、HTTPS與內容 | 同版且真內容可用；只有HTTP200或本機build不足 |
| OP02 覆蓋 | 對照live全部服務及Volume與catalog | 每個持久來源有方法、owner及成功收據或明確gap；新增未知服務不算已備份 |
| OP03 原機不可用 | 從站外取得重建指引、版本、mount／權限與secret references | 不靠聊天或原機即可找到必要資料／金鑰取得方式；缺一項不可稱可還原 |
| OP04 一致性 | writer凍結capture／DB一致dump，核相符引用與恢復狀態 | dump失敗、活DB目錄複製、DB/uploads時點不符不能成功 |
| OP05 真備份 | 站外固定snapshot，核完整來源與退出碼 | 缺檔、斷網、exit3不因有snapshot ID而成功 |
| OP06 讀回 | 結構check＋指定資料讀回核hash | 損毀能攔下；抽樣範圍明列，不冒稱全量 |
| OP07 還原 | 固定snapshot至空隔離目標，計時；包含主機實有代表DB／檔案類型 | 資料、版本、權限與應用可用；不覆寫production；RTO只對受測scope |
| OP08 業務可用 | 原服務核關鍵內容／日期／資料關聯 | 解壓成功不等於服務可用；0052若納管須同原檔重現卡片，不因還原變fresh |
| OP09 自然排程 | Mac關機等待正式slot，核更新／備份收據 | 自然與手動分列；RPO按capture_at；雷達服務停用仍有主機維護tick |
| OP10 外部告警 | 獨立測試check演練失聯、陳舊receipt、失敗及恢復 | 主機停工仍可送達指定收件人且去重；只有同機log不足 |
| OP11 中斷 | 隔離測第二writer、磁碟不足、中斷／pending及舊snapshot | 不競寫、不抬升last_success、不自動破鎖／重送歷史；原停用服務不被啟動 |
| OP12 清理 | 已引用／未知owner／無備份及合法候選的對照 | 只產有據清單；檔案／Volume hash與數量不變；不執行刪除 |
| OP13 接手 | 新Agent只讀本入口、catalog、runbook、handoff與收據 | 可找到下一步、命令、owner、驗收與失敗處理；需重問已知需求即finding |

分開回報`spec_ready,local_verified,ci_verified,deployed,schedule_verified,notification_verified,backup_verified,restore_verified,fleet_coverage,maintenance_enabled`。covered是契約及近期備份有效，verified_restore另計，不能以pilot成功稱整台完成；`inventoried_count,covered_count,verified_restore_count,gaps[]`同時呈現。

## 12. 依據與本輪界線

歸屬依據：`$COLLAB/harness-mc/AGENTS.md`、`milestones/morrowise/project.json#runtime-delivery`、`$COLLAB/notyet-harness/000_Agent/decisions/ADR-004-jarvis-system-ownership.md`。比較過`morrowise/runtime-scheduler-v0`、`notification-adapter-contract`、`local-nongit-data-backup-spec`及`market-watchtower/mw-009`；它們各為共用本機runtime／通知契約、本機非Git備份或單一應用部署，沒有承接本次跨服務Zeabur完整交付與持續維護終點。

平台依據查核於2026-09-20；不把一般平台功能當本帳戶已啟用：

- [ZeaburOS](https://zeabur.com/docs/en-US/server/os)、[Volume](https://zeabur.com/docs/en-US/operations/data/volumes)：主機維護界線、持久化與服務隔離。
- [備份與還原](https://zeabur.com/docs/zh-TW/operations/data/backup-restore)：一般Volume與DB備份行為不同，方案與留存以帳戶當期核對；不能假設全部服務已有每日備份。
- [Dockerfile](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)、[方案](https://zeabur.com/pricing)：依實際資源及固定映像部署。
- [restic備份](https://restic.readthedocs.io/en/stable/040_backup.html)、[check](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)、[restore](https://restic.readthedocs.io/en/stable/050_restore.html)：partial退出碼、讀回及隔離還原。
- [外部監控方案](https://uptimerobot.com/pricing/)：5分鐘HTTP候選；實際收件整合及費用須核對。

本輪只登錄本規格及MorroWise的todo工作項目，不修改既有task內容、不改wealth-system原文件／Issue、不變更共享runtime或其他服務；不commit/push、部署、建立資源、啟用排程、發送通知、備份或清理。先前雷達＋整機混合稿不再作為整機實作入口；產品研究仍回雷達原文件。
