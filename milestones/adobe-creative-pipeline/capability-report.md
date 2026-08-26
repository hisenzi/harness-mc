# Adobe 創意素材產線：Capability Probe Report

> Task: `adobe-creative-pipeline/acp-001`
> Status: documented capability / account and runtime access not verified
> Probed at: 2026-08-19
> Scope: Firefly、Photoshop、Illustrator 的控制方式、限制、fallback 與下一步

## 結論先行

Adobe 官方文件已證實三個節點都有可程式化的控制面，但它們不是同一種能力：

| 節點 | 官方控制面 | 本輪狀態 | 建議下一步 |
| --- | --- | --- | --- |
| Firefly | REST API、Node SDK | 文件可用；Adobe access 未驗證 | 進入 `acp-004`，先做最小生成 probe |
| Photoshop | Cloud API v2、Actions、UXP Scripts／Plugins | 文件可用；Adobe access 未驗證 | 進入 `acp-005`，先選 v2 `/v2/execute-actions` 或本機 UXP |
| Illustrator | Illustrator API、Image Trace、Custom Scripts public beta | 文件可用；Adobe access 未驗證 | 進入 `acp-006`，先驗證 Image Trace 或 template/vector route |

本報告不是 live integration receipt。沒有執行 Adobe API call、沒有使用 Adobe credentials、沒有生成素材，也沒有把 Adobe 能力寫入共用 capability registry。現有 `$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json` 本輪未登錄 Adobe route，因此本報告是 project-local probe evidence，不代表共用 runtime 已接通。

## 共通邊界

- 官方文件證實的是 API／script surface，不等於本機已有權限、帳號已開通或 runtime 已成功呼叫。
- Client ID、Client Secret、Access Token、Cookie、Adobe Developer Console 私人設定與客戶素材授權內容不進 repo。
- 報告只記錄環境變數名稱與授權步驟，不記錄任何秘密值。
- Cloud API 的 input／output URL、presigned URL 與 job status 必須在後續 spike 中留下可回溯 receipt；本輪沒有產生 receipt。
- Codex 直接控制 Mac 上 Illustrator／Photoshop Desktop 的 UI，不是本輪官方 API 證據；若採用，需另走本機 script／UXP／人工 fallback 驗證。

## Firefly

### 官方控制方式

1. **Firefly REST API**：官方 Quickstart 使用 `POST https://firefly-api.adobe.io/v3/images/generate-async`，以 prompt 產生影像；官方 Generate Image tutorial 也記載同步 `v3/images/generate` 路線。
2. **Firefly Services Node SDK**：官方 SDK guide 說明可用 REST API 或 Node SDK；Node SDK 目前提供 Firefly APIs，並共用 authentication package。
3. **Reference image / upload**：官方文件支援 Firefly upload endpoint 或 AWS、Azure、Dropbox 等 presigned URL，供後續 style／structure reference 使用。

### Authentication boundary

- 官方文件要求 Adobe Developer Console project、Firefly API OAuth Server-to-Server credentials，以及 Client ID / Client Secret。
- access token 由 secure server-side application 透過 Adobe IMS 取得；官方示例的環境變數名稱為 `FIREFLY_SERVICES_CLIENT_ID`、`FIREFLY_SERVICES_CLIENT_SECRET`、`FIREFLY_SERVICES_ACCESS_TOKEN`。
- 此處只記錄名稱，不讀取或建立任何值。

### 限制與 fallback

- Cloud route 受 Adobe access、token、輸入儲存位置、presigned URL 與 API rate／model availability 影響。
- 生成 endpoint 與 model/schema 會演進；後續 spike 必須鎖定實際使用的 API version 與 payload，不可只依賴概念頁。
- Fallback：沒有 API access 時，保留人工 Firefly 生成或 local placeholder；不得把人工結果冒充 API receipt。

### Status / next action

- **Status**：`documented / access_pending / not_live_verified`
- **推薦 route**：REST API；Node.js 專案可評估 Node SDK。
- **下一步**：`acp-004` Firefly 最小生成 probe；需要 Vincent 決定是否提供 Adobe API access，以及是否接受把輸出放入指定安全 storage。

### 官方來源

