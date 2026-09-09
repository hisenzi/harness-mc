# Codex 工作區盤點與受控清理

狀態：本地操作規格 v1。程式與 macOS 合成驗收已完成；真實唯讀週報已產生，原生 heartbeat 已啟用並讀回。中央 task／registry／admission 承接仍待 owner 交接，未宣稱整體系統已 closed。

操作規格正本：`$COLLAB/harness-mc/system-workflow/docs/specs/codex-workspace-cleanup.md`。來源計劃為 `$COLLAB/notyet-harness/100_Todo/plan/2026-09-07-codex-workspace-cleanup-plan.md` v0.3（保留 v0.2 原始標準）；承接其保護、逐項核准、可復原與未知即停止的要求。正式政策承接後，來源計劃保留歷史與此正本引用，不作每週追蹤表。

## 1. 責任與範圍

本流程管理 Vincent 指定的 Codex 日期工作區根目錄 `target_root`，提供唯讀盤點、候選準備，以及經具體核准後的逐檔隔離、還原與中斷核對。主動盤點、政策與 runner 的系統 owner 為 MorroWise；正式任務來源為 `$COLLAB/harness-mc/milestones/morrowise/tasks.json`。目前未完成同範圍 task、capability registry 或 live-system admission 的正式承接，原因是相關中央檔案由其他工作擁有，須待具名移交後依既有流程處理。這不將本地工具或本文變成另一份 canonical task state，也不表示系統已 closed。

能力由 Python 標準函式庫實作，正式入口為 `$COLLAB/harness-mc/scripts/codex_workspace_cleanup.py`；驗收入口為 `$COLLAB/harness-mc/scripts/verify_codex_workspace_cleanup.py`。`POLICY` 常數是執行規則來源，`policy` 子命令輸出規則與 `policy_hash`；本文說明用途、操作契約與限制，不另維護不同的規則值。不得修改他方擁有的中央 task、registry、preflight 或 event 程式來替本案取得通過狀態。

本地唯一狀態目錄為 `target_root/.workspace-cleanup`，包含核定的報告、快照、準備批次、journal、隔離內容和還原收據。它須為目前使用者擁有的一般目錄、權限 `0700`、與 `target_root` 同一檔案系統，並永久排除於候選掃描。批次位於 `<32 位十六進位 batch_id>/`，含 `journal.json` 與 `000000.payload` 等逐檔隔離物；週報為 `report-<slot timestamp>.json`，索引為 `report-index.json`，本工具以 `operation.lock` 一般檔案及 kernel flock 互斥。lock 檔保持原 inode，程序結束或 crash 由核心釋放鎖；不刪別人的 lock 或以換 inode 偷取認領。共享文件只記錄可攜規則；本機絕對根路徑、完整綁定及逐檔證據保留於本地狀態，不提交到共享 repo。

## 2. 保留政策

唯讀報告固定一個 UTC 觀測時間，以 epoch 秒保存；交付收據標示 Asia/Taipei。mutation 每項及 hash 後讀取前進時鐘。天數按連續 24 小時計算；資料夾日期名稱不作活動證據。

| 對象 | 規則 |
| --- | --- |
| 執行中、置頂、目前任務、其他程序使用中的工作區 | 整個保護；共用 cwd 採所有關聯任務中最嚴格條件 |
| `outputs/`、交付成果、原始資料、人工修改、唯一成果、被任務直接連結的原件 | 持續保護；即使誤放 `work/`，或已有相同副本，也不因年齡取得清理資格 |
| `work/` 暫存 | 內容與關聯任務皆至少 30 天無活動，且引用、用途、重建能力或持續保留副本已逐檔核實，才可成為候選 |
| 非 Git 工作區的可重建快取 | 同樣適用 30 天條件及逐檔證據；不能只看 `node_modules` 或 cache 等名稱 |
| 僅含目錄的工作區 | 至少 90 天只列整理報告；本版不搬移或刪除任何目錄、工作區根或日期容器 |
| Git、符號連結、跨掛載點、硬連結、共享儲存關係未明 | 保護或待查；不跟隨連結，不讀外部目標，不對 Git 執行 clean、prune 或生命週期操作 |
| 秘密、驗證資料、來源不可讀、時間缺失／未來／語義不明、其他用途不明內容 | 保護或待查，不以推測補齊證據 |

