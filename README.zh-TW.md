# Agent Skyline

[English](README.md)

發想「用遊戲風、等角或 3D 場景呈現結構化資料」的新應用,並把其中一個想法做成可用的工具。

原名 CodeCity,因為已經有好幾個專案用了這個名字,所以改名。

## 內容

- `agent-skyline/`:把 repo 畫成 3D 城市,即時監督 AI coding agent:讀寫了什麼、用禁區擋下寫入、用 git diff 比較分支。從 `agent-skyline/README.zh-TW.md` 開始讀。

[![Agent Skyline 演示](agent-skyline/demo/poster.jpg)](https://github.com/Zuexx/agent-skyline/releases/download/demo/agent-skyline-demo.mp4)

有配音的演示影片(約 4 分鐘):點圖片,或到 [release](https://github.com/Zuexx/agent-skyline/releases/tag/demo) 下載。

## 慣例

- 影片檔(`*.mp4`、`*.webm`、`*.mkv`)被 `.gitignore` 排除;演示影片放在 release 的附件。
- Agent Skyline 的 `node_modules/`、`web/dist/` 和即時資料 `data/`(事件紀錄、禁區設定)也不進版控。
- 文件以英文為主,旁邊附繁體中文版(`*.zh-TW.md`)。

## 授權

MIT,見 `LICENSE`。
