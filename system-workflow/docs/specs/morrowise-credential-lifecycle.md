# MorroWise Credential Lifecycle Contract

> Owner task: `$COLLAB/harness-mc/milestones/morrowise/tasks.json#credential-lifecycle-governance` (JV-39)<br>
> Canonical integration contract: `$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json`<br>
> Machine posture read model: `$COLLAB/harness-mc/public/data/credential-health.json` (generated, read-only)

## 目的與不可跨越的邊界

MorroWise 管理的是可稽核的安全契約與 sanitized metadata，不是憑證保管人。

- 憑證值只存在 Vincent 管理的受管加密密碼庫，以及各機作業系統／應用程式安全儲存。
- `$COLLAB`、Git、MC、task event、generated data、dashboard、log、verifier 與 Agent 不得保存、讀取或輸出憑證值、Cookie、帳號、secret 名稱、密碼庫路徑、私有檔案位置、runtime auth 或可重放 hash。
- capability registry 是唯一的可整合 security metadata 正本；本文件只承載不屬於單一 capability 的生命週期規則，不能成為第二份 runtime inventory。
- 本合約不選定、安裝、遷移或登入任何密碼庫；也不設定 GitHub Secrets、輪替、撤銷、部署或發出外部請求。

## 六類憑證生命週期

| 類別 | 用途與來源真相 | 最小權限與責任 | 輪替／撤銷與復原 |
| --- | --- | --- | --- |
| `service_static` | 服務對服務的長效憑證；值在受管加密密碼庫與經核准的本機安全儲存。 | owner 是 Vincent；consumer 僅為明確 capability；採單一用途、最小 scope。 | 建立新版→受限驗證→漸進切換→可回復→停用舊版；疑似外洩先撤銷。 |
| `ci_federated` | CI／部署的短效聯邦身分；GitHub Actions 優先以 OIDC 取得短期憑證。 | workflow job 僅取其所需 scope；不複製長效雲端憑證。 | 變更 trust policy、repository 或 owner 時重新驗證；疑似外洩先停用信任關係。 |
| `human_account` | 人類互動式帳號；值僅由本人管理的受管密碼庫與本機安全儲存保存。 | owner 是帳號持有人；不得共用或將日常登入當作復原因子。 | 僅在疑似外洩、服務要求或所有權變更時輪替，不採機械式定期換密碼。 |
| `device_session` | 裝置上的 OAuth／應用程式 session；僅存在該裝置安全儲存。 | 綁定單一受管裝置與最小必要服務。 | 遺失、竊取、離職或汰換時優先終止 session／撤銷裝置。 |
| `recovery` | 帳號或管理者復原材料；保留於與日常登入獨立的受管安全系統。 | 任何單一日常因子都不得直接取得另一個復原因子。 | 定期演練可達性但不匯出內容；疑似曝露時更換受影響復原因子。 |
| `private_runtime` | 僅本機 runtime 使用的私有設定或短期授權。 | 僅限該 machine 與明確 runtime consumer；不進 repo 或共享摘要。 | 停用 runtime、遺失裝置或汰換時清除 session、快取與私人設定。 |

## 允許的安全 metadata

每個適用 capability 只能記錄：

`capability_id`、`credential_class`、`owner_role`、`consumer`、`least_privilege_contract`、`rotation_policy`、`last_rotated_at`、`rotation_due_at`、`recovery_rule`、`incident_state`、`next_action`、`last_verified_at`、`sanitized_evidence_ref`。

日期欄位可為 `null`，表示尚未由 Vincent 提供可公開的安全 metadata；`null` 不能被轉譯為 healthy。未適用 capability 必須標為 `not_applicable` 並說明原因。

## MBA-1／MBA-2／MBA-3 對等啟用

三台機器只同步 portable canonical repo 與公開設定模板。每台機器由 Vincent 在其本機安全儲存完成啟用，並依相同安全摘要格式回報；不得跨機複製 Cookie、OAuth session、runtime auth、快取或私人設定。

1. 取得 canonical repo 與公開設定模板。
2. Vincent 在本機受管安全儲存完成需要的 capability 啟用。
3. 受信任本機 probe 僅產生下列 summary 欄位：`schema_version`、`machine_id`、`posture`、`connection_observed`、`observed_at`、`next_action`、`sanitized_evidence_ref`。
4. 生成器把摘要轉成唯讀 `credential-health` read model；缺摘要是 `missing_machine`，過期資料是 `stale`，兩者都不得顯示為綠燈。
5. 未安裝的本機能力使用通用 `not_applicable`，不得為 MBA-1、MBA-2 或 MBA-3 設例外規則。

安全摘要不是憑證證明：它只表示受信任本機檢查已在某時間完成，不能取代 capability registry、事故處理或 Vincent 的外部核准。

## GitHub Actions 基線

- 預設 workflow 權限為 `contents: read`；部署 job 才可取得 `pages: write` 與 `id-token: write`。
- 不受信任 PR、fork、artifact 與 cache 不得接觸 secrets；無必要時禁止 `pull_request_target`。
- 雲端部署優先 OIDC／短效聯邦身分，不在 workflow 或 repo 放置長效雲端憑證。
- checkout 不保留可被後續 command 濫用的 git credentials。
- workflow 成功與失敗路徑都必須經 `test:credential-lifecycle` 的來源與輸出 sensitive-data verifier；失敗 log 不得回顯安全值。

## 輪替、事故、復原與退役

### 輪替

- `service_static`：新版建立、受限驗證、漸進切換、rollback、舊版停用／撤銷。
- `ci_federated`：維持短效身分與最小 trust policy；變更 deploy owner、repository 或 provider 時重新驗證。
- `human_account`：只在疑似外洩、服務要求或帳號擁有權異動時輪替。
- 每個適用 capability 在 registry 保存輪替政策、最近輪替／到期 metadata 與回復規則；不保存輪替材料。

### 事故與裝置遺失

- P0 管理者／部署身分：Vincent 在通報後一小時內終止 session、撤銷裝置或停用憑證。
- 一般服務身分：同一工作日內處理；疑似外洩時先撤銷，再處理 code、log、cache 與歷史殘留。
- 裝置汰換：清除本機 session、快取與私人設定，只能回寫 sanitized summary。

### 復原

復原必須至少使用兩個獨立因子；日常登入因子不能單獨取得另一個復原因子。完整 audit 與復原材料只留在受管安全系統，MC 不保存其內容。

## 驗證與外部效果邊界

本合約的本機驗證器只檢查 registry、spec、workflow、安全摘要 schema、generated read model 與 MC read-only surface。若未來需要密碼庫、帳號、GitHub secrets、撤銷、輪替、排程、commit、push 或部署，必須以獨立 task 與 Vincent 明確核准承接。
