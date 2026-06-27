---
feature: 開發流程儀表板（Workflow Dashboard）
status: approved
created: 2026-04-18
updated: 2026-04-18
owner: Vincent
---

# 開發流程儀表板

> 一句話描述：顯示當下 feature 狀態 / velocity / Quality 趨勢 / Skill 使用統計的 multi-project dashboard，以模組化結構支援持續優化，並預備未來與 Mission Control 整合。

---

## Context

### 問題

剛建完 `developing-features` 11 步驟開發流程系統（`validate-design` + `writing-spec` + orchestrator），但**沒有任何追蹤機制**：
- 無法知道哪個 feature 現在卡在哪一步
- 無法評量流程本身的成效（哪步最常被跳、哪個 skill 最常卡）
- 無法比較不同時期的 quality 趨勢（validate-design 分數有在進步嗎？）
- 整個系統的使用狀況不透明

**活證據**：Vincent 剛建完 orchestrator，我（Claude）就違反流程直接衝進 implementation plan，被抓包。沒有追蹤機制 → 違規沒被即時發現 → 系統形同虛設。

### 「持續優化」的定義（本 spec 核心原則）

Vincent 對「持續優化」的定義：**不是加一堆 meta 機制（retro / CHANGELOG / A/B），而是讓架構本身模組化**，讓任何 skill / 任何區塊都能獨立演化。

具體體現：
- 資料流單向：skill → log → dashboard（任何 skill 加 log 都自動出現）
- 區塊獨立：4 個區塊各管各的，互不影響
- JSON first：dashboard 只是 JSON 的一個 view，MC / 其他工具可共用同一 JSON

### 不做會怎樣

- 流程違規沒被發現（當前實況）
- feature 卡住沒被警覺
- skill 退化沒被察覺
- 系統無法量化改進

---

## User Story

**As** Vincent（workflow system 的建立者與 primary user）
**I want** 在一個 dashboard 看到所有專案的 feature 流程狀態、速度、品質趨勢、skill 使用統計
**so that** 我能識別瓶頸、發現違規、決定哪個 skill 該改進，讓系統持續進化

**次要 user**（未來）：Mission Control 能讀取同一份 JSON，整合進更大的 agent 生態系

---

## 成功標準

### MVP（一週內）
- [ ] 新建 `system-workflow` repo（hisenzi/system-workflow）
- [ ] Dashboard 能在 `file://` 本地開啟（無需 build step 或 server）
- [ ] **架構支援 100+ 專案**（不是 MVP 塞 3 個就飽）：
  - 左側 Sidebar（滿高）+ 專案搜尋框
  - Sidebar 分群：`📌 Pinned` / `🟢 Active` / `✅ Done` / `📦 Archived`
  - 長 list 預留虛擬滾動空間（MVP 實作可先用 overflow scroll）
  - Cmd-K command palette（Phase 2，MVP 先預留快捷鍵入口 UI）
- [ ] **兩種主視圖**：
  - 「所有專案」= **專案卡片網格**（每個專案一張卡：名稱、stats、recent activity）
  - 單一專案 = kanban 濾到該專案 + header + 右側 technical debt/recent activity/docs
- [ ] **區塊 1：Feature 看板**（單專案視圖）
  - 掃描該專案 `docs/specs/*.md` → frontmatter `status` + `created`
  - 5 欄：draft / approved / in-progress / done / abandoned
- [ ] 輸出 `dashboard-data.json` 作為資料源（dashboard 讀這個，MC 也讀這個）
- [ ] 模組化：新增 feature spec 或新增一個 project entry 無需改 dashboard code
- [ ] `docs/specs/workflow-dashboard.md` status 改為 `done` 作為 eat-own-dogfood 證據

### Phase 2（兩週內）
- [ ] 區塊 2：velocity（從 git log 推 feature 完成速度）
- [ ] 區塊 3：Quality 趨勢（validate-design 分數歷程，需要 skill 先能寫 log）
- [ ] 區塊 4：Skill 使用統計（從 `skill-executions.jsonl` 讀）

---

## 非需求（Out of Scope）

- ❌ **即時自動更新**：dashboard 是 pull-on-open 模式，不用 websocket / polling
- ❌ **使用者登入 / 多使用者**：Vincent 單人使用
- ❌ **修改 feature 狀態**：read-only，狀態來源仍是各 spec 的 frontmatter
- ❌ **真正整合 Mission Control**：只做 JSON schema，MC 整合是未來的事
- ❌ **Retrospective 自動化**：手動寫 retro 即可，不做額外機制
- ❌ **CHANGELOG 自動更新**：skill 版號仍手動維護
- ❌ **Skill trigger A/B 測試**：單獨議題，之後再說
- ❌ **Build step / npm / bundler**：MVP 維持純 HTML + vanilla JS

---

## 依賴

