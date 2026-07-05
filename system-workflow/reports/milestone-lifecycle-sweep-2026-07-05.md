# Milestone Lifecycle Sweep v1 — 裁決表

> Status: adjudicated & executed（scope 收窄至賈維斯家族 5 projects；執行紀錄見文末；全量盤點保留為後續批次 evidence）
> Owner: Vincent
> Source boundary: this report is JV-01 evidence; canonical task/project state remains in `$COLLAB/harness-mc/milestones/*/`
> Updated: 2026-07-05
> Task anchor: `$COLLAB/harness-mc/milestones/morrowise/tasks.json#milestone-lifecycle-sweep-v1`（JV-01）
> 資料來源：merged view（public/data/projects.json，含 state overlay）＋ 各 project.json decisions 考掘＋ git log 觸及日。數字分歧處以 merged view 為準。

## 盤點總覽（2026-07-05）

- 36 個 project 目錄；35 個在 read model（`agnostic-scheduler` 已 archived 且被 generate-data 自動過濾——**封存機制下游半驗證 ✓**，餘哨兵/UI 待 ③ 驗證）
- merged view 總計：421 open／49 blocked
- status 欄發現非標準值：`learning`（self-learning）、`knowledge`（hc-validation）、`consulting`（kj-bilingual）——過濾邏輯只認 `archived`，此三值不影響封存但建議 ③ 時正規化

## 裁決規則

- 每行有【預設建議】，你圈「同意」或改判；agent 不自動封存任何一個
- `archive` = project.json `status: archived` + `archived_reason`（含 revisit 條件）；目錄不刪、可查
- 凍結型專案走 archive + revisit 條件（不設第五類）

---

## A 組｜keep-active（預設建議：保留，2026-06-底後有實質動靜或運行中）

| # | project | open | 證據 | 預設 |
|---|---|---|---|---|
| 1 | morrowise | 17 | 賈維斯本體，JV 系列在此 | keep |
| 2 | market-watchtower | 6 | 7/3 完成 TWSE adapter；JV-06 首發內容來源 | keep |
| 3 | travel-finance-dashboard | 1 | Phase 1 完成、Phase 2 剛解鎖 | keep |
| 4 | leo-real-estate-ai | 5 | 7/3 活動，活客戶原型 | keep |
| 5 | yutianlaw | 20（6 blocked=GATED 外部） | 活客戶案，7/3 有 git 動 | keep |
| 6 | kj-bilingual | 43 | **Notion 權威 mirror**（證據在 morrowise KJ-LIVE-01~03，非本地債務；43 open 是鏡像態） | keep＋標 mirror |
| 7 | search-ops-agent | 3 | 7/2 活動，服務 MVP | keep |
| 8 | notyet-md | 4 | 品牌主站 | keep |
| 9 | notion-finance | 6 | **日常運行系統**（記帳 runtime 在用） | keep |
| 10 | harness-mc | 10 | MC 基建本體；**內部 10 open 細項見 D 組** | keep＋close-tasks |

## B 組｜archive（預設建議：封存，各附 reason）

| # | project | open | 理由 | 預設 |
|---|---|---|---|---|
| 11 | rrrealll-v2-transition | 0 | **全部完成**（5/5），過渡頁已上線 | archive（completed） |
| 12 | hc-validation | 0 | **全部完成**（30/30），驗證結論已進 HC 庫 | archive（completed） |
| 13 | house123-buy | 1 | 已標 completed，殘 1 open 一併關 | archive（completed） |
| 14 | digital-ops-sub | 13 | 零完成純規劃（5/20 後無動）；商業模式未啟動 | archive（revisit：月費制方向重啟時） |
| 15 | notyet-scope | 19 | 零完成；IP track 已拆去 xw-worldview，剩服務規劃 | archive（revisit：notyet.md 流量成形時） |
| 16 | adobe-creative-pipeline | 9 | 零完成（6/27 git 觸及為批次格式，非實質） | archive（revisit：Firefly 管線需求回來時） |
| 17 | xw-worldview | 18 | 零完成；IP 慢燉資產，設定已固化在文件 | archive（revisit：IP 內容產出啟動時） |
| 18 | wealth-system | 10（3 blocked 卡 44d） | 零完成；哨兵長期 stale 源 | archive（revisit：Vincent 重排個人理財優先級時） |
| 19 | exam-prep-6yr | 25 | 零完成但 **lineage 完整**（exam-master＋nsg-system 吸收）；內容/系統層未合併 | archive（revisit：小孩學期節點；lineage 保留） |
| 20 | fontcard-120 | 5 | 5/24 後無動，資料整理型 | archive（revisit：字型專案重啟時） |
| 21 | design-hc | 12 | 5/14 後無完成 | archive（revisit：設計 pipeline 需求時） |

## C 組｜merge / 特殊處置（預設建議）

| # | project | open | 建議 | 預設 |
|---|---|---|---|---|
| 22 | dual-blade | 33 | **merge**：遷移實質完成（000_Agent 已遷、ADR-003 已落）。33 open 逐筆判：仍有效者（如 L8 異地備份、M4 MBA-2 切換）併入 morrowise 或以獨立小 task 重開；其餘按 CORE 規範關閉。殼標 archived（historical migration line） | merge→archive |
| 23 | web-reminder-pwa | 14 | 零完成，**但與 JV 送達鏈直接相關**（Web Push 是 L1 通知的候選管道）：(a) 併入 morrowise runtime-delivery 當 backlog (b) archive（revisit：Telegram 不夠用時） | 你選 a/b |
| 24 | thinking-gym | 27（14 blocked 卡 24d） | Phase 0 已驗證、卡招募（外部）。(a) archive＋revisit：招募條件成熟 (b) keep-blocked 繼續掛哨兵 | 你選 a/b |
| 25 | mapelon-2 | 8（2 blocked 卡 44d，等客戶後端資料） | 客戶交付案不宜單方 archive：(a) keep-blocked（哨兵續掃）(b) close 無效 task 留 blocked 核心 | 你選 a/b |
| 26 | hiblocks | 31（13 blocked） | 商業產品活著（6/30 有動）但 31 open 積壓：keep＋**close-tasks**（13 blocked 逐筆重審，變體/文件類過時者關） | keep＋close-tasks |
| 27 | agnostic-scheduler | — | 已 archived（先例），不動 | ✓ |