mutation 僅支援經驗證的一般 regular file，且 link count 必須為 1。可選 `disposition: rebuildable`，提供明確來源、版本與輸入；或 `disposition: verified_copy`，提供同一 root 的 `outputs/` 內持續保留副本。副本必須是無符號連結、無硬連結的一般檔案、同檔案系統、SHA-256 相同，且核對時間在 300 秒內；這條路線不要求 rebuild。候選、祖先與工作區子樹涉及 Git 時排除；根目錄或任何路徑分量的符號連結、裝置變化和越界必須拒絕。目錄不整包隔離，即使其名稱看似暫存。副本存在不會解除原檔直接引用、人工內容或其他保護，已連結的原路徑仍須保留。

隔離保留至少 30 天，從實際成功隔離時間起算。核准最長有效 24 小時，且每項操作前重新核對。隔離不釋放同一磁碟的容量；報告須區分候選容量、隔離容量與實際磁碟可用空間。

## 3. 快照與候選資格

原生任務快照來源為 Codex `list_threads` 最近 50 筆非置頂任務及全部置頂任務，由執行者呼叫原生工具後匯出安全 metadata，CLI 本身不直接呼叫 Codex。其覆蓋範圍一律標為 `partial`：未出現在這份清單不能推論不存在、已完成、無引用或不再使用。快照的來源、取樣時間與覆蓋範圍必須隨報告保存；不讀私密任務資料庫、認證檔或其他非公開 runtime 內容來繞過缺口。prepare／quarantine 使用的快照與逐檔查核證據必須在 300 秒內，且不能來自未來；這是新鮮度要求，不代表 partial 索引因此完整。

`idle`、`notLoaded`、已封存或未命中近期索引，都不是清理資格。由此快照可以增加保護，不能單獨證成可操作候選。每個候選仍須有獨立且可取回的證據，補足：

1. 所有相關任務及直接引用已核對，原路徑未被成果連結依賴。
2. 檔案用途為暫存或經證明可重建，並非人工內容、原始資料或唯一成果。
3. 檔案與相關任務均滿足活動時間門檻；搬移、複製或還原後的 mtime 沒有被誤當實際最後使用時間。
4. 重建來源、版本、輸入及重建方法已核實，`rebuild.source` 所引用證據需包含實際重建方式；或同 root 的 outputs 內有已驗證且持續保留的相同內容副本。單純相同名稱、套件名稱或未查核的副本不構成可操作證據；副本不等於原連結已修復。
5. 操作期間具備可信的 quiet window，且證據在實際操作前仍有效。

證據不足時保持 `unknown`／待查；人工批准「可以搬」也不能把 unknown 改成「已證明無引用」。必要的內容指紋只能在已授權、非秘密的精確查核範圍內計算，metadata 盤點不因執行 scan 而全面讀取內容。

scan 只列保護與待查；prepare 另產生資格已確認候選的 manifest，批次核准獨立提供。候選資料至少綁定規則版本、根身分、相對路徑、檔案身分、內容指紋、容量口徑、來源證據、查核時間與排除原因。根身分採解析路徑、裝置、inode、類型與安全邊界；正常報告寫入造成的根目錄 mtime 改變，不應單獨讓整批失效。

## 4. 核准與操作邊界

`prepare` 僅準備具體批次，不產生使用者授權。真正隔離須引用本次對話或其他經確認的外部核准證據，綁定具體批次、逐檔身分、內容、動作、規則與有效期。CLI 不得自動 mint approval，也不得把它自己寫出的 JSON 當作使用者已同意。

核准記錄是追溯與失效核對機制，並非密碼簽章系統。原生工具的使用者授權與權限審查仍是實際執行邊界。本流程不宣稱可以對抗同一 uid 的惡意或未協調程序改寫狀態、內容與核准資料。

