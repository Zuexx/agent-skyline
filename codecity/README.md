# CodeCity

把一個 git repo 畫成 3D 城市:資料夾是街區、檔案是大樓、大樓高度是行數。主要用途是**監督 AI coding agent**:
即時看到它讀寫哪些檔案、在城市上劃禁區擋下寫入、比較分支看這次改了什麼。

- 構想與評估:`NOTES.md`
- 開發過程、每個決定的理由、事故紀錄:`PROGRESS.md`
- 每一步的規格:`specs/`

## 快速開始

需要 Node 22 以上和 git。

```bash
cd codecity/web && npm install && npm run build      # 建置畫面(只要做一次)
cd .. && node server/server.mjs --repo D:/path/to/repo # 啟動伺服器
```

打開 http://127.0.0.1:4477 。伺服器只綁 127.0.0.1。

選項:`--port <n>`、`--no-watch`(關閉檔案監看)。

## 接上 Claude Code

```bash
node cli/install-hooks.mjs D:/path/to/repo            # 印出要貼的設定
node cli/install-hooks.mjs D:/path/to/repo --write    # 直接寫入 <repo>/.claude/settings.local.json
```

寫入前請確認目標 repo 的 `.gitignore` 有排除 `.claude/settings.local.json`。裝好後,在該 repo **新開**的
Claude Code 工作階段才會載入 hook。要停止監看,刪掉那個檔案即可。

- `hooks/log-event.mjs`(PostToolUse):每次工具呼叫記一行事件到 `data/events.jsonl`。
- `hooks/guard.mjs`(PreToolUse):要寫入禁區時直接擋下。

沒有 hook 的 agent(或人)改的檔案,由伺服器的檔案監看記錄,標示為「檔案監看」,不知道是誰改的、也擋不了。

## 畫面上能做的事

| 功能 | 怎麼用 |
|---|---|
| 分組方式 | 資料夾 / 角色(程式碼、測試、規格…)/ 本次動過 / 差異。切換時大樓會飛到新位置 |
| 即時動態 | 左下角;可篩選、往回捲;點檔案讓鏡頭飛過去,點指令展開完整內容 |
| 比較分支 | 選一個分支和 main 比較,依 git diff 上色;點大樓看 diff |
| 禁區 | 鎖頭 icon → 點街區鎖定或解鎖;鎖定後 hook 會擋下寫入 |
| 鏡頭 | 地圖 icon 回到全景;準星 icon 跟隨最新動作;雙擊大樓飛過去 |
| 主題 / 語言 | 夜間、日間、跟隨系統;繁中、English |

## 測試

```bash
npm test              # 伺服器、hook、版面(node:test)
cd web && npm test    # 前端純函式(vitest)
```

## 不裝 hook 先看效果

```bash
CODECITY_EVENTS=/tmp/sim/events.jsonl node server/server.mjs --repo D:/path/to/repo --port 4478
node cli/simulate.mjs --repo D:/path/to/repo --file /tmp/sim/events.jsonl
```

模擬器強制要求 `--file`,不會寫到真正的事件紀錄。
