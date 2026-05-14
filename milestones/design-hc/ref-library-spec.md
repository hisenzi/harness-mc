# 設計參考資料庫分類規格

> task: `p0-ref-library`
> source: `CC本機協作_無Git/00_Creative_Tools/Sample/`
> consumer: VLM Triage v2（參考圖風格提取）、Prompt Builder（風格關鍵字）

## 現況

13 資料夾，22,000+ 檔案，混用 5 種分類軸（設計領域 / 媒材 / 獲取情境 / 業種 / 用途意圖）。

| 現有資料夾 | 檔案數 | 隱含分類軸 |
|---|---|---|
| 看展覽 | 14,268 | 獲取情境（在哪看到的） |
| 房地產 | 3,060 | 業種專案 |
| Design | 2,234 | 設計領域（萬能桶） |
| Brand | 1,727 | 設計領域 |
| Illustrator | 882 | 媒材形式 |
| Photograph | 336 | 媒材形式 |
| Fine Arts | 276 | 媒材形式 |
| UI | 121 | 設計領域 |
| Idea | 87 | 用途意圖 |
| Typography | 6 | 設計領域 |
| AI_圖庫風格 | 2 | 產出工具 |
| 名言 | 1 | 內容類型 |

## 設計原則

1. **AI Agent 是使用者**，不是人在瀏覽資料夾。分類要讓 Agent 靠路徑就能縮小搜索範圍。
2. **主軸對齊 cascade 架構**（Brand Identity → KV/平面 → Web/UI），跟 `project.type` 一致。
3. **媒材是第二維度**，獨立於產出類型。插畫風格的品牌設計放 `brand-identity/`，不放 `illustration/`。純粹的媒材參考（不屬於特定產出類型）放 `_visual-medium/`。
4. **不是設計參考的東西隔離**，不混在檢索範圍內。

## 目標結構

```
Sample/
├── brand-identity/          # cascade 根：Logo、VI、CI、名片、品牌指南
├── kv-print/                # cascade 中層：消費 tokens 的單畫面產出
│   ├── packaging/
│   ├── poster-dm/
│   ├── editorial/           # 雜誌、型錄、書籍
│   ├── advertising/
│   └── infographic/
├── web-ui/                  # cascade 末端（Phase 2 才重點整理）
│   ├── website/
│   └── app-ui/
├── spatial/                 # 展覽、商空、招牌、展場裝潢
├── product/                 # 公仔、玩具、工業設計、周邊
├── _visual-medium/          # 純媒材參考（不屬於特定產出類型）
│   ├── illustration/
│   ├── photography/
│   ├── fine-art/
│   └── typography/
├── _non-ref/                # 非設計參考
│   ├── 房地產/
│   ├── 看展覽-personal/     # 看展覽中純個人記錄的部分
│   └── misc/                # 名言、AI_圖庫風格
└── _index.md                # Agent 檢索索引（含 cascade / imagery.style / HC 對照表）
```

## 遷移對應

### 直接搬移

| 來源 | → 目標 | 檔案數 |
|---|---|---|
| Brand/ | `brand-identity/` | 1,727 |
| Illustrator/ | `_visual-medium/illustration/` | 882 |
| Photograph/ | `_visual-medium/photography/` | 336 |
| Fine Arts/ | `_visual-medium/fine-art/` | 276 |
| Typography/ | `_visual-medium/typography/` | 6 |
| 房地產/ | `_non-ref/房地產/` | 3,060 |

### Design/ 拆分（2,234 檔）

| Design 子資料夾 | → 目標 | 檔案數 |
|---|---|---|
| Package | `kv-print/packaging/` | 983 |
| Poster_DM | `kv-print/poster-dm/` | 400 |
| infographic | `kv-print/infographic/` | 171 |
| figure | `product/` | 164 |
| award | `kv-print/editorial/` | 81 |
| website | `web-ui/website/` | 81 |
| shows | `spatial/` | 38 |
| Calendar | `kv-print/editorial/` | 25 |
| display | `spatial/` | 23 |
| 鈔票設計 | `kv-print/editorial/` | 22 |
| Serpent Card | `brand-identity/` | 18 |
| Valentine's_Day, Xmas, 節慶 | `kv-print/poster-dm/` | 29 |
| T-shirt | `product/` | 15 |
| 票夾 | `product/` | 15 |
| AD | `kv-print/advertising/` | 13 |
| Metal_Text | `_visual-medium/typography/` | 12 |
| EC_banner | `kv-print/advertising/` | 8 |
| 小朋友看地球儀 | `_non-ref/misc/` | 8 |
| Stylish, 復古, 特效 | 按內容逐張判斷 | 74 |
| Pista, Postscard, layout | `kv-print/` 散落歸位 | 8 |
| 散落檔案（根層級） | 按內容逐張判斷 | 46 |

### 看展覽 處理策略（14,268 檔）

最大工程。子資料夾已有結構（按日期+展覽名），內容混雜品牌、空間、產品、純藝術。

**策略：先按子資料夾名稱批次歸類，再逐批 VLM 掃描驗證。**

| 子資料夾模式 | → 目標 | 範例 |
|---|---|---|
| 展覽裝潢、商空裝潢 | `spatial/` | 00商空裝潢、00展覽裝潢 |
| 設計展、設計師週 | `spatial/` + 內含設計作品拆出 | 061028台灣設計師週、110412_Good Design |
| 藝術展（米開朗基羅、雷諾瓦、維梅爾） | `_visual-medium/fine-art/` | 130503米開朗基羅特展、140408維梅爾 |
| 科技展（Computex、CES、資訊月） | `_non-ref/看展覽-personal/` | 非設計參考 |
| 玩具/公仔展 | `product/` | 040202鋼彈、100402環球公仔展 |
| 印刷相關 | `kv-print/` | 090216夾練袋印刷、120919喬羽印刷機 |
| 其他個人記錄 | `_non-ref/看展覽-personal/` | 保留原結構 |

### 小分類處理

| 來源 | → 目標 |
|---|---|
| UI/ | `web-ui/app-ui/` |
| Idea/ | 按內容逐張歸位到對應類別 |
| AI_圖庫風格/ (2) | `_non-ref/misc/` |
| 名言/ (1) | `_non-ref/misc/` |

## _index.md schema（Phase 2）

VLM 批次掃圖自動生成，Agent 直接 query。

```yaml
version: 1
generated: 2026-MM-DD
entries:
  - path: brand-identity/350GRAM/cover.jpg
    type: branding                    # project.type
    medium: photography               # imagery.style
    mood: [minimal, premium]          # emotionalResonance 關鍵字
    hc_relevant: [brandCoherence, whitespace, colorHarmony]
    industry: food-beverage
    keywords: [beer, craft, label]
```

## 執行順序

1. 建立目標資料夾結構（空殼）
2. 直接搬移類（Brand, Illustrator, Photograph, Fine Arts, Typography, 房地產）
3. Design/ 拆分
4. UI/ + Idea/ + 小分類歸位
5. 看展覽/ 按子資料夾名稱批次歸類（第一輪，靠名稱判斷）
6. 看展覽/ 第二輪：VLM 掃描驗證 + 細分（Phase 2 隨 _index.md 一起做）

## 與其他 task 的關係

- `p1-vlm-triage-v2`：本庫是「參考圖 → 風格特徵提取」的資料來源
- `p1-style-reference-lib`：GARYTU 風格參考庫是 AI 生成用的 prompt 詞彙，跟本庫用途不同，不混
- `p0-verify`：Phase 0 真案 demo 時可用本庫的參考圖做風格對照
