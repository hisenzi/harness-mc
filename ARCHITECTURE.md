# Mission Control — 共享儀表板

> Agent 無關的專案追蹤系統。資料屬於 Vincent，CC 和 HiSenzi 都能讀寫。

## 四大支柱（Harness Engineering）

| 支柱 | MC 呈現方式 | 狀態 |
|------|-----------|------|
| 規劃與執行 | `/projects` 完整頁面 | Phase 1 |
| 評估 | `/evaluation` 獨立頁面（verdict/issues/foundation 視角） | Phase 1（HC 驗證即首個案例） |
| 記憶 | 首頁狀態卡片 | Phase 2 |
| 工具 | 首頁狀態卡片 | Phase 3 |

## 目錄結構

```
harness-mc/                       ← 獨立 git repo（GitHub: hisenzi/harness-mc）
├── ARCHITECTURE.md               ← 本文件
├── app/
│   ├── layout.tsx                ← 暗色主題 layout
│   ├── page.tsx                  ← 首頁（四支柱卡片）
│   ├── globals.css               ← CSS 變數 + 暗色主題
│   ├── evaluation/
│   │   └── page.tsx              ← 評估頁（按 verdict 分組，聚焦驗證結果）
│   ├── projects/
│   │   └── page.tsx              ← 專案列表 + 詳情 modal（按 track 分組）
│   └── api/
│       └── projects/
│           └── route.ts          ← 讀 milestones/ 回傳 JSON
├── lib/
│   ├── json.ts                   ← JSON parse 工具
│   └── paths.ts                  ← 路徑設定（指向 milestones/）
├── milestones/                   ← 專案資料（agents 共寫）
│   └── hc-validation/
│       ├── project.json          ← 專案 metadata
│       └── tasks.json            ← 20 個 HC 驗證任務
├── package.json
├── tsconfig.json
├── next.config.mjs
└── postcss.config.js
```

## 資料格式

沿用 OC milestones 的 `project.json` + `tasks.json`，相容既有格式。

### tasks.json 支援的格式

1. `{ "tasks": [...] }` — flat format（推薦）
2. `[...]` — pure array
3. `{ "dev": [...], "ops": [...] }` — dev/ops split

### HC 驗證擴充欄位

在標準 task 基礎上加：

```json
{
  "id": "fallacies",
  "title": "#fallacies 邏輯謬誤",
  "status": "needs_fix",
  "track": "formal-logic",
  "foundation": "極強",
  "issues_found": 2,
  "issues_fixed": 0,
  "verdict": "可用需修",
  "note": "循環論證/乞題重複；倖存者偏誤跨類"
}
```

## 與 OC MC 的關係

- OC MC（`.openclaw_260418/mission-control/`）保持不動
- 本 MC 從 OC MC 複製 projects 相關的 UI 邏輯，去掉 OC 專屬功能
- 資料格式相容，未來 OC 專案可用 symlink 或批次搬移

## 技術棧

- Next.js 16 + React 19 + Tailwind v4 + TypeScript（與 OC MC 一致）

## 從 OC MC 沿用

- projects page 卡片 + modal 佈局
- API route 的多格式 JSON parser
- CSS 變數暗色主題
- `lib/json.ts`

## 不帶入

- `OPENCLAW_HOME` 路徑依賴
- sidebar（OC 全功能導航）
- i18n
- notifications / alerts / pixel-office
- finance / security-scans / sessions / gateway 等 OC 專屬頁面
