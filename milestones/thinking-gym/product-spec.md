# 思考健身房 Thinking Gym — MVP 產品規格

> Phase 0 目標：用最小網頁驗證 3 個核心假說（遷移 / AI 回饋 / 留存）
> 受眾：3-5 名國中生（白名單邀請）
> 參考：POPPINS 數位錯題本（BYOK + 零後端 AI 調用）

---

## 1. 架構原則

| 原則 | 設計 |
|------|------|
| 資料隱私在使用者 | AI API Key 用 BYOK，存 localStorage，不經伺服器 |
| 追蹤數據在 Vincent | 練習回應 + 行為紀錄寫入 Supabase，供追蹤與優化 |
| 封閉存取 | 只有白名單 Gmail 可註冊登入（Google OAuth） |

---

## 2. 頁面結構

### 使用者端

| 頁面 | 路徑 | 功能 |
|------|------|------|
| 登入 | `/` | Google OAuth → 白名單檢查 → 引導設定 API Key |
| API Key 設定 | `/setup` | BYOK 輸入 + 安全說明 + 測試連線（同 POPPINS 模式） |
| 脈絡選擇 | `/exercise` | 五脈絡選一（校園/社團/人際/家庭/網路）→ 系統分配 HC + 情境 |
| 三拍練習 | `/exercise/[sessionId]` | Beat 1 陷阱 → Beat 2 揭示 → Beat 3 遷移，不可回退 |
| 練習完成 | `/exercise/[sessionId]/done` | 今日摘要 + 累計統計 |
| 即時問題 | `/ask` | 帶入真實問題 → AI 用 HC 路由拆解 → 思考重播 |
| 我的紀錄 | `/history` | 練習歷史列表（Phase 0 簡版：日期 + 脈絡 + HC） |

### 管理端（Vincent）

| 頁面 | 路徑 | 功能 |
|------|------|------|
| 總覽 | `/admin` | 活躍人數、今日完成、30 天完成率熱力圖 |
| 回應標注 | `/admin/responses` | 逐筆看回應 + 標注踩坑/遷移成功/HC 步驟 |
| 參與者詳情 | `/admin/participants/[id]` | 個人時間軸 + HC 覆蓋 + 踩坑率趨勢 |
| 白名單管理 | `/admin/whitelist` | 新增/移除允許的 Gmail + 動機分組 |
| 情境庫管理 | `/admin/scenarios` | 查看/編輯三拍情境 + 啟用/停用 |
| 數據匯出 | `/admin/export` | CSV/JSON 匯出 + 預建查詢（H-A/H-B/H-C 指標） |

---

## 3. 使用者流程

```
[首次] 
  開啟首頁 → Google 登入 → 白名單驗證
    ├─ 不在白名單 → 「此系統為邀請制」訊息
    └─ 通過 → API Key 設定頁
         ├─ 貼上 Google AI API Key（附免費申請連結）
         ├─ 勾選「記住金鑰」（存 localStorage）
         ├─ 測試連線 → 成功 → 進入練習
         └─ 安全提示：「金鑰僅存於你的瀏覽器，不會傳到伺服器」

[每日練習]
  選脈絡（5 選 1）
    ↓ 系統從該脈絡抽題，HC 交錯分配
  Beat 1：讀情境 → 文字作答 → 送出（不可回退）
    ↓ 回應寫入 Supabase
  Beat 2：揭示盲點 + 命名 HC + 解釋思考模式
    ↓ 繼續
  Beat 3：新脈絡同結構陷阱 → 文字作答 → 送出
    ↓ 回應寫入 Supabase
  完成頁：今日 HC、累計練習數、連續天數

[即時問題]（任何時候）
  點「帶入我的問題」→ 描述遇到的問題
    ↓ AI（BYOK）讀 HC 路由表比對
  HC 拆解結果 + 思考重播
    ↓ 問題 + AI 分析寫入 Supabase
  可選：收藏 / 再問一題

[Pre/Post Test]（Day 1 / Day 31）
  獨立入口 → 3 道開放題 → 不揭示 HC → 作答寫入 DB
```

---

## 4. 技術選型