候選內容、inode、引用、活動、適用規則或證據改變，受影響項目的舊核准失效；根身分、安全邊界、互斥或 journal 故障則停止整批。manifest 綁定完整 evidence digest（包含 checked_at），以及排除 captured_at 的 snapshot digest；更換證據或快照實質內容必須重新 prepare 與核准。副本路線另以 `retained_copies` 綁定 source_path、副本路徑、fingerprint、sha256 與 parent_chain；核准後副本內容、inode 或父路徑變更即拒絕，隔離前再次核對副本。單純重新取得相同快照內容可以更新 captured_at，但不能更新逐檔查核日期卻沿用舊 manifest。新候選、同名新檔、還原、後續批次及永久刪除，不得沿用只涵蓋舊搬移的核准。CLI 使用實際時鐘，逐項與 hash 完成後再核對核准、新鮮度及 quiet window；固定 now 只供顯式 API 測試，不可把批次入口時間當整批永久有效時間。

批次互斥只防止本工具重入，不代表其他 Agent 或程序已停止使用來源。單次 `lsof`、inode 或路徑檢查不能消除最終檢查到 rename 之間的來源競態；必須有可信且仍有效的 quiet window。無法證明時維持報告模式，不自動殺程序、提高權限、解除保護或擴大 scope。

## 5. 隔離、還原與中斷核對

每項操作前先保存可復原 journal，記錄批次、核准來源、規則、原位置、唯一隔離位置、檔案身分、內容指紋與狀態；紀錄落盤失敗即停止。journal 狀態為 `pending`、`quarantined`、`restoring`、`restored`、`conflict`。檔案核對包含裝置、inode、size、mtime、mode、link count 與 SHA-256；prepare 另外記錄 ctime 以偵測準備後變動。rename 可能改變 ctime，因此搬移後以其餘受保護欄位核對，不宣稱可保持 ctime 不變。

隔離必須同檔案系統、不覆寫既有目標。macOS 使用 `renameatx_np` 與 `RENAME_EXCL=0x00000004`（十進位 4）；該常數與函式宣告已核對 Apple XNU 的 [`bsd/sys/stdio.h`](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/sys/stdio.h)。Linux 使用 `renameat2` 的 `RENAME_NOREPLACE`（flags 1）。平台不支援時拒絕 mutation，不降級成會覆寫的 rename，也不改做跨磁碟 copy-then-delete。這些機制保護目標不被覆寫，不消除來源 inode 的最終競態，因此 quiet window 仍為必要條件。Darwin 的實機驗收結果另見版本綁定收據，不能只用常數正確取代執行證據。

成功後記錄實際完成時間與結果，保留還原所需內容、必要 metadata 和證據。中斷後 `recover` 逐項核對兩端：

| 來源與隔離端 | 處置 |
| --- | --- |
| 來源仍在、隔離端不存在，且來源吻合 | 原 pending 維持 pending，不重播，再次搬移重新 prepare 與核准；原 restoring／restored 確認 restored；原 quarantined 卻回到來源則列 conflict |
| 來源不存在、隔離端吻合 | 補記已完成；無可信原完成時間時，從本次確認時間重新起算隔離保留期 |
| 兩端都有、兩端都無、任一身分或指紋不符 | 衝突；不刪任一端、不盲目重跑、不自動改名繞過 |

還原前核對隔離內容、journal、父路徑身分與範圍。原路徑已存在時停止該項，絕不覆寫、合併或另取新名稱。成功還原須查核內容、必要 metadata 與原連結，並留收據；還原造成的活動時間語義不得立刻用來取得下一次清理資格。

本版不實作永久刪除。`purge` 必須明確拒絕；不自動清空隔離區或系統垃圾桶，不因保留滿 30 天、兩次報告已完成或磁碟空間不足而升級授權。報告也不自動依年齡刪除；近 90 天可作顯示與盤點視窗，實際歷史紀錄處置另行核定，未完成批次所需證據持續保留。

## 6. CLI 責任

已以實際 `--help` 核對位置引數 `action`，支援 `scan`、`prepare`、`quarantine`、`restore`、`recover`、`report`、`policy`、`purge`。下表列最小必要輸入；所有讀取 JSON 的路徑都須指向核定的本地一般檔案。

