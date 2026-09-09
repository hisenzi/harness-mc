# MorroWise 網站發布操作入口

版本：v0.1.0 · 2026-09-10 · 狀態：本地實作中，尚未部署。

本站與說明書同屬 `harness-mc` repo：`/` 是 MC，`/docs` 是唯讀說明書。GitHub 保存發布版本，Zeabur 負責建置／運行；3001 保留開發預覽。登入權限不在本階段。

## 正文、生成物及薄連結

唯一人工正文目標為 `$COLLAB/harness-mc/docs/morrowise/OPERATOR-GUIDE.md`；registry 是來源與章節 ID 的控制入口。遷移完成前舊檔仍是 registry 指定正本；切換後舊檔只留指向新位置的薄入口，不維護第二份正文。歷史收據不改寫成新路徑。

`$COLLAB` 是已建置的本地協作環境標籤，不是網路連結，也不是從零安裝教學。公開讀者不需要或獲得存取本地來源的權限。

## 候選產生與驗證

在 repo 根目錄使用 Node.js 24 執行：

```sh
node scripts/prepare-morrowise-public-release.mjs --candidate
node scripts/prepare-morrowise-public-release.mjs --candidate --check
node scripts/verify-morrowise-public-release.mjs
```

產生前必須通過實際本地來源 impact gate 及獨立正文審查。公開 review 同時綁正文及整組 registry 輸入（排除 review 自身），修改摘要、導航或來源也必須重新審查，不能只重算發布包。候選輸出在 `release/morrowise-docs/{manifest,bundle}.json`，固定正文、registry、章節版本與指紋；`source_commit=null` 表示尚未封存，不能當成可部署版本。缺檔、變造、過期 review 或重建不一致均拒絕。

公開載入器只讀同 repo 的正文、registry 與發布包，不讀 sibling repo 或 `.tmp` 本地 bundle。固定發布版本的新鮮度不等於即時本地能力狀態。

## 建置與發布邊界

`MORROWISE_SITE_TARGET=zeabur` 選擇根路徑網站；不得同時設定 `MORROWISE_DOCS_LOCAL_PREVIEW=1`。本地候選另需 `MORROWISE_PUBLIC_CANDIDATE=1`，正式環境不可沿用。一般 Pages 建置保持原本排除本地說明書的行為。

公開輸出目標 `.tmp/morrowise-public/site` 與本地 `.tmp/morrowise-docs/site`、既有 `out` 分開。公開建置尚須完成 MC 公開資料的精確清單、固定輸入、洩漏檢查及無 sibling 環境重建；不能直接把所有 `public/data` 複製上線，也不能以空資料假裝健康。

## 尚未執行的發布步驟

本輪不 commit／push、不建立 Zeabur service、不切換 Pages、不同步 Heptabase。正式 commit 綁定、Zeabur 建置／啟動命令與 live URL 證據須於本地驗收通過後另行核准；尚未完成的命令不作為可執行部署指示。現行載入器尚未接上獨立的 Git provenance 驗證，因此正式發布模式維持拒絕；不能只填入看似合法的 commit SHA 就上線。

驗收需分開記錄：來源／薄連結、章節與搜尋／toggle、公開內容安全、輸出隔離、乾淨 checkout 可重建、commit 綁定、雲端部署及 live 驗收。任何前項通過不代表後項自動通過。