| 項目 | 選擇 | 理由 |
|------|------|------|
| 框架 | **Next.js 14+**（App Router） | 多步驟互動表單 + API Routes + 管理後台 SSR，Astro 適合靜態站不適合互動 app |
| 資料庫 | **Supabase**（Postgres + Auth + RLS） | 結構化追蹤數據 + 內建 Google OAuth + Row Level Security |
| 認證 | **Supabase Auth**（Google OAuth） | 白名單以 `allowed_emails` 表 + RLS policy 實作 |
| AI 調用 | **BYOK**（client-side） | API Key 存 localStorage → 瀏覽器直呼 Google AI API → 不經伺服器 |
| AI 提供者 | **Google AI（Gemini）**為主 | 免費額度足夠 Phase 0 pilot；Phase 1 加 Claude / GPT |
| 樣式 | **Tailwind CSS** | 快速原型，元件化 |
| 部署 | **Vercel** | Next.js 原生支援、免費額度、自動部署 |
| 共用層 | 與 exam-prep-6yr 共用 **Supabase 專案** | 同一 Postgres 實例，分 schema（`thinking_gym.*` vs `exam_prep.*`） |

### BYOK 架構細節

```
瀏覽器（使用者端）                    伺服器端（Vincent）
┌─────────────────────┐           ┌──────────────────┐
│  localStorage       │           │  Supabase        │
│  ├─ API Key         │           │  ├─ auth.users   │
│  └─ 記住金鑰偏好    │           │  ├─ sessions     │
│                     │           │  ├─ responses    │
│  Google AI API ←────┼── 直呼 ──→│  ├─ annotations  │
│  （AI 生成/分析）   │           │  ├─ scenarios    │
│                     │           │  └─ allowed_emails│
│  Supabase Client ───┼── 寫入 ──→│                  │
│  （追蹤數據）       │           │                  │
└─────────────────────┘           └──────────────────┘

AI 回應 → 只在瀏覽器處理 → 不存伺服器
練習回應文字 → 寫入 Supabase → Vincent 追蹤用
```

---

## 5. 資料模型（Supabase）

### `allowed_emails` — 白名單

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | uuid PK | |
| email | text UNIQUE | 允許的 Gmail |
| display_name | text | 顯示名稱 |
| motivation_group | text | `autonomous` / `reminded` |
| created_at | timestamptz | |

### `scenarios` — 情境庫

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | text PK | e.g. `rt-campus-01` |
| hc_id | text | `#rightProblem` 等 |
| context | text | 校園/社團/人際/家庭/網路 |
| trap_depth | int | 1-4（Phase 0 全部 Lv1） |
| beat_1_text | text | 陷阱情境 |
| beat_2_text | text | 揭示 + HC 解釋 |
| beat_3_text | text | 遷移情境 |
| beat_3_reference | text | 理想遷移回應（評分參考） |
| active | boolean | 啟用/停用 |

### `sessions` — 練習紀錄

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | uuid PK | |
| user_id | uuid FK | → auth.users |
| scenario_id | text FK | → scenarios |
| context | text | 當次選擇的脈絡 |
| hc_id | text | 系統分配的 HC |
| trap_depth | int | 當次深度 |
| started_at | timestamptz | |
| completed_at | timestamptz | null = 未完成 |

### `responses` — 逐拍回應

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | uuid PK | |
| session_id | uuid FK | → sessions |
| beat | int | 1 或 3（有文字輸入的拍） |
| response_text | text | 使用者作答全文 |
| submitted_at | timestamptz | |

### `annotations` — Vincent 標注

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | uuid PK | |
| response_id | uuid FK | → responses |
| is_trapped | boolean | Beat 1：是否踩坑 |
| transfer_success | boolean | Beat 3：遷移是否成功 |
| hc_steps_identified | text[] | 辨識到的 HC 步驟 |
| quality_score | int | 1-5 品質分（選用） |
| notes | text | 標注備註 |
| annotated_at | timestamptz | |

### `hc_assignments` — 交錯分配追蹤

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | uuid PK | |
| user_id | uuid FK | → auth.users |
| scenario_id | text FK | → scenarios |
| hc_id | text | |
| assigned_at | timestamptz | |
| completed | boolean | |

### `ask_sessions` — 即時問題

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | uuid PK | |
| user_id | uuid FK | → auth.users |
| problem_text | text | 使用者輸入的問題 |
| hc_ids_matched | text[] | AI 路由比對到的 HC |
| ai_analysis | text | AI 拆解結果全文（含思考重播） |
| ai_model | text | 使用的 AI 模型 |
| bookmarked | boolean | 使用者是否收藏 |
| created_at | timestamptz | |

### `test_responses` — Pre/Post Test

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | uuid PK | |
| user_id | uuid FK | → auth.users |
| test_type | text | `pre` / `post` |
| question_id | text | |
| response_text | text | |
| hc_steps_count | int | Vincent 標注 |
| hc_steps_detail | text[] | Vincent 標注 |
| submitted_at | timestamptz | |

---

## 6. 管理後台功能

### 6.1 總覽儀表板 `/admin`