| 子命令 | 責任與最小 CLI 輸入 |
| --- | --- |
| `policy` | 不須 `--root`；顯示適用規則、版本與 policy hash |
| `scan` | `--root`，可加 `--snapshot`；metadata-only，預設只輸出 stdout |
| `prepare` | `--root --snapshot --evidence`；核對逐檔證據、讀取核定候選內容計算 hash，產生 manifest，不搬移或產生核准 |
| `quarantine` | `--root --snapshot --evidence --manifest --approval`；逐項資格及核准重核通過後隔離，產生 batch journal |
| `restore` | `--root --batch-id --approval`；restore 核准另外綁該 batch，還原整批中已隔離項目，禁止覆寫／合併／改名 |
| `recover` | `--root --batch-id`；核對 journal 與兩端事實並更新狀態，不搬移 payload，不自動重播 |
| `report` | `--root`，可加 `--snapshot`；產生當下唯讀週報與去重索引，不搬移 |
| `purge` | 明確拒絕；此版本沒有永久刪除能力 |

`--state-dir` 預設為 `target_root/.workspace-cleanup`，不能改成任意位置。`--output` 僅適用 scan／prepare，以 exclusive-create 寫新 JSON，已存在檔案拒絕覆寫；操作規則要求輸出到明確核定位置，不得使用使用者內容路徑。`--summary` 只移除 stdout 的逐檔與逐工作區清單，不改完整 `--output` 或 report 儲存內容。成功 exit 0，拒絕、輸入或 I/O 錯誤以 JSON 寫 stderr 並 exit 2；recover 即使回 exit 0，也須讀取每項 `state`，不能忽略 conflict。程式沒有清理資料的全域 force 旗標。

scan／report 的「唯讀」指不修改使用者內容、任務、排程或隔離內容；scan 預設 stdout，report 只向核定 `.workspace-cleanup` 位置寫報告、索引及短期互斥。系統讀取可能造成的 atime 更新不應被誤判為工具修改內容；內容、mtime 等變更資訊仍須按驗收查核。scan 只區分 `protected` 和 `unknown`，`summary.eligible_files` 固定為 0；通過時間門檻的 `time_filtered_files` 不等於可操作候選，資格由 prepare 的獨立證據決定。

### 6.1 輸入與輸出契約

時間欄位使用有限數值的 Unix epoch 秒，不接受布林值作時間。以下列實作消費的必要欄位；證據內容必須由執行者實際核實，不因 JSON 型別正確就成立。

| 資料 | 欄位與責任 |
| --- | --- |
| snapshot | `captured_at`、`coverage`、`threads`；可有 `protected_paths`。thread 含 `cwd`、`active`、`pinned`、`last_activity_at`，只保存清理必要 metadata。`coverage` 為 `partial`；缺快照仍可 scan，但 prepare 拒絕 |
| evidence 頂層 | `root_identity: {dev, ino}`、`checked_at`、`source`、`items`；source 指向可取回的真實查核證據，不由 CLI 假造 |
| evidence 每項共同欄位 | `path` 相對根路徑；`references_verified`、`unreferenced`、`not_in_use`、`activity_confident` 均須 true；`manual_edits`、`unique` 均須 false；`purpose` 必須 temporary；另含 `last_activity_at`、`quiet_until` 與 disposition |
| 重建路線 | `disposition: rebuildable`、`rebuild: {source, version, inputs}`；三項重建欄位均須非空文字並對應實際證據 |
| 副本路線 | `disposition: verified_copy`、`copy: {path, verified_at, retained: true}`；path 為同 root 的 outputs 內相對檔案路徑，verified_at 須在 300 秒內。可省略 rebuild；副本不參與搬移 |
| quiet window | `quiet_until` 晚於當下、不得超出 checked_at 後 24 小時；實際安靜時段的來源與協調由 evidence.source 指向。時間值本身不會阻止其他程序寫檔 |
| manifest | `schema_version: 1`、`created_at`、`root_identity`、`root_path`、`policy_hash`、`evidence_digest`、`snapshot_digest`、`items`、`retained_copies`、`digest`；items 含 path、fingerprint、sha256、parent_chain；retained_copies 含 source_path、path、fingerprint、sha256、parent_chain。manifest 最長 24 小時，quarantine 拒絕空批次及身分／內容／證據／副本不符 |
| approval | `schema_version: 1`、`action`（quarantine 或 restore）、`manifest_digest`、`authorized_by`、`authority_ref`、`issued_at`、`expires_at`；restore 額外含 `batch_id`。資料只是外部核准的收據，不能由程式自行授權 |
| journal | schema 1、batch/root/policy/manifest 綁定、完整 manifest、核准收據與逐項位置、指紋、狀態；讀回核對 manifest digest 及逐項身分，成功隔離增加 quarantined_at／minimum_retention_until，還原增加 restored_at，中斷核對可增加 recovery_note |
| report.storage | `filesystem_available_bytes` 為檔案系統對目前使用者可用的 bytes；`quarantine_payload_files` 與 `quarantine_logical_bytes` 為隔離區 payload 檔案數與邏輯容量。它們和 scan 的 logical／allocated bytes 分列，不把搬入隔離區誤稱釋放空間 |

