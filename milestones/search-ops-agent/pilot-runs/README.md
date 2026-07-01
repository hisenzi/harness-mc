# Search Ops Agent 試點初診工作區

此資料夾用來放第一個試點網站的 Search Ops 初診輸出。

每個試點建立一個資料夾：

```text
pilot-runs/YYYY-MM-DD-site-slug/
```

建議由 `_template/` 複製以下檔案開始：

- `intake.md`
- `diagnostic-summary.md`
- `url-backlog.csv`
- `30-day-plan.md`

## 完成條件

`p1-3` 不能只靠 public crawl 完成，至少需要：

- 試點網站 URL。
- GSC 權限或 GSC 匯出檔。
- sitemap URL 或 sitemap index URL。
- 可修改範圍：code / CMS / content / metadata / sitemap / robots / GSC。
- 重要頁清單或商業轉換頁。

若缺 GSC / Search Analytics，初診只能標記為 `public-only preliminary`，不可視為完整 Search Ops 初診。
