# game-view-ideas

收集「用遊戲風、等角或 3D 場景呈現結構化資料」的參考案例,拿來發想新應用,並把其中一個想法做成可用的工具。

## 內容

- `waretrack/`:3D 倉儲管理 App 的影片拆解(`NOTES.md` 是重點,從這裡開始讀)。
- `codecity/`:把 repo 畫成 3D 城市,即時監看 Claude Code 讀寫哪些檔案、劃禁區、比較分支差異。從 `codecity/README.md` 開始讀;構想在 `NOTES.md`,開發過程和決定在 `PROGRESS.md`。

## 慣例

- 參考案例:每個案例一個資料夾,裡面放 `NOTES.md`、`frames/`(截圖)和 `video.info.json`。
- 影片檔(`*.mp4`、`*.webm`、`*.mkv`)被 `.gitignore` 排除,只留在本機。
- CodeCity 的 `node_modules/`、`web/dist/` 和即時資料 `data/`(事件紀錄、禁區設定)也不進版控。