- [Firefly API Quickstart](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/)
- [Firefly API Authentication](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/)
- [Firefly Generate Image API Tutorial](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/how-tos/firefly-generate-image-api-tutorial)
- [Firefly Services SDK](https://developer.adobe.com/firefly-services/docs/guides/tutorials/using-the-sdk)
- [Firefly Image Upload](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/concepts/image-upload/)

## Photoshop

### 官方控制方式

1. **Photoshop API v2**：Adobe 官方目前建議新整合使用 Photoshop API v2；v2 具有 unified architecture、flexible storage，並提供 workflow guides 與 OpenAPI reference。
2. **`/v2/execute-actions`**：官方 v2 workflow 可執行 Photoshop Actions、ActionJSON 與 UXP Scripts；Actions 適合固定影像處理，UXP Scripts 適合條件邏輯、資料擷取與較複雜的自動化。
3. **UXP Scripts**：本機 `.psjs` script 可由 Photoshop 的 Scripts menu、拖放或 UXP Developer Tool 觸發。官方文件指出 script 可以 headless 或 minimal UI 執行，但可用 UXP modules 受 host 限制。
4. **UXP Plugins**：本機 plugin 適合需要 panel UI、persistent data 或更完整 host integration 的 workflow。
5. **Legacy routes**：ExtendScript／CEP／AppleScript 仍可作既有版本或 fallback，但不是新整合的首選。

### Authentication boundary

- Photoshop Cloud API 使用 server-to-server credentials；官方文件列出 Adobe Developer Console project、Photoshop API OAuth Server-to-Server credentials，並要求 Adobe access／Enterprise contract 條件。
- 官方示例環境變數名稱包含 `PS_FF_SERVICES_CLIENT_ID`、`PS_FF_SERVICES_CLIENT_SECRET`、`PS_FF_SERVICES_ACCESS_TOKEN`；只記錄名稱，不記錄值。
- Cloud API 使用 Client ID／API key、Bearer access token 與外部或 presigned storage URL。

### 限制與 fallback

- Photoshop API v1 官方已標記 deprecated，並列出 2026-07-31 EOL；本專案不以 v1 作為新實作路線。
- Cloud API 不是完整 Desktop UI。官方 Actions 文件列出不支援 OS-level dialogs、3D、video／animation、custom presets 等限制；Actions 也不應依賴 user intervention。
- UXP Scripts 有模組限制，官方文件目前列出 Network、LaunchProcess、WebView、IPC 等不是 script 可用模組；需要這些能力時應評估 UXP Plugin 或 cloud route。
- Fallback：本機 Photoshop UXP Script／Action，必要時人工 Photoshop 操作；Computer Use 只保留為最後 fallback，不作主要控制層。

### Status / next action

- **Status**：`documented / v2_preferred / access_pending / not_live_verified`
- **推薦 route**：固定批次後製優先評估 v2 `/v2/execute-actions`；需要本機互動或暫時不具 cloud access 時評估 UXP Script。
- **下一步**：`acp-005` Photoshop 後製 probe；需要 Vincent 決定 cloud API v2 與本機 UXP 的優先順序。

### 官方來源

- [Photoshop APIs overview](https://developer.adobe.com/photoshop/)
- [Photoshop API v2 overview](https://developer.adobe.com/firefly-services/docs/photoshop/)
- [Photoshop API v2 Execute Actions](https://developer.adobe.com/firefly-services/docs/photoshop/guides/photoshop-v2/v1-to-v2/guides-v2/execute-actions)
- [Photoshop API Authentication](https://developer.adobe.com/firefly-services/docs/photoshop/getting-started/)
- [Photoshop UXP Scripting](https://developer.adobe.com/photoshop/uxp/scripting/)
- [Photoshop UXP API reference](https://developer.adobe.com/photoshop/uxp/ps_reference)
- [Photoshop API guides](https://developer.adobe.com/firefly-services/docs/photoshop/guides/)

## Illustrator

### 官方控制方式

1. **Illustrator API**：Adobe Firefly Services 官方 Illustrator API overview 明列 rendition、preview、data merge、custom script、image trace、Recolor、Manifest 與 Document operations。
2. **Image Trace**：官方 Image Trace guide 支援 PNG／JPEG raster input，透過 asynchronous job 執行 raster-to-vector，完成後提供 SVG output。
3. **Custom Scripts public beta**：官方 Custom Scripts API 可上傳並執行包含 `script.jsx` 與 `manifest.json` 的 custom script bundle；官方頁面標示 public beta，API 可能變動。
4. **Desktop script／template**：本輪官方文件查證的是 cloud Illustrator API 與其 custom script service；本機 Illustrator Desktop 的 `.jsx`、plugin 或 template workflow 未在本輪作 live verification，保留給後續 spike。

### Image Trace verified details

- Endpoint：`POST https://illustrator-api.adobe.io/v1/trace-image`
- Input：`input.source.url` 為 presigned GET URL，`input.mediaType` 允許 `image/png` 或 `image/jpeg`
- Optional preset：`enhanced_general` 或 `high_fidelity_photo`；其他 preset 會回 400，省略則使用 service default
- Async status：`GET https://illustrator-api.adobe.io/v1/status/{jobId}`
- Output：成功後由 presigned URL 下載 `image/svg+xml`；官方文件明確說 Image Trace 只回 SVG，不回 AI、PDF 或其他格式
- 本輪沒有呼叫 endpoint，因此沒有 job、status 或 SVG receipt。

### Authentication boundary

- 官方文件要求 Adobe Developer Console project、Illustrator API OAuth Server-to-Server credentials，以及 Client ID / Client Secret。
- 官方示例環境變數名稱為 `ILLUSTRATOR_API_CLIENT_ID`、`ILLUSTRATOR_API_CLIENT_SECRET`、`ILLUSTRATOR_API_ACCESS_TOKEN`；只記錄名稱，不記錄值。
- 官方 auth 文件列出 scope `openid, AdobeID, ff_apis, firefly_enterprise, illustrator_services_beta`；實際 scope 與 entitlement 必須以 Adobe Developer Console project 為準。

### 限制與 fallback

- Image Trace 需要可被 Adobe 取用的 presigned input URL，且輸出只有 SVG；若後續需要 Expand、Simplify、整理色塊、AI 或 PDF，必須另接 Illustrator custom script、Photoshop 或本機後處理，不應把 Image Trace 本身誤當成完整 vector cleanup pipeline。
- Custom Scripts 是 public beta，API stability 與版本相容性是風險；script bundle 需要 `manifest.json`、`script.jsx` 和 `main()` entry point，且執行 script 不應使用 UI dialog／popup。
- Fallback：先做 local `.jsx`／template spike 或人工 Illustrator 操作；這些是 fallback／待驗證 route，不是本報告已證實的 Codex-to-Desktop bridge。

### Status / next action

- **Status**：`documented / image_trace_fit / access_pending / not_live_verified`
- **推薦 route**：若需求是 PNG／JPG → SVG，先評估 Illustrator Image Trace API；若需要 Expand、Simplify、重整色塊或多格式輸出，併列 Custom Scripts public beta 或本機 Illustrator script 作後處理候選。
- **下一步**：`acp-006` Illustrator vector/layout/export probe；需要 Vincent 決定先測 cloud Image Trace，還是先測本機 script／template。

### 官方來源

- [Illustrator API overview](https://developer.adobe.com/firefly-services/docs/illustrator/)
- [Illustrator API Authentication](https://developer.adobe.com/firefly-services/docs/illustrator/getting-started/)
- [Illustrator Image Trace Guide](https://developer.adobe.com/firefly-services/docs/illustrator/guides/image-trace/)
- [Illustrator API Key Concepts](https://developer.adobe.com/firefly-services/docs/illustrator/getting-started/concepts/)
- [Illustrator Custom Script Guide](https://developer.adobe.com/firefly-services/docs/illustrator/guides/custom-scripts/)

## Vincent 待確認項

1. Adobe API access 是否已具備，或本輪只先保留 documented capability、暫不做 live call。
2. Firefly、Photoshop、Illustrator 三個 spike 的優先路線是 cloud API、local script／UXP，還是先做人工 fallback。
3. Illustrator Image Trace 後續是否需要接 Expand、Simplify、色塊整理與多格式 export；若需要，不能把 SVG-only trace 當成最終交付。
4. Photoshop 新整合是否以 API v2 為唯一 cloud route，並將 v1 視為 migration／歷史參考。

## 本輪未完成項

- 沒有讀取、建立或輸出 Adobe credentials。
- 沒有執行 Firefly、Photoshop 或 Illustrator API call。
- 沒有開啟或控制本機 Adobe Desktop App。
- 沒有生成 PNG、JPG、SVG、AI、PSD 或影片。
- 沒有建立 global capability registry entry。
- 沒有 commit、push、部署或同步外部白板。
