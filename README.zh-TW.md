# Agent Skyline

[English](README.md)

**看著 AI coding agent 工作,在它寫進不該碰的地方之前擋下來。**

Agent Skyline 把 git repo 畫成一座 3D 城市:資料夾是街區、檔案是大樓、大樓高度是行數。Claude Code(或 pi)讀寫檔案時,對應的大樓會即時亮起來。

[![Agent Skyline 演示](demo/poster.jpg)](https://github.com/Zuexx/agent-skyline/releases/download/demo/agent-skyline-demo.mp4)

▶ 演示影片(約 4 分鐘):點上面的圖片,或到 [release 頁面](https://github.com/Zuexx/agent-skyline/releases/tag/demo)下載。

## 能做什麼

- **即時看見**:agent 讀了哪些檔案(藍色)、改了哪些(琥珀色),當下就看得到。
- **鎖住資料夾**:寫進禁區的動作會**在發生之前就被擋下**,不論是 Edit/Write,還是 `echo … > file` 這類 shell 指令。
- **Review 分支**:和 `main` 比較,城市依 git diff 上色;review 清單把風險最高的改動排在前面(沒有測試、很多檔案依賴、改動很大)。
- **派工作**:拖曳框選幾棟大樓,這些檔案就變成交給 agent 的任務範圍。

只在你的電腦上執行(伺服器只綁 127.0.0.1),支援 **Claude Code** 和 **pi**。其他人或其他工具改的檔案,也會透過檔案監看顯示出來。

## 快速開始

需要 Node 22 以上和 git。要看的資料夾必須是 git repo(`git init` 一次就好)。

```bash
git clone https://github.com/Zuexx/agent-skyline.git
cd agent-skyline

cd web && npm install && npm run build  # 1. 建置畫面(只要做一次)
cd ..
node server/server.mjs --repo D:/path/to/your/repo   # 2. 啟動伺服器
```

3. 打開 http://127.0.0.1:4477 ,就會看到你的 repo 變成一座城市。

4. 接上 Claude Code,讓城市看得到它在做什麼,也能擋下寫入:

   ```bash
   node cli/install-hooks.mjs D:/path/to/your/repo --write
   ```

   這會寫入 `<你的 repo>/.claude/settings.local.json`,請把這個路徑加進該 repo 的 `.gitignore`。之後**新開**的 Claude Code 工作階段才會載入 hook;刪掉這個檔案就移除了。

手邊沒有 agent?`node cli/simulate.mjs` 可以播放一段模擬的工作,用法見完整說明。

## 延伸閱讀

| 文件 | 內容 |
|---|---|
| [`docs/guide.zh-TW.md`](docs/guide.zh-TW.md) | 完整說明:pi、開工作階段時自動啟動、禁區、畫面上每個功能、測試 |
| [`docs/NOTES.zh-TW.md`](docs/NOTES.zh-TW.md) | 構想,以及為什麼做成這樣 |
| [`docs/PROGRESS.zh-TW.md`](docs/PROGRESS.zh-TW.md) | 開發過程:每個決定,和一次事故 |

原名 CodeCity,因為已經有好幾個專案用了這個名字,所以改名。

## 授權

MIT,見 [`LICENSE`](LICENSE)。
