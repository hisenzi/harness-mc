# Codex 工作區盤點與受控清理

狀態：本地操作規格 v1.1，更新 2026-11-09。已修復重開機後的週報身分誤判與大型索引讀取，完成本次自行驗收及真實唯讀補跑。每次只列項目，由 Vincent 決定是否清理；本輪沒有真實清理授權。MorroWise 系統歸屬已確認，正式需求與驗收入口已建立為 [hisenzi/harness-mc#12](https://github.com/hisenzi/harness-mc/issues/12)；registry／live admission 未完成，見 §9。

操作規格正本：`$COLLAB/harness-mc/system-workflow/docs/specs/codex-workspace-cleanup.md`。來源計劃為 `$COLLAB/notyet-harness/100_Todo/plan/2026-09-07-codex-workspace-cleanup-plan.md` v0.4（保留 v0.2 原始標準與 v0.3 歷史驗收）；承接其保護、逐項核准、可復原與未知即停止的要求。正式政策承接後，來源計劃保留歷史與此正本引用，不作每週追蹤表。

## 1. 責任與範圍

本流程管理 Vincent 指定的 Codex 日期工作區根目錄 `target_root`，提供唯讀盤點、候選準備，以及經具體核准後的逐檔隔離、還原與中斷核對。主動盤點、政策與 runner 的系統 owner 為 MorroWise；新的需求與驗收入口是 `hisenzi/harness-mc` GitHub Issue。`milestones/` 自 2026-10-26 凍結為唯讀歷史，不再等待 tasks.json 配號或回寫。2026-11-09 查重後依 Vincent 明確授權建立 [hisenzi/harness-mc#12](https://github.com/hisenzi/harness-mc/issues/12)，承接本案需求、修復與驗收；查詢與後續邊界見 §9。capability registry／live-system admission 尚未接通，不能將本地週報成功稱為 MC 整體接線完成。

能力由 Python 標準函式庫實作，正式入口為 `$COLLAB/harness-mc/scripts/codex_workspace_cleanup.py`；驗收入口為 `$COLLAB/harness-mc/scripts/verify_codex_workspace_cleanup.py`。`POLICY` 常數是執行規則來源，`policy` 子命令輸出規則與 `policy_hash`；本文說明用途、操作契約與限制，不另維護不同的規則值。不得修改他方擁有的中央 task、registry、preflight 或 event 程式來替本案取得通過狀態。

本地唯一狀態目錄為 `target_root/.workspace-cleanup`，包含核定的報告、快照、準備批次、journal、隔離內容和還原收據。它須為目前使用者擁有的一般目錄、權限 `0700`、與 `target_root` 同一檔案系統，並永久排除於候選掃描。批次位於 `<32 位十六進位 batch_id>/`，含 `journal.json` 與 `000000.payload` 等逐檔隔離物；週報為 `report-<slot timestamp>.json`，索引為 `report-index.json`，持久報告綁定收據為 `report-root-binding.json`。本工具以 `operation.lock` 一般檔案及 kernel flock 互斥。lock 檔保持原 inode，程序結束或 crash 由核心釋放鎖；不刪別人的 lock 或以換 inode 偷取認領。共享文件只記錄可攜規則；本機絕對根路徑、完整綁定及逐檔證據保留於本地狀態，不提交到共享 repo。

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

原生任務快照來源為 Codex `list_threads` 最近 50 筆非置頂任務及全部置頂任務，由執行者呼叫原生工具後匯出安全 metadata，CLI 本身不直接呼叫 Codex。其覆蓋範圍一律標為 `partial`：未出現在這份清單不能推論不存在、已完成、無引用或不再使用。快照的來源、取樣時間與覆蓋範圍必須隨報告保存；不讀私密任務資料庫、認證檔或其他非公開 runtime 內容來繞過缺口。report／prepare／quarantine 使用的快照，以及 mutation 的逐檔查核證據，都必須在 300 秒內，且不能來自未來；這是新鮮度要求，不代表 partial 索引因此完整。

快照每筆僅保存 cwd、active、pinned、last_activity_at；active 原生狀態映為 true、idle 映為 false，其餘為 null；updatedAt 毫秒轉秒。缺少 cwd 的任務在 report 保留 null 並計入 unlocatable_threads，不補造工作目錄；prepare／quarantine 仍拒絕無法定位的任務。原生來源不可取得時停止，不用舊取樣時間冒充新資料。

`idle`、`notLoaded`、已封存或未命中近期索引，都不是清理資格。由此快照可以增加保護，不能單獨證成可操作候選。每個候選仍須有獨立且可取回的證據，補足：

1. 所有相關任務及直接引用已核對，原路徑未被成果連結依賴。
2. 檔案用途為暫存或經證明可重建，並非人工內容、原始資料或唯一成果。
3. 檔案與相關任務均滿足活動時間門檻；搬移、複製或還原後的 mtime 沒有被誤當實際最後使用時間。
4. 重建來源、版本、輸入及重建方法已核實，`rebuild.source` 所引用證據需包含實際重建方式；或同 root 的 outputs 內有已驗證且持續保留的相同內容副本。單純相同名稱、套件名稱或未查核的副本不構成可操作證據；副本不等於原連結已修復。
5. 操作期間具備可信的 quiet window，且證據在實際操作前仍有效。

證據不足時保持 `unknown`／待查；人工批准「可以搬」也不能把 unknown 改成「已證明無引用」。必要的內容指紋只能在已授權、非秘密的精確查核範圍內計算，metadata 盤點不因執行 scan 而全面讀取內容。

scan 只列保護與待查；prepare 另產生資格已確認候選的 manifest，批次核准獨立提供。候選資料至少綁定規則版本、根身分、相對路徑、檔案身分、內容指紋、容量口徑、來源證據、查核時間與排除原因。mutation 及同一次執行仍嚴格核對路徑、裝置、inode、類型與安全邊界。跨次 report 的持久身分另依 §7.1；正常報告寫入造成的根目錄 mtime 改變，不應單獨讓整批失效。

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
| `report` | `--root --snapshot`；新鮮 partial 原生快照必要，產生當下唯讀週報、待決清單與去重索引，不搬移 |
| `purge` | 明確拒絕；此版本沒有永久刪除能力 |

`--state-dir` 預設為 `target_root/.workspace-cleanup`，不能改成任意位置。`--output` 僅適用 scan／prepare，以 exclusive-create 寫新 JSON，已存在檔案拒絕覆寫；操作規則要求輸出到明確核定位置，不得使用使用者內容路徑。`--summary` 移除 stdout 的 scan.files、scan.workspaces 與 review.items，保留 review.groups 容量摘要；完整項目仍在週報 JSON。週報索引讀取與新報告寫入上限同為 512 MiB，超限 exit 2 並保留舊報告；其他 JSON 證據輸入仍限 100 MiB。成功 exit 0，拒絕、輸入或 I/O 錯誤以 JSON 寫 stderr 並 exit 2；recover 即使回 exit 0，也須讀取每項 `state`，不能忽略 conflict。程式沒有清理資料的全域 force 旗標。

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

Public API 為 `scan(root, now=None, snapshot=None)`、`prepare(root, evidence, snapshot=None, now=None)`、`quarantine(root, state_dir, manifest, approval, evidence, snapshot=None, now=None)`、`restore(root, state_dir, batch_id, approval, now=None)`、`recover(root, state_dir, batch_id, now=None)`、`scheduled_report(root, state_dir, snapshot=None, now=None, *, accept_legacy_index=None, authority_ref=None)` 和必拒絕的 `purge(...)`。CLI `report` 呼叫 scheduled_report；測試可透過 API 固定 now，CLI 不暴露改時鐘旗標。直接 API 呼叫不繞過原生工具授權與權限邊界。

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

2026-11-09 Vincent 再次明確要求：先不實際清理，每次只列出項目，由 Vincent 決定是否清理。前兩次及其後所有週次均維持 report 模式；執行次數永遠不構成搬移授權。隔離、還原與 purge 不設無人確認的週期工作。

電腦離線、休眠或工具不可用時，不能宣稱到期工作成功。恢復後最多補一次當下 report，不重播所有缺失週次或任何舊清理清單；同一到期時段重複喚醒應跳過，失敗與尚未完成的時段不可假記成功。平台是否確實會喚醒、補跑與送達，須以原生排程讀回及實際執行觀測核實；本地排程模型測試不能證明平台已完成離線送達。

每份報告的 `review.items` 列出尚未受已知保護條件排除、且通過 30 天 mtime 門檻的 work／cache 檔案，包含相對路徑、工作區、類別、容量、mtime 與 `needs_evidence_and_user_decision` 狀態；`review.groups` 按工作區與類別彙總，`[cache]` 是分類標籤而非真實目錄。完整引用、用途／重建或保留副本、所有任務與程序活動、逐項核准均未補齊時，清單只是待查，`cleanup_authorized=false` 且 `eligible_files=0`。資料夾沿用 scan.workspaces 的 90 天只報告欄位，不授權刪除或整包搬移。

`notify` 在非空待決項目清單改變、新的非空錯誤簽名，或相較上次成功報告的 logical bytes 增加至少 250 MiB 時為 true；相同週次直接回 false。初次盤點無容量增長基線。`growth_basis=since_previous_report`；只有 `weekly_growth_known=true` 才能稱為單週差額，缺跑後不得把跨週累積誤報成單週增長。通知只列待查項目、證據缺口與報告連結，由 Vincent 決定下一步；不得把清單當清理核准。已知且未變的索引缺口或同一不可處理狀態保持安靜，不聯絡第三人。

### 7.1 重開機與根目錄身分

macOS 的 st_dev 是執行時裝置編號，不作跨重開機的唯一持久身分。report 使用 `fgetattrlist(ATTR_VOL_INFO | ATTR_VOL_UUID)` 取得磁碟區 UUID，連同固定根路徑、根目錄 inode／建立時間、狀態目錄 inode／建立時間，存入私有 `report-root-binding.json`。原生介面依 [Apple getattrlist 說明](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/getattrlist.2.html) 與本機 SDK sys/attr.h 核對。無 UUID 或建立時間就停止；非 Darwin 平台保留 strict_device 綁定，不宣稱已支援跨開機穩定身分。

每次快照寫入前先核對該收據的 `scope=report_only` 與現行 binding，拒絕符號連結、錯誤擁有者及狀態目錄非 0700；寫入快照須一般單一連結檔案且 0600。同一次報告開始與寫入前仍核對 st_dev／inode、持久身分及持鎖的狀態目錄；真正換磁碟區、換根或換狀態目錄都停止。所有 mutation 的 dev／inode、manifest、evidence 與核准檢查保持原有嚴格規則。

舊 index 沒有磁碟區 UUID，不能自動推定歷史連續性。第一次遷移必須有人明確授權，僅於人工修復時對 report 傳入 `--accept-legacy-index <舊 index canonical JSON SHA-256> --authority-ref <該次人類指示>`；原 inode 必須相同。收據保存舊身分、舊 index digest、新身分、接受時間、policy hash 與指示來源；歷史 report 不改寫。這兩個旗標只適用 report，不授權資料搬移。已有持久收據時，不得用旗標覆寫不符身分；每週 heartbeat 明確禁止使用它們。索引摘要是 `_digest` 的 canonical JSON SHA-256，與整個檔案位元組 SHA-256 不同。

排程先核對 §8.1 的正式 runner 指紋與 policy hash，再以 `sys.dont_write_bytecode=True` 載入既有檢查函式。來源、工具或身分失效時停止，不自行換 runner、重綁、重設狀態或補寫成功。後續核准修改 runner 時須一起更新排程指紋並重驗正式入口。

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

以下為 2026-09-07 歷史收據，僅證明當時版本，不作目前狀態：

2026-09-07 正式路徑主代理與獨立驗收者均執行 `python3 $COLLAB/harness-mc/scripts/verify_codex_workspace_cleanup.py`：61 tests 全數通過，exit 0。程式 SHA-256 `ede659b8ff08e947444c7ddb3d9c2d8aa5d17dfa2eff8df785e89ef20419e75e`，測試 SHA-256 `0797455d68bf2eefe76d8170919d06b0b749a3dfa919f7e07b55433d43d64229`，policy hash `52e9ac265c7379c25936b00d8639c75a8aa8474006939b57226e758e8e2f28d0`。包含最後補測的副本查核在 hash 期間到期必須拒絕搬移。

一次性完整驗收收據位於 `$CODEX_WORKSPACE_ROOT/2026-09-07/new-chat-2/outputs/codex-workspace-cleanup-acceptance.json`；原測試輸出為同 outputs 目錄 `codex-workspace-cleanup-tests.txt`。CWC-A01～A11 的本地程式／合成條件均有測試；A05 的 Linux／實體掛載及 A10 的未來定時喚醒／離線送達保持未觀測，不以 fixture 替代。

正式 runner 已產生第 1 份真實唯讀週報，155 個工作區、15,248 個一般檔案、1,426,651,938 邏輯 bytes、掃描錯誤 0、合格候選 0；17,739 筆使用者樹 metadata 前後變動 0。同 slot 重跑回 duplicate=true，報告數仍為 1。裁剪 Git metadata 和私密子樹，不與舊全樹掃描直接計算清理收益。真實使用者檔案隔離／還原／刪除 0，既有三份 outputs 保持存在且可讀。

原生 automation `codex` 為本任務 heartbeat，ACTIVE，每週日 10:00 Asia/Taipei；已由 create／view 及設定檔讀回核對目標任務與時段。下一次預定時段為 2026-09-13 10:00 +08:00，尚未實際發生。排程只執行 report，不自行核准或啟動 mutation。

### 8.1 2026-11-09 恢復與自行驗收

根因證據：9 月的紀錄與 10／11 月失敗記錄中根 inode 相同、st_dev 先後變動；本機 reboot 紀錄為 09-29 與 10-29，分別先於首次及再次裝置編號改變。舊報告未存 UUID，無法倒推證明歷史磁碟區完全一致；本次以 Vincent 明確的恢復指示，對已查核現況與舊 index digest 建立一次 report-only 綁定。完整機器值留在本機收據，不寫入共享規格。

- 最終 runner SHA-256：`24fa076be031db595d841da66d0fded396d884ae0564ab3c7e3129fd701aa28e`。
- verifier SHA-256：`f7f8aa8757369dfed52822ff4e1c1879f607a1e09705862fb8eb2cc22bd6aa8f`；原命令實跑 70 tests 全通過。原 61 項保留，新增報告遷移、跨開機持久身分、替換／symlink／provider failure、快照新鮮度與缺 cwd、清單不授權、大於 100 MiB 報告讀回反例。先觀察相應 RED，再修復並通過。
- policy hash 維持 `52e9ac265c7379c25936b00d8639c75a8aa8474006939b57226e758e8e2f28d0`，未放寬清理資格。
- 真實補跑只建立 11-08 到期時段的一份報告，累計 5 份，跳過中間 5 個缺跑時段；378 個工作區、268,461 個一般檔案、18,602,293,364 logical bytes、錯誤 0、合格清理項目 0。75 筆原生最小 metadata 為 partial，20 筆 cwd 無法定位，均保留未知。
- 本次待查清單為 43,061 個檔案、68 組、3,659,035,165 logical bytes；不是可回收保證，也不是核准批次。容量比 09-27 累積增加 14,262,742,867 bytes，不能稱為單週增長。
- 補跑前後 268,875 筆使用者檔案 metadata 差異 0；四份舊 report SHA-256 全部相同；真實隔離、還原、刪除為 0。
- 完成大型 reader 修正後，再以最終 runner 正式 CLI 與新原生快照執行同一週次：exit 0、duplicate=true、notify=false、report_count=5，index SHA-256 未變。狀態目錄 0700，snapshot、binding、index、lock 0600。
- 原生 automation `codex` 保留同一任務、ACTIVE、每週日 10:00 Asia/Taipei。已更新並讀回新指紋、穩定身分、只列清單及逐項決策規則；下一次排定時段為 11-15，尚未觀測到未來喚醒，不以設定讀回冒稱未來送達。

本次證據入口為 `$CODEX_WORKSPACE_ROOT/2026-09-07/new-chat-2/outputs/2026-11-09-codex-cleanup-recovery.md`，包含 runner／測試與補跑版本差異、完整 JSON 收據、清單 CSV 及原生排程讀回。這是執行者自行驗收，沒有新增獨立複核或 Vincent 最終驗收的聲稱。9 月的獨立驗收只適用歷史版本。

## 9. 交付與正式承接

本地週報與排程恢復、規格更新及正式 Issue [hisenzi/harness-mc#12](https://github.com/hisenzi/harness-mc/issues/12) 建立／讀回已完成；完整 MC capability registry／generated read model／surface／verifier／live admission 仍未接通。不能只因本文或本地 CLI 存在就宣稱 MorroWise 平台能力 ready。本輪只修改本案 runner、verifier、正式規格與來源計劃；不回寫已凍結的 milestones，也不修改他方 dirty 或中央 registry。

2026-11-09 透過 GitHub 原生連接器查 `repo:hisenzi/harness-mc is:issue`，分別以 `codex_workspace_cleanup`、Codex、清理查詢；未找到對應清理 Issue。搜尋命中的 [#9](https://github.com/hisenzi/harness-mc/issues/9) 是 project-write hook 的記憶／scratchpad 例外，[#8](https://github.com/hisenzi/harness-mc/issues/8) 是其他既有 verifier 故障，問題與輸入輸出均不同，不能冒掛。該查詢為建單前觀測。同日 Vincent 後續明確要求「建立對應的 MorroWise Issue，寫入這次修復與驗收結果，然後 commit」，已依授權建立 #12 並讀回正文與 open 狀態。

本案唯一 Issue 為 [hisenzi/harness-mc#12](https://github.com/hisenzi/harness-mc/issues/12)「[MorroWise] Codex 每週唯讀盤點：根目錄身分修復與逐項清理決策」。正文已記錄根因、修復、70 項自行測試、真實補跑、同週去重、保護不變項、來源指紋及未驗證限制；Git commit SHA 與 delivery 狀態回該單證據留言，不在本文回填自我 hash。系統責任 MorroWise，本輪實作與自行驗收由 Codex 執行；Vincent 保留最終確認與逐項清理決策，Issue 在確認前保持 open。

本輪完成條件是 Issue 能追溯本規格、正式入口、受測版本與真實週報，且精準本機 commit 不吸收其他工作。完整 capability registry／read model／surface／verifier 平台接線仍未執行；日後若擴充，先由 Vincent 選定範圍與具名 owner，不因建單或 commit 自動啟動，也不取得清理授權。

原計劃保持 temporary／non-canonical，指向本文並保留歷史；待未完成事項取得正式去向才判斷退場。commit、push、部署、Issue 寫入與外部同步依本次明確授權分開處理。本輪已取得 Issue 建立／證據回寫及精準本機 commit 授權；實際 Git 結果以 #12 的證據留言為準。push 未授權，不宣稱遠端程式已交付。

後續變更 target_root、Codex 索引、平台介面、保留規則、schema 或安全邊界時，重新檢查受影響驗收與排程指紋。來源失效先停止相關動作，保留所有使用者內容、歷史報告、journal 與可用 reader，不刪資料消除阻塞。
