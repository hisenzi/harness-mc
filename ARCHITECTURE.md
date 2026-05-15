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
│   └── projects/
│       └── page.tsx              ← 專案列表 + 詳情 modal（按 track 分組）
├── scripts/
│   └── generate-data.mjs         ← build 時讀 milestones/ 打包成靜態 JSON
├── public/
│   └── data/
│       └── projects.json         ← generate-data 產出（git 不追蹤）
├── milestones/                   ← 專案資料（agents 共寫）
│   ├── harness-mc/               ← MC 自身
│   ├── hc-validation/            ← HC 驗證（20 tasks）
│   ├── dual-blade/               ← 雙刀流系統
│   ├── house123-buy/             ← 第二間房產購置評估
│   └── digital-ops-sub/          ← 數位營運架構師訂閱制
├── .github/
│   └── workflows/
│       └── deploy.yml            ← push main → GitHub Actions → GitHub Pages
├── package.json
├── tsconfig.json
├── next.config.mjs
└── postcss.config.js
```

## 部署架構

**靜態輸出**（`output: "export"`），無 API route、無 server-side code。

```
milestones/*.json
    ↓ prebuild（node scripts/generate-data.mjs）
public/data/projects.json
    ↓ next build
out/                              ← 純靜態 HTML/JS/CSS
    ↓ GitHub Actions
hisenzi.github.io/harness-mc/
```

- `basePath: "/harness-mc"`（production only）
- 前端 fetch 讀 `/data/projects.json`（build 時 inline basePath）
- 本機 dev：`npm run dev`（port 3001），prebuild 自動跑 generate-data

## 資料格式

沿用 OC milestones 的 `project.json` + `tasks.json`，相容既有格式。

### tasks.json 支援的格式

1. `{ "tasks": [...] }` — flat format（推薦）
2. `[...]` — pure array
3. `{ "dev": [...], "ops": [...] }` — dev/ops split

### task 標準欄位

| 欄位 | 類型 | 必要 | 說明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一識別碼（kebab-case） |
| `title` | string | ✅ | 任務標題 |
| `status` | string | ✅ | `completed` / `pending` / `blocked` / `needs_fix` |
| `track` | string | ✅ | 分類（`feature` / `tech-debt` / `handover` / `deploy` 等） |
| `completed_at` | string | | 完成日期（`YYYY-MM-DD`） |
| `commits` | string[] | | git commit hash 陣列，MC 前端會截取前 7 碼顯示 |
| `summary` | string | | 完成後的摘要說明 |
| `note` | string | | 未完成 task 的補充說明 |

> **注意：** 欄位名是 `commits`（複數、陣列），不是 `commit`（字串）。MC 前端只認 `commits`。

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