## D 組｜watch／你快速定奪（保留但標觀察，或一句話改判）

| # | project | open | 現況 | 預設 |
|---|---|---|---|---|
| 28 | english-for-future-work | 14 | 6/29 有動，方法論訓練包 | keep-watch |
| 29 | kids-reward | 15 | 6/29 有動，家庭系統 | keep-watch |
| 30 | maxmodel-notion | 1 | 幾乎完成，收尾即 completed | keep（收尾） |
| 31 | skill-dashboard | 7 | 6/28 有動，系統能力層 | keep-watch |
| 32 | writing-system | 13 | 6/20 後停 | 你定：keep-watch or archive |
| 33 | indiebooks | 7 | 引擎型，taiwan-art 在消費 | keep-watch |
| 34 | taiwan-art | 4 | 內容包，隨 indiebooks | keep-watch |
| 35 | survival-report | 14 | 品牌內容線，6/3 後停 | 你定：keep or archive |
| 36 | self-learning | 6 | 個人學習系統，5/24 後停 | 你定：keep or archive |

## D-sub｜harness-mc 內部 10 open 細項（你點名的那批）

| task | 預設 | 理由 |
|---|---|---|
| ACP-MC-01～04 | close（done＋未執行，已吸收） | note 自載吸收去向（前輪已判） |
| MC-LIVE-12 | close（done＋未執行，已被分散實現） | 五項產出全被既有 read models 覆蓋 |
| ACP-MC-05／06 | keep | 有效 UI 需求（05 分群正好服務本次 archived 顯示） |
| ACP-MC-REPORT-01 | 查核後定 | merged view 顯示未完（與早前 completed 記錄矛盾，③ 時查） |
| ACP-SYNC-01～05 | 你定：keep or freeze | Heptabase PAI 解耦工程，6/28 後停；PAI 行動庫仍有活訊號（哨兵 Notion push 待 integration）——方向是否續推你定 |

---

## 預期效果（③ 執行後量測）

- archive 明確組（B）＋dual-blade 落地 → project 主視野 36 → **~15**；open 421 → **~230**；close-tasks 後再降
- 哨兵 blocked 47 → 預估 **<15**（wealth／thinking-gym／mapelon 視你 C 組圈選）
- ③ 同時修：generate-data 已過濾 archived ✓；補**哨兵跳過 archived**＋MC /projects Archived 分群＋status 非標準值正規化

## 圈選方式

回覆格式自由——「B 組全同意、23 選 a、24 選 b、32/35/36 archive」這樣一句話即可。

---

## 裁決結果與執行紀錄（2026-07-05，Vincent 裁決後）

**Scope 裁決**：收窄至賈維斯家族 5 projects（morrowise／harness-mc／dual-blade／agnostic-scheduler／skill-dashboard）。agent 補遺的 hc-validation（completed 類 UI 已分群管理）與 web-reminder-pwa（獨立專案）經 Vincent 駁回移出。其餘 29 個業務/個人 projects 本輪不裁，全量盤點（上表）保留為 evidence 供後續批次。

**執行明細**：

| 項 | 結果 |
|---|---|
| dual-blade 33 筆 | 26 close（逐筆 note 附 superseded-by／收納去向）＋6 補 completed（實質已完成，含 xiao-wei-mood v1.1 查證）＋1 移轉 morrowise（collab-path-precommit-hook） |
| dual-blade 殼 | status → archived；archived_reason 載明 MBA-1 完成／MBA-2 側由 JV-11 承接；歷史 6 筆 control-plane task 補 order_label DB-CP-01~06 |
| harness-mc 5 筆 | ACP-MC-01~04＋MC-LIVE-12 → done（未執行，已吸收；MC-LIVE-12 附五項覆蓋對照） |
| ACP-SYNC-01~05 | keep（Vincent 確認 PAI 行動庫日常在用；排 E-a 後執行） |
| JV-11／JV-14 | note 承接 dual-blade 移入項（4 項併 JV-11、1 項併 JV-14） |
| 哨兵 | sentinel-diff.mjs 新增 archived 過濾（projectArchived()）；實測 blocked 清單已無 dual-blade |
| validator | dual-blade／harness-mc／morrowise 三檔全過（剩 legacy warnings） |

**量測（誠實版）**：家族內 blocked 歸零（dual-blade 2 筆清除）。哨兵總 blocked 47 → 45 筆屬本輪不裁的業務專案（HiBlocks 13／Thinking-Gym 14／KJ 7／雨田 6／理財 3／Mapelon 2）＋ MorroWise 自身 2 筆合法 blocked（JV-05／JV-11 等 Vincent 物理動作）。原「47→<15」KPI 對應全量裁決，收窄後改判：**家族內達成；全量降噪待後續批次**。

**遺留**：kj-bilingual 的 7 筆 blocked 是 Notion mirror 鏡像態，哨兵掃 mirror 專案的合理性留全量批次議。
