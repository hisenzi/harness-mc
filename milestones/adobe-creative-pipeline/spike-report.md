# Illustrator Image Trace Spike Report

## Metadata

- project: `adobe-creative-pipeline`
- task: `acp-006`
- stage: MVP Stage 2 — minimum Illustrator API spike
- checked_at: `2026-08-19`
- status: `local_fallback_success_cloud_api_blocked`
- delivery_state: `local_validated_uncommitted`
- live_call: `not_attempted`
- generated_svg: `milestones/adobe-creative-pipeline/acp-006-image-trace.svg`

## MVP route

```text
PNG / JPG
  → secure input URL
  → POST https://illustrator-api.adobe.io/v1/trace-image
  → GET https://illustrator-api.adobe.io/v1/status/{jobId}
  → presigned SVG output
```

Adobe 官方 Image Trace 文件確認：輸入支援 `image/png` 與 `image/jpeg`；可選 preset 為 `enhanced_general` 與 `high_fidelity_photo`；成功結果為 `image/svg+xml` 的 presigned output URL。這些是 API contract 證據，不是本機 live success 證據。

## Local access preflight

本輪只檢查環境變數是否存在，不讀取、不輸出任何值：

| Required env name | Present | Result |
| --- | --- | --- |
| `ILLUSTRATOR_API_CLIENT_ID` | no | blocked |
| `ILLUSTRATOR_API_CLIENT_SECRET` | no | blocked |
| `ILLUSTRATOR_API_ACCESS_TOKEN` | no | blocked |

因此目前不能安全執行 submit、poll 或 download。沒有建立假 job ID、假 response、假 SVG 或假 live receipt。

## Selected fallback route

由於 Cloud API access 被組織權限擋住，Vincent 核准改走本機 Illustrator fallback：

```text
PNG / JPG
  → Illustrator 2026 Desktop
  → Image Trace（local default preset）
  → Expand
  → SVG
```

## Adobe Console access evidence

Vincent 提供的 Adobe Developer Console 截圖顯示：

- banner：`Restricted access`
- message：目前沒有 developer access，需要 admin approval
- API catalog 目前只顯示組織可用服務，尚未呈現可建立 Illustrator API credential 的路徑

補充的第二張截圖在 `All` API catalog 中看得到 `Illustrator API - Firefly Services` 卡片；但 `Restricted access` banner 仍存在。因此目前只能確認服務項目可被搜尋／瀏覽，不能推論組織 entitlement、Developer role、project creation 或 credential creation 已就緒。

這與 Adobe 官方 onboarding 條件一致：Enterprise 使用者需由組織管理員配置 Developer 或 System Administrator role，並配置 Firefly Services；Illustrator API authentication 文件也要求先由 Adobe representative／組織完成 Developer Console 與 OAuth Server-to-Server credential setup。截圖只作 access evidence，沒有複製進 repo，也沒有包含任何 credential value。

## Current acceptance evidence

| ID | Current result | Evidence |
| --- | --- | --- |
| `ACP06-MVP-01` | `pass` | 官方 endpoint、輸入、preset、polling 與 SVG output contract 已記錄 |
| `ACP06-MVP-02` | `blocked_missing_access` | 三個 Illustrator API env names 均不存在；只完成 presence-only check |
| `ACP06-MVP-03` | `blocked_missing_access` | 未執行 live call，沒有 SVG artifact |
| `ACP06-MVP-04` | `pass` | 本報告保留 blocked handoff，未觸碰 Firefly、Photoshop、package 或 `acp-007` |

## Local Illustrator execution receipt

- input: `adobe-mvp-lion-input.png`（使用者提供的獅子 PNG；暫存於 `/Users/somedesign/Downloads/`）
- application: `Adobe Illustrator 2026`
- operations: open → select raster image → Image Trace → Expand → export SVG
- local preset: Illustrator UI 顯示 `[預設]`；本輪未宣稱等同 Cloud API 的 preset 名稱
- output: `milestones/adobe-creative-pipeline/acp-006-image-trace.svg`
- output bytes: `5783`
- XML parse: `pass`（`xmllint --noout`）
- vector evidence: `6` `<path>` elements
- embedded raster evidence: `0` `<image>` elements
- Cloud API call: `not attempted`（access remains blocked）

Local acceptance result：`ACP06-LOCAL-01=pass`、`ACP06-LOCAL-02=pass`、`ACP06-LOCAL-03=pass`、`ACP06-LOCAL-04=pass`。

### Asset rights warning

使用者提供的原圖帶有 Adobe Stock 浮水印。這份 SVG 只證明本機 Image Trace → Expand → SVG 技術路徑已跑通，不是可發布或可商用的正式素材；正式測試應換成有授權的原始 PNG/JPG。

## To resume live spike

在安全的本機執行環境提供 Adobe Illustrator API 的 OAuth Server-to-Server access，僅以環境變數注入：

1. `ILLUSTRATOR_API_CLIENT_ID`
2. `ILLUSTRATOR_API_CLIENT_SECRET`
3. `ILLUSTRATOR_API_ACCESS_TOKEN`

恢復後只做一個最小 PNG/JPEG trace job：submit → poll → download SVG，並保存不含 credentials 的 request metadata、job status、output MIME 與 artifact path。

## Scope boundary

本輪沒有建立 MCP/plugin、沒有做 Simplify／Path QA、沒有執行 Cloud API、沒有修改 `acp-001` 或 `acp-007`，也沒有 commit、push 或 deploy；本輪已執行本機 Illustrator UI automation 並產出指定 SVG。

## Official sources

- [Adobe Illustrator API — Image Trace Guide](https://developer.adobe.com/firefly-services/docs/illustrator/guides/image-trace/)
- [Adobe Illustrator API — Authentication](https://developer.adobe.com/firefly-services/docs/illustrator/getting-started/)
- [Adobe Illustrator API — Overview](https://developer.adobe.com/firefly-services/docs/illustrator/)
