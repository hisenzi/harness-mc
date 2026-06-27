# Worktree Status Handoff（2026-06-15）

## 背景

Vincent 指出目前真正問題不是「髒 worktree 怎麼 commit」，而是：

> 沒 commit 的，我怎麼知道？

這要用 MC 解，不靠聊天記憶或每次手動 `git status`。

## 已完成

ACP-MC-13～17 已先在乾淨 worktree commit，避免混入主 worktree 的其他 session 變更。

`harness-mc` clean worktree:

```text
$COLLAB/harness-mc-acp-event-pipeline
branch: acp-mc-event-pipeline

0c26aab chore(control-plane): mark task event pipeline tasks complete
f53fc8c feat(control-plane): add task event pipeline
```

`notyet-harness` clean worktree:

```text
$COLLAB/notyet-harness-acp-event-pipeline
branch: acp-mc-event-pipeline-support

9167e8d docs(agent): record task event commit workflow
```

主 worktree 仍然很髒，未清理，不能用 broad `git add .`。

## 查到的既有系統

已有一半：

- `$COLLAB/harness-mc/scripts/sentinel-diff.mjs`
- 它會用 git baseline 比對 `milestones/*/tasks.json`
- 現況包含 working tree，所以能看到未 commit 的 task 變化
- MC 首頁 Sentinel 可顯示今日 task 變化、blocked、stale

缺的不是 Sentinel，而是完整的 workspace dirty inventory。

## 真正要做的下一步

新增一個後續任務，暫名：

```text
ACP-MC-18: 待收尾工作盤點
```

它在 MC 首頁負責回答：

```text
哪些工作還沒收尾？
哪裡有未提交變更？
哪裡有本機未推送 commit？
哪裡需要對帳？
```

繁中首頁區塊名稱：

```text
待收尾工作
```

三個狀態：

```text
未提交變更
本機未推送
需要對帳
```

不要在首頁第一層用英文：

```text
Uncommitted Work
Local Commits
Needs Reconcile
```

這些只可當內部資料欄位或註解。

## 重要限制

Vincent 明確要求：

> MC 首頁顯示用 HTML 確認，不要亂做，亂做要重做。

所以下一步流程是：

1. 先做 HTML mockup。
2. 放在 `$COLLAB/harness-mc/system-workflow/docs/mockups/`。
3. 文案全繁中。
4. 只用假資料。
5. 不碰 `app/page.tsx`。
6. Vincent 確認後，才寫資料層與 React 實作。

## 建議完成標準

ACP-MC-18 可拆成：

```text
產出 system-workflow/docs/mockups/worktree-status.html，
以繁中顯示「待收尾工作」區塊：
未提交變更 / 本機未推送 / 需要對帳。
HTML 經 Vincent 確認後，才新增 generate-worktree-status.mjs 與首頁 React 實作。
```

後續資料層可產出：

```text
public/data/worktrees.json
```

欄位建議：

```text
repo
path_label
branch
head
is_detached
staged_count
unstaged_count
untracked_count
local_commits_count
status
risk
suggested_action
files[]
```

## 注意

CORE.md 已補讀。共享文件路徑必須使用 `$COLLAB/`，不要寫死本機絕對路徑。