Public API 為 `scan(root, now=None, snapshot=None)`、`prepare(root, evidence, snapshot=None, now=None)`、`quarantine(root, state_dir, manifest, approval, evidence, snapshot=None, now=None)`、`restore(root, state_dir, batch_id, approval, now=None)`、`recover(root, state_dir, batch_id, now=None)`、`scheduled_report(root, state_dir, snapshot=None, now=None)` 和必拒絕的 `purge(...)`。CLI `report` 呼叫 scheduled_report；測試可透過 API 固定 now，CLI 不暴露改時鐘旗標。直接 API 呼叫不繞過原生工具授權與權限邊界。

### 6.2 合成輸入形狀範例

以下只在系統暫存目錄建立自己的已知測試資料、產生 snapshot／evidence 並呼叫 prepare；不建立使用者核准、不隔離真實資料。測試證據中的 true／false 來自本範例完全控制的 fixture，禁止複製到真實工作區當成人工查核結果。執行前 `COLLAB` 應已解析為共享根路徑。

```python
import importlib.util
import os
from pathlib import Path
import tempfile
import time

entry = Path(os.environ["COLLAB"]) / "harness-mc/scripts/codex_workspace_cleanup.py"
spec = importlib.util.spec_from_file_location("cleanup_fixture", entry)
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)

with tempfile.TemporaryDirectory(prefix="codex-cleanup-fixture-") as scratch:
    root = Path(scratch).resolve()
    rel = "2000-01-01/fixture/work/rebuild.txt"
    target = root / rel
    target.parent.mkdir(parents=True)
    target.write_bytes(b"fixture\n")
    now = time.time()
    old = now - 31 * 86400
    os.utime(target, (old, old))
    snapshot = {
        "captured_at": now, "coverage": "partial",
        "threads": [], "protected_paths": [],
    }
    evidence = {
        "root_identity": cleanup.scan(root, now=now)["root_identity"],
        "checked_at": now, "source": "synthetic-fixture-only",
        "items": [{
            "path": rel, "references_verified": True, "unreferenced": True,
            "not_in_use": True, "activity_confident": True,
            "manual_edits": False, "unique": False, "purpose": "temporary",
            "last_activity_at": old, "quiet_until": now + 60,
            "disposition": "rebuildable",
            "rebuild": {"source": "regenerate known bytes: fixture plus newline",
                        "version": "fixture-v1", "inputs": "none"},
        }],
    }
    manifest = cleanup.prepare(root, evidence, snapshot=snapshot, now=now)
    assert len(manifest["items"]) == 1
    assert target.read_bytes() == b"fixture\n"

    # 第二條路線：fixture 自行建立相同的受保護 outputs 副本。
    copy_rel = "2000-01-01/fixture/outputs/retained.txt"
    retained = root / copy_rel
    retained.parent.mkdir(parents=True)
    retained.write_bytes(target.read_bytes())
    item = evidence["items"][0]
    item.pop("rebuild")
    item["disposition"] = "verified_copy"
    item["copy"] = {"path": copy_rel, "verified_at": now, "retained": True}
    copied_manifest = cleanup.prepare(root, evidence, snapshot=snapshot, now=now)
    assert len(copied_manifest["retained_copies"]) == 1
    assert retained.read_bytes() == target.read_bytes()
```