- 活躍參與者數 / 總白名單數
- 今日完成練習人數
- 30 天完成率熱力圖（X 軸日期 × Y 軸參與者）
- HC 分佈圓餅圖（已完成的練習按 HC 分類）
- 待標注回應數（alert badge）

### 6.2 回應標注面板 `/admin/responses`

- 篩選：參與者 / 日期 / HC / 脈絡 / 未標注優先
- 每筆展開：情境原文 → Beat 1 回應 → Beat 3 回應
- 行內標注：踩坑？/ 遷移成功？/ HC 步驟多選 / 備註
- 批次模式：快速逐筆標注（鍵盤快捷鍵）

### 6.3 參與者詳情 `/admin/participants/[id]`

- 練習時間軸（每天一筆，顯示 HC + 脈絡 + 完成狀態）
- HC 覆蓋圖（6 HC × 已做/未做/踩坑率）
- 踩坑率隨時間趨勢（折線圖）
- 遷移成功率隨時間趨勢（折線圖）
- Pre vs Post test HC 步驟數比較

### 6.4 數據匯出 `/admin/export`

- 預建查詢：
  - H-A 指標：per-user pre/post HC 步驟數 + 遷移成功率趨勢
  - H-B 指標：AI 揭示後 vs 人工回饋後的改善率
  - H-C 指標：per-group 30 天完成率
- 匯出格式：CSV / JSON
- 時間範圍篩選

---

## 7. 與 exam-prep-6yr 共用介面

### 7.1 共用 Supabase 專案

```
Supabase Project: "notyet-edu"
├── Schema: public        ← 共用表（profiles, hc_reference）
├── Schema: thinking_gym  ← 思考健身房專用
└── Schema: exam_prep     ← 六年一貫專用
```

### 7.2 共用介面定義

```typescript
// ---- 共用：使用者 ----
interface UserProfile {
  id: string              // auth.users.id
  email: string
  display_name: string
  systems: ('thinking-gym' | 'exam-prep')[]
  created_at: string
}

// ---- 共用：HC 參考 ----
interface HCReference {
  id: string              // '#rightProblem'
  name_zh: string         // '問對問題'
  name_en: string         // 'Right Problem'
  category: 'critical' | 'creative' | 'communication' | 'interaction'
  subcategory: string     // '分析問題'
  priority: boolean       // 有完整操作手冊
}

// ---- Phase 2 跨系統鉤子 ----
interface CrossSystemTrigger {
  source: 'exam-prep'
  target: 'thinking-gym'
  event: 'exam_completed'
  payload: {
    hc_ids: string[]      // 該題涉及的 HC
    student_id: string
    context_hint: string  // 用來選脈絡
  }
}
```

### 7.3 共用元件

| 元件 | 來源 | 用法 |
|------|------|------|
| Supabase Auth（Google OAuth） | 共用 | 同一登入流程，系統欄位區分產品 |
| HC 知識庫 | `notyet-harness/300_Obsidian_brain/HC/` | thinking-gym 用做練習內容，exam-prep 用做策略驗證 |
| 追蹤模式 | NSG Tracker v2.0 模式 | 資料結構與儀表板設計模式複用 |

---

## 8. Phase 0 範圍邊界

### 做

- [x] Google OAuth + 白名單 Gmail
- [x] BYOK（Google AI API Key，localStorage）
- [x] 三拍互動流程（陷阱→揭示→遷移）
- [x] 脈絡選擇（5 脈絡）+ HC 交錯分配
- [x] 回應自動寫入 Supabase
- [x] 管理後台：回應標注 + 參與者追蹤 + 數據匯出
- [x] Pre/Post test 頁面
- [x] 即時問題模式（帶入真實問題 → AI HC 拆解）
- [x] 30 天完成率追蹤

### 不做（Phase 1+）

- [ ] 自動調適陷阱深度（Phase 0 全 Lv1）
- [ ] Claude / GPT API 支援（Phase 0 只 Gemini）
- [ ] 學習者個人儀表板 / 雷達圖
- [ ] 動機設計（streak/徽章/排行榜）
- [ ] 社會互動層（對打/群組）
- [ ] 情境 AI 即時生成（Phase 0 用預建情境庫）
- [ ] 推播通知（Phase 0 用 LINE 手動提醒）

---

## 9. 完成標準

| 交付物 | 驗證方式 |
|--------|----------|
| 本文件（product-spec.md） | Vincent 審閱 |
| 技術棧選型確認 | 以本文件 §4 為準 |
| 架構圖（元件 + 資料流） | 本文件 §4 BYOK 架構圖 |
| 共用介面定義 | 本文件 §7 TypeScript 介面 |
| 資料模型 | 本文件 §5 → 實作為 Supabase migration |
| MVP 可 demo | t0-9 端到端乾跑通過 |
