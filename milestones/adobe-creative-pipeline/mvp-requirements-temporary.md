---
title: Adobe Creative Pipeline MVP 暫時需求：點陣圖轉向量
status: temporary-plan
canonical: false
owner: Vincent
created: 2026-08-19
project: adobe-creative-pipeline
source_task: acp-001
---

# Adobe Creative Pipeline MVP 暫時需求

> 本文件是回到 MVP 的臨時需求錨點，不是 canonical task state、正式產品規格或 Adobe access receipt。正式狀態仍以 `project.json`、`tasks.json` 與驗收證據為準。

## MVP 一句話

確認能否由 **Codex 驅動本機 Illustrator 的 Image Trace，把 PNG/JPG 轉成 SVG 向量圖**；Cloud API 是首選路線，但目前因組織權限 blocked，採本機 fallback。

```text
PNG / JPG → Codex → Illustrator Desktop Image Trace → Expand → SVG
                         └→ Cloud API（access available 時的替代路線）
```

## 本輪要確認的事

1. Adobe 官方是否提供可用的 Illustrator Image Trace API。
2. 輸入是否支援 PNG/JPEG，輸出是否為 SVG。
3. `enhanced_general` 與 `high_fidelity_photo` 是否為官方公開 preset。
4. API access、OAuth Server-to-Server 與 Adobe Developer Console 條件為何。
5. 未取得 Cloud API access 時，本機 Illustrator Desktop 是否能完成 Image Trace → Expand → SVG。

## MVP 驗收

- 有一份可追溯的 capability report，記錄 endpoint、輸入、輸出、preset、限制、auth boundary 與 fallback。
- 清楚區分 official documentation、Cloud account/runtime access、本機 Illustrator runtime、live API call 與 generated SVG artifact。
- 明確決定下一個實作入口：Illustrator spike（`acp-006`）。
- 本輪不把「文件上可行」宣稱成「Cloud 帳號已授權」或「API 已成功呼叫」；本機 SVG 另以 local desktop receipt 驗收。

## 明確不做

- 不建立完整 MCP/plugin/tool wrapper。
- 不使用 Adobe credentials，不呼叫 Cloud API。
- 不做 Simplify、色塊整理、Path/Anchor QA 或素材包輸出。
- 不提前執行 Firefly、Photoshop 或其他 Adobe spike。

## 後續路由

`acp-006` 現在採本機 Illustrator route，驗證 Image Trace → Expand → SVG；Cloud API access blocked 的證據保留在 spike report，未來若組織權限開通，再另行驗證 API route。正式發布前仍需替換成有授權的 PNG/JPG，並另做 Simplify、Path QA 與素材包輸出。