這只是資料形狀與不搬移的 prepare 範例，不是整體驗收收據，也沒有產生可用的 user approval。

## 7. 週期盤點與通知

週期執行層採原生 Codex 本任務 heartbeat，每週日 10:00，Asia/Taipei。只能透過正式 automation 工具建立／更新與讀回；不得手寫 automation 資料或新增 OS cron。實際 automation 為 `codex`／ACTIVE／本任務 heartbeat，時區與設定讀回收據見第 8 節。

前兩次完整執行只做 report，之後仍維持 report 模式；執行次數永遠不構成搬移授權。隔離、還原與 purge 不設無人確認的週期工作。

電腦離線、休眠或工具不可用時，不能宣稱到期工作成功。恢復後最多補一次當下 report，不重播所有缺失週次或任何舊清理清單；同一到期時段重複喚醒應跳過，失敗與尚未完成的時段不可假記成功。平台是否確實會喚醒、補跑與送達，須以原生排程讀回及實際執行觀測核實；本地排程模型測試不能證明平台已完成離線送達。

整體通知政策為只在新的可處理候選、容量異常、失敗、具體核准批次完成或需要決策時通知。現有 scheduled_report 在新的非空掃描錯誤簽名，或相較上一次週報的 logical bytes 增加至少 250 MiB（262,144,000 bytes）時回 `notify: true`；閾值來源是 `POLICY.growth_alert_bytes`。重複時段回 false，初次盤點沒有增長基線，不把總容量當成一次增長。它不自行送通知，也不將 scan 的時間候選升格為已確認候選；prepare 後的新候選與人工批次完成由具體操作的執行者回報。heartbeat 執行者須依本規則解讀結果，首次揭露索引覆蓋缺口，對已知且無變化的 unknown 保持安靜。不聯絡第三人，不另選外部收件平台。

## 8. 對來源計劃 11 項驗收的映射

來源為計劃 §5.1；以下沿用原列順序，以 CWC-A01～A11 作本工具測試映射，尚非中央 acceptance matrix 配號。不得刪除原列要求，亦不得以程式測試取代另需外部觀測的項目。實際結果與版本指紋見本節收據；mapping 名稱只供此工具對照，未冒用中央配號。

| 映射 | 原計劃條件 | 所需驗證與證據 |
| --- | --- | --- |
| CWC-A01 | 唯讀模式 | 合成來源前後內容及 mtime 等 metadata 一致；僅核定狀態區有輸出；無 task／排程／清理 mutation；atime 例外明列 |
| CWC-A02 | 活躍、置頂、共用 cwd、未知引用 | 完整／partial 快照、未命中、跨任務引用和共用 cwd 反例；保護優先，未知不成可操作候選 |
| CWC-A03 | `work/` 中唯一成果或已連結原件 | 唯一檔、人工內容、有相同副本但原件被連結全部排除操作；另驗無引用的暫存可採受保護相同副本，副本內容／inode／父路徑變更使核准失效 |
| CWC-A04 | 30／90 天邊界、未知／未來時間 | 固定 UTC 門檻前後、時區與還原保留 mtime 反例；年齡不能補足缺少的活動證據；空目錄只報告 |
| CWC-A05 | Git、符號連結與範圍 | `.git` 檔／目錄、祖先與 nested Git、逃逸連結、硬連結、裝置變化及路徑替換；無外部目標讀寫 |
| CWC-A06 | 核准過期、內容變動與並行執行 | 24 小時有效期、改檔、換 inode、任務恢復、規則／引用變化與第二個執行者；失效、互斥及 quiet window 缺失拒絕 |
| CWC-A07 | 隔離與中斷 | journal 寫入前後、rename 前後、完成回寫失敗注入；兩端與指紋可判定，未知成功時間保守重算 |
| CWC-A08 | 還原與原路徑衝突 | 普通檔內容及必要 metadata 還原；原路徑新檔、父路徑替換與不符指紋皆保留衝突，無覆寫 |
| CWC-A09 | 永久刪除與保留期 | 未滿 30 天、只有搬移核准、磁碟不足、滿 30 天四類；purge 皆拒絕，無自動清空 |
| CWC-A10 | 排程離線／補跑／重複喚醒 | 固定時鐘模擬缺跑、恢復一次、同到期時段重複、前兩次後仍唯讀；原生排程啟用／送達另有平台證據 |
| CWC-A11 | 成果與舊任務 | 合成任務或已核准樣本的成果指紋與原連結驗證；實際資料只做核定查核，失敗停止批次並依有效核准還原 |

