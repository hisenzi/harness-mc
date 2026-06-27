# Heptabase Task Cards — harness-mc Agent Control Plane（2026-06-13）

> Source: `$COLLAB/harness-mc/milestones/harness-mc/tasks.json`  
> Scope: `acp-*` tasks, track `control-plane`  
> Note: 本 session 沒有 Heptabase MCP tool，以下內容可直接建立 note cards。若之後用 MCP，卡片標題以 `# [id] title` 為第一行。

---

# [acp-dashboard-spec] Agent Control Plane Dashboard spec

**Track：** control-plane  
**Status：** todo  
**依賴：** dual-blade/agent-control-plane-execution-plan

## 內容

定義 MC 首頁作為 Agent Control Plane console 的資訊架構。先回答「下一個 agent 打開 MC 第一眼要知道什麼」，再決定 UI。Spec 需包含資料源、read-only 邊界、首頁區塊、project detail 入口與驗收方式。

## 完成標準

- 產出 `system-workflow/docs/specs/agent-control-plane-dashboard.md`
- 文件明確列出 next actions、ADR health、runtime/policy status 的資料來源與顯示規則

---

# [acp-system-workflow-migration-note] system-workflow 歷史 prototype 遷移筆記

**Track：** control-plane  
**Status：** todo  
**依賴：** acp-dashboard-spec

## 內容

把 2026-04-18 的 workflow dashboard prototype 收編為 MC / Agent Control Plane observability 設計素材。列出 sidebar、搜尋、project grouping、kanban、empty state 等哪些可沿用，並移除 OpenClaw path、獨立 repo、skill-executions 必要依賴。

## 完成標準

- 產出 `system-workflow/docs/specs/system-workflow-migration-to-acp.md`
- 清楚標出「可沿用 / 需改寫 / 淘汰」三類

---

# [acp-control-plane-data-generator] generate-control-plane-data.mjs → control-plane.json

**Track：** control-plane  
**Status：** todo  
**依賴：** acp-dashboard-spec, dual-blade/agent-control-plane-readonly-query-schema

## 內容

新增專供 MC 首頁讀取的 control plane 彙總資料層。React 不直接掃 markdown，而是讀 `public/data/control-plane.json`。資料至少整合 MC tasks、ADR backlink、runtime/policy 狀態與 MCP candidate 狀態。

## 完成標準

- 新增 `scripts/generate-control-plane-data.mjs` 並串進 prebuild
- 產出 `public/data/control-plane.json`，含 `next_actions`, `decision_health`, `runtime_inventory_status`, `policy_status`, `mcp_candidates`, `agent_onboarding_health`

---

# [acp-home-control-plane-card] 首頁 Agent Control Plane 區塊

**Track：** control-plane  
**Status：** todo  
**依賴：** acp-control-plane-data-generator

## 內容

在 MC 首頁新增 Agent Control Plane 區塊，讓 Vincent 或下一個 agent 不用翻文件就能看到下一步、必讀 ADR、runtime/policy 是否完成、目前哪些仍是 read-only。此區塊只讀 `control-plane.json`。

## 完成標準

- 首頁顯示下一步 execution task、必讀 ADR、ADR backlink health、runtime/policy 狀態
- 可連到 `/projects` 的 `dual-blade` 與 `harness-mc`

---

# [acp-projects-sidebar-search] /projects sidebar + search + project grouping

**Track：** control-plane  
**Status：** todo  
**依賴：** acp-system-workflow-migration-note

## 內容

把 `/projects` 從單純卡片 grid 升級成更像 control plane console 的 navigation surface。沿用 system-workflow mockup 的 full-height sidebar、搜尋與 Pinned / Active / Done / Archived 分群概念，先解決專案數增加後的掃描問題。

## 完成標準

- `/projects` 有 sidebar、搜尋、project grouping
- 100+ project 時仍可快速定位專案

---

# [acp-project-detail-control-plane] Project detail 顯示 decision refs / next action / blockers

**Track：** control-plane  
**Status：** todo  
**依賴：** acp-projects-sidebar-search, acp-control-plane-data-generator

## 內容

Project detail 不只列 task，也要顯示「為什麼這個專案這樣做」與「下一步是什麼」。先強化 drawer/modal 即可，不必一次改成完整 route。dual-blade 與 harness-mc 要能直接看出 Agent Control Plane 狀態。

## 完成標準

- detail 固定顯示 `decision_refs`
- 顯示 next executable task、blocked/stale 摘要、source-of-truth links

---

# [acp-runtime-policy-surface] Runtime / policy read-only surface

**Track：** control-plane  
**Status：** todo  
**依賴：** dual-blade/agent-control-plane-schedule-inventory, dual-blade/agent-control-plane-security-policy, dual-blade/agent-control-plane-memory-policy

## 內容

等 schedule inventory、security policy、memory policy 完成後，MC 需要顯示 runtime / policy health。完成前不要假裝已有資料，應顯示「待 inventory / policy」。此任務保持 read-only，不做 controlled write 或 MCP 寫入。

## 完成標準

- MC 可顯示 schedule、security、memory 的完成狀態
- 未完成項目清楚顯示 blocked / waiting，而不是空白
