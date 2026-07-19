# JV-36 文件控制面板：研究與決策紀錄

> Task：`morrowise/document-source-registry-and-human-sync`（JV-36）
> 行動正本：`$COLLAB/harness-mc/milestones/morrowise/tasks.json`
> 本頁角色：議題脈絡與研究紀錄；不保存 task status，也不取代未來的 Document Source Registry。
> Semantic intake：`reuse`。文件控制面板與 JV-36 問題、owner、輸入輸出及完成邊界相同，不新增平行 task。
> Architecture decision：沿用 JV-36 的 `deferred`；完成 registry、schema、verifier 與 admission 前不可標 promoted。

## 1. 目前決定

共享 Agent 與跨 repo 的系統文件，必須先由 JV-36 建立可機械查驗的文件目錄，再談 UI 或控制面板。Agent 寫文件前先查 catalog；找到 canonical document 就更新或引用，找不到時只能建立有 registry entry 的 draft/proposal，不得自行決定正式檔名、路徑或正本身份。

這不是新的 MorroWise task，也不是 JV-32 catalog 的替代品：

- JV-36 擁有文件身份、owner、source of truth、分類、write policy、generated targets 與 health check。
- JV-32 只提供 research、domain-modeling、task-lifecycle 與 closeout routing。
- `ARCHITECTURE.md`、README、Dashboard 都是入口或 generated surface，不是文件 catalog 正本。

## 2. Semantic intake 四個邊界

| 邊界 | 判斷 |
| --- | --- |
| 問題 | handoff 與 JV-36 都在解決共享／跨 repo 文件缺少可查驗身份、owner、正本、write policy 與寫前 routing。 |
| Owner／正本 | Owner 是 JV-36；task state 在 `tasks.json`，未來文件身份正本是 `morrowise-document-sources.json`。 |
| 輸入／輸出 | taxonomy、registry、schema、verifier、generated index、Agent preflight 與 admission 已被 JV-36 acceptance 涵蓋。 |
| Lifecycle／完成 | JV-36 為 `todo`、Roadmap-in-Anchor、architecture deferred；沒有 successor，也沒有新問題支撐 `genuinely_new`。 |

固定 outcome：`reuse`。因此本次只把研究脈絡收編到本頁，不修改 JV-36 task state。

## 3. 最小文件模型

文件角色至少區分：

- `canonical`：規則、task、registry、schema 的正本。
- `protocol`：跨 Agent／跨 repo 的穩定操作合約。
- `detail`：正本的深入說明，不擁有狀態。
- `evidence`：研究、驗證、decision trail 與 article material。
- `generated`：由正本產生，禁止手改。
- `mirror`：外部視覺層或副本，不得反向覆寫正本。

Registry 最小欄位：`id`、`title`、`system_id`、`document_role`、`status`、`owner`、`task_anchor`、`source_refs`、`write_policy`、`generated_targets`、`verifiers`、`supersedes`／`superseded_by`。

Agent 寫文件前的最小流程：

1. 查 Document Source Registry 與既有 task。
2. 判斷更新、引用、supersede 或 proposal。
3. 確認 owner、正本、輸出位置與 verifier。
4. 寫入後執行 changed-only impact check。
5. 由 generated index 更新人讀入口與 `ARCHITECTURE.md` 薄連結。

## 4. 外部模式與影響

| 來源 | 取用模式 | 本案影響 |
| --- | --- | --- |
| Backstage Software Catalog | metadata 放在版本控制；每個項目具 owner、lifecycle 與關係。 | 採 metadata catalog 思路，不先導入 Backstage UI。 |
| Write the Docs／Docs as Code | 文件走 Git、review、task／issue 與自動檢查。 | 文件變更必須可 review、可驗證，但不把每個小文案升格成重流程。 |
| ADR／decision log pattern | 決策、理由、替代方案與後果可追溯。 | 本頁保存演進，不把對話全文或 task status 複製進來。 |

## 5. 演進紀錄

| 日期 | 發現 | 決策變化 |
| --- | --- | --- |
| 2026-07-19 | 精簡 `ARCHITECTURE.md` 歷史附錄時，發現沒有文件身份與 archive 正本就可能把可追溯脈絡藏回寬泛 corpus。 | 文件精簡必須先確認 canonical archive 與 generated thin link。 |
| 2026-07-19 | 初始 handoff 判斷應建立新 task，但後續 canonical task 全量比對發現 JV-36 已完整涵蓋。 | Semantic intake 固定為 `reuse`，不建立文件控制面板平行 task。 |
| 2026-07-19 | Dirty repo 同時混入 generated index、歷史附錄與 handoff。 | 文件 ownership 必須在 commit 前可分流，不能以檔名或同一 repo 當成同一 scope。 |

## 6. 文章素材

### 核心論點

文件統一管理不是把所有 Markdown 搬進同一資料夾，而是讓每份文件都有唯一身份、owner、正本與可驗證的衍生關係。

### 反直覺發現

- 精簡文件之前若沒有 archive 正本，薄連結可能只是把問題藏起來。
- 「相關」不代表應另開 task；四個邊界一致時，正確動作是 reuse。
- 一個 `ARCHITECTURE.md` 可以同時含 manual 與 generated scope，因此 file-level commit 不一定等於可稽核 ownership。

### 候選題目

1. 《AI Agent 寫文件之前，為什麼需要先查 catalog？》
2. 《文件越集中，為什麼反而可能更失控？》
3. 《薄連結不是刪內容：可追溯文件架構的真正前提》

## 7. Provenance

本頁收編自 `$COLLAB/notyet-harness/000_Agent/_temp/document-control-plane-handoff-2026-07-19.md`；原始檔 SHA-256：`f3abab3cde8d07ae2fa776c1d00f38373d705007c6ff2e5eb19e914f2c595876`。暫存原檔完成收編後不再作正本。