### 必須存在
- **各專案的 `docs/specs/*.md`** — frontmatter 有 `status` + `created`
- **Git**（velocity 區塊用，Phase 2）
- **`~/.openclaw/workspace/logs/skill-executions.jsonl`**（Skill 統計區塊用，Phase 2）— 目前**不存在**，需要先讓 skills 寫進去

### 不依賴
- 任何 npm 套件（MVP 純 vanilla）
- Obsidian（資料不從 vault 來）
- Vercel / 外部服務

---

## Open Questions

1. ~~Spec 放哪？~~ → 新建 `system-workflow` repo，本 spec 先寫在 `~/Downloads/Claude_協作/system-workflow/docs/specs/`，待 approved 後 `project-init` 開正式 repo
2. **Dashboard 怎麼掃 multi-project 的 specs/**？
   - 方案 A：硬寫 project path list（簡單但要維護）
   - 方案 B：walk 整個 `~/Downloads/Claude_協作/` 找 `docs/specs/*.md`（自動但可能誤抓）
   - 方案 C：每個 project 手動註冊進 `~/.openclaw/workspace/config/projects.json`
   - **建議：C**（最貼合 OpenClaw 現有 `repos.json` pattern）
3. **資料收集要不要改既有 skill**？
   - Phase 2 要量 skill usage 必須讓 skills 寫 log
   - 先確認：`skill-executions.jsonl` 這條路誰負責維護？是否統一加進所有 SKILL.md 的 closing action？
4. **MC schema 到底長怎樣**？
   - 沒有實際格式，先以 MVP 自身需要為主設計 JSON，留 `version: 1` 欄位方便 MC 之後對齊
5. **Dashboard 是否要版本控制**？
   - 是（新 repo 管）。但「即時渲染」時資料是現場掃的，不是 commit 的 snapshot

---

## 預計影響檔案

### 新建（新 repo `system-workflow/`）

```
system-workflow/
├── README.md
├── .gitignore
├── docs/
│   ├── WORKFLOW.md              ← 從 project-init templates 複製
│   ├── DESIGN_REVIEW_CHECKLIST.md
│   ├── mockups/
│   │   └── dashboard.html       ← 視覺稿
│   └── specs/
│       ├── _TEMPLATE.md
│       └── workflow-dashboard.md ← 本 spec，最終落地點
├── src/
│   ├── dashboard.html            ← MVP 主檔
│   ├── dashboard.js              ← 資料讀取 + 渲染（模組化）
│   ├── dashboard.css
│   └── modules/
│       ├── feature-board.js      ← 區塊 1 MVP
│       ├── velocity.js           ← 區塊 2（Phase 2）
│       ├── quality.js            ← 區塊 3（Phase 2）
│       └── skill-usage.js        ← 區塊 4（Phase 2）
├── scripts/
│   ├── scan-specs.sh             ← 掃 specs 產 JSON
│   └── build-data.sh             ← 總組合器
└── config/
    └── projects.json             ← 登記要追蹤的 project path
```

### 修改（其他 repo / 系統）

- `~/.openclaw/workspace/MEMORY.md` — 新增 system-workflow 條目（HiSenzi 負責）
- `~/.claude/skills/developing-features/SKILL.md` — 加一段「完成後更新 dashboard projects.json」的 hint（可選）
- 各既有 SKILL.md — Phase 2 需要統一加 log 寫入（另外再開 spec）

---

## 驗證方式

### MVP 驗收（跟 developing-features 流程搭配）
- [ ] `validate-design` skill 對 `docs/mockups/dashboard.html` 跑過 ≥ 75 分
- [ ] `validate-design` skill 對 `src/dashboard.js` 跑過（或 skip UI 層 checklist）
- [ ] 瀏覽器開 `src/dashboard.html` 能看到 Mapelon 的 specs 清單
- [ ] 每個區塊 module 可獨立 enable/disable（comment 一行就能關掉某區塊）
- [ ] `dashboard-data.json` 結構清晰、有 `version` 欄位

### 持續優化驗證（系統層）
- [ ] 新增一個 feature spec（任何專案）→ 重 load dashboard → 自動出現，無需改 code
- [ ] 刪除 `modules/quality.js` → 其他 3 區塊仍正常工作
- [ ] 未來 MC 原型只需讀 `dashboard-data.json`，不需呼叫 dashboard code

---

## 實作差異（施工後回填）

TBD — spec approved 後、實作中發現的偏離記在這

---

## 參考資料

- **相關 spec**：
  - `~/Downloads/Claude_協作/Mapelon_2.0_files/260323_maplon-client-next_落地版哈密瓜前台程式碼_家浚/docs/specs/weather-layer.md`（spec 範本參考）
- **Orchestrator**：`~/.claude/skills/developing-features/SKILL.md`
- **既有 log pattern**：`~/.claude/skills/project-init/SKILL.md` → Step 6 寫 `skill-executions.jsonl`
- **mockup**（Phase 3 後建立）：`docs/mockups/dashboard.html`

---

## 回溯補寫說明

不適用 — 此為 spec-first 開發，本 spec 於 2026-04-18 開工第一天寫下，是全新功能。