驗收收據須綁定實際受測程式、政策與輸入 schema 的版本／指紋，列出命令、結果、適用範圍和未驗證部分。至少一次由非實作者獨立核對原計劃與反例；修改後重新執行受影響的測試。真實逐檔引用與 quiet window 未取得時，可以完成唯讀工具和合成 mutation 測試，但不能把真實搬移試行寫成已通過。

2026-09-07 正式路徑主代理與獨立驗收者均執行 `python3 $COLLAB/harness-mc/scripts/verify_codex_workspace_cleanup.py`：61 tests 全數通過，exit 0。程式 SHA-256 `ede659b8ff08e947444c7ddb3d9c2d8aa5d17dfa2eff8df785e89ef20419e75e`，測試 SHA-256 `0797455d68bf2eefe76d8170919d06b0b749a3dfa919f7e07b55433d43d64229`，policy hash `52e9ac265c7379c25936b00d8639c75a8aa8474006939b57226e758e8e2f28d0`。包含最後補測的副本查核在 hash 期間到期必須拒絕搬移。

一次性完整驗收收據位於 `$CODEX_WORKSPACE_ROOT/2026-09-07/new-chat-2/outputs/codex-workspace-cleanup-acceptance.json`；原測試輸出為同 outputs 目錄 `codex-workspace-cleanup-tests.txt`。CWC-A01～A11 的本地程式／合成條件均有測試；A05 的 Linux／實體掛載及 A10 的未來定時喚醒／離線送達保持未觀測，不以 fixture 替代。

正式 runner 已產生第 1 份真實唯讀週報，155 個工作區、15,248 個一般檔案、1,426,651,938 邏輯 bytes、掃描錯誤 0、合格候選 0；17,739 筆使用者樹 metadata 前後變動 0。同 slot 重跑回 duplicate=true，報告數仍為 1。裁剪 Git metadata 和私密子樹，不與舊全樹掃描直接計算清理收益。真實使用者檔案隔離／還原／刪除 0，既有三份 outputs 保持存在且可讀。

原生 automation `codex` 為本任務 heartbeat，ACTIVE，每週日 10:00 Asia/Taipei；已由 create／view 及設定檔讀回核對目標任務與時段。下一次預定時段為 2026-09-13 10:00 +08:00，尚未實際發生。排程只執行 report，不自行核准或啟動 mutation。

## 9. 交付與正式承接

完成範圍分開記錄：程式與合成測試、實際唯讀盤點、原生排程啟用／執行、具體真實批次核准與試行、中央 task／registry／admission 承接。沒有證據的部分保持未完成或 unknown，不用其他層級的成功取代。

中央 owner 交接後，整合者再核對最新 canonical tasks 的問題、owner、輸入輸出與生命週期，依既有流程確定同一正式工作身份。不得把 Git commit-cleanup 的既有 task 當成磁碟清理 owner，不重編既有任務，不借同檔不同 hunk 修改他方內容。工作本新入口的 helper 存在或測試通過，不等同於本案已取得可信 runtime gate、中央回寫與 live-system admission。

正式 policy、實作、實際證據和 task 引用一致後，才更新來源臨時計劃的承接狀態；保留原計劃及歷史審查。commit、push、部署與對外同步按本次實際授權分別處理，不由政策實作自動取得。

後續變更 target_root 身分、Codex 索引行為、平台介面、保留規則、schema 或安全邊界時，重新檢查政策、資格證據與受影響驗收。來源與能力失效時先停止相關 mutation，保留所有內容、journal、隔離物及可用 reader，不刪 pending 資料以消除阻塞。
