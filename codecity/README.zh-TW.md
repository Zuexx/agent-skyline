# CodeCity

[English](README.md)

CodeCity 把 git repo 畫成 3D 城市:資料夾是街區、檔案是大樓、大樓高度是行數。主要用途是**監督 AI coding agent**:

- 即時看到 agent 讀寫了哪些檔案;
- 鎖定資料夾,寫入**在發生之前就被擋下**;
- 把分支和 `main` 比較,一眼看出改了什麼、有沒有補測試;
- 依風險順序 review 改動、看檔案的依賴道路、框選檔案直接變成給 agent 的任務範圍。

支援 **Claude Code**(hook)和 **pi**(擴充)。其他 agent 或人改的檔案,也會被檔案監看記錄,只是不知道是誰改的。

延伸閱讀:`NOTES.zh-TW.md`(構想,以及為什麼做成這樣)、`PROGRESS.zh-TW.md`(開發過程、每個決定和一次事故)、`specs/`(每一步的規格)。

## 快速開始

需要 Node 22 以上和 git。

```bash
cd codecity/web && npm install && npm run build       # 建置畫面(只要做一次)
cd .. && node server/server.mjs --repo D:/path/to/repo  # 啟動伺服器
```

打開 http://127.0.0.1:4477 。伺服器只綁 127.0.0.1。

選項:`--port <n>`、`--no-watch`(關閉檔案監看)。

## 接上 agent

### Claude Code

```bash
node cli/install-hooks.mjs D:/path/to/repo            # 印出要貼的設定
node cli/install-hooks.mjs D:/path/to/repo --write    # 直接寫入 <repo>/.claude/settings.local.json
```

請確認目標 repo 的 `.gitignore` 有排除 `.claude/settings.local.json`。之後**新開**的 Claude Code 工作階段才會載入 hook。要停止,刪掉那個檔案即可。

- `hooks/log-event.mjs`(PostToolUse):每次工具呼叫記一行事件到 `data/events.jsonl`。
- `hooks/guard.mjs`(PreToolUse):擋下寫進禁區的動作,不論是透過 Edit/Write **還是** shell 指令。

**開工作階段時自動帶起城市(選用,預設關閉):**

```bash
node cli/install-hooks.mjs D:/path/to/repo --write --autostart          # 啟動伺服器
node cli/install-hooks.mjs D:/path/to/repo --write --autostart --open   # …並打開瀏覽器
```

這會加一個 SessionStart hook(`hooks/session-start.mjs`)。已經有伺服器在服務這個 repo 就沿用;沒有的話,從 4477 開始找第一個空的埠號在背景啟動(用 `--port` 改起始埠號)。`--open` 只在這次真的啟動了伺服器時才打開瀏覽器。hook 不輸出任何東西,也不會讓工作階段失敗。它啟動的伺服器在工作階段結束後會繼續跑;用 `node cli/stop-server.mjs [<埠號> | --all]` 依 PID 列出或關閉。

### pi

```bash
pi --extension D:/path/to/codecity/adapters/pi/codecity.js     # 只在這次執行載入
```

或在 `~/.pi/agent/extensions/` 底下放一個檔案 import `adapters/pi/codecity.js`,每次都載入。它會記錄 pi 的工具呼叫,並擋下寫進禁區的動作(write、edit、bash),規則和 Claude Code 的 hook 完全相同。事件會顯示成「pi 1」「pi 2」……

### 其他

伺服器會監看整個 repo。沒有 agent 回報的改動會顯示成**檔案監看**:看得到,但不知道是誰改的,也擋不了。git 忽略的路徑(`bin/`、`node_modules/`…)不記錄,agent 已經回報過的同一筆寫入也不重複記錄,內容沒變的通知(Windows 上單純讀檔也會觸發)會被忽略。

## 禁區與 shell 指令

禁區擋的是寫入,讀取不受影響。實測時觀察到 agent 被擋下 Edit 之後,改用 `echo … > file` 寫進去,所以 shell 指令也會檢查:重新導向、`tee`、`sed -i`、`cp`、`mv`、`rm`、`touch`、`git checkout --`,以及對應的 PowerShell 指令。在直譯器裡寫檔(`python -c …`、`node -e …`)或透過腳本寫檔,事前看不出來,由檔案監看事後記錄。

## 畫面上能做的事

| 功能 | 怎麼用 |
|---|---|
| 分組方式 | 資料夾 / 角色(程式碼、測試、規格…)/ 本次動過 / 差異。切換時大樓會飛到新位置 |
| 時間範圍 | 連線狀態旁邊:預設是**最近一段工作**(超過 2 小時沒有事件就算新的一段),也可以選今天、某段過去的工作或全部。事件紀錄本身全部保留;城市、時間線、「本次動過」、review 清單和範圍推論都跟著選的範圍走 |
| 即時動態 | 左下角;可篩選、往回捲;點檔案讓鏡頭飛過去,點指令展開完整內容 |
| 比較分支 | 選一個分支和 main 比較,依 git diff 上色;點大樓看 diff |
| 檔案資訊 | 點大樓:行數、活動、**未 commit 的 diff**(比較分支時是分支的 diff)、**在 VS Code 開啟** |
| 依賴道路 | 點大樓同時畫出弧線:紫 = 它用到的、粉紅 = 用到它的、綠 = 它的測試(JS/TS 的 import、C# 的型別使用;面板也會列出) |
| Review 清單 | 清單 icon:比較中的分支改動,或所有未 commit 的改動加上這次工作階段寫過的檔案,依風險排序並附理由(警示、沒有測試、近期常改、很多檔案依賴、改動很大),看完打勾 |
| 框選派工 | 選取 icon → 拖曳框選大樓(或逐棟點選)。複製「任務 + 檔案範圍」,或直接存成任務範圍 |
| 任務範圍 | 旗子 icon → 點街區;範圍外的寫入會警示。沒宣告時自動推論 |
| 禁區 | 鎖頭 icon → 點街區鎖定或解鎖 |
| 通知 | 被擋下或超出範圍時跳出提示卡;鈴鐺開啟桌面通知 |
| 重播 | 畫面下方:以 1× 到 120× 重播這次工作 |
| 鏡頭 | 左鍵拖曳平移、右鍵拖曳旋轉、滾輪縮放;地圖 icon 回到全景;準星 icon 跟隨最新動作;雙擊大樓飛過去 |
| 主題 / 語言 | 夜間、日間、跟隨系統;繁中、English |

## 測試

```bash
npm test              # 伺服器、hook、轉接器、版面(node:test)
cd web && npm test    # 前端邏輯(vitest)
```

## 不接 agent 先看效果

```bash
CODECITY_EVENTS=/tmp/sim/events.jsonl node server/server.mjs --repo D:/path/to/repo --port 4478
node cli/simulate.mjs --repo D:/path/to/repo --file /tmp/sim/events.jsonl
```

模擬器強制要求 `--file`,不會寫到真正的事件紀錄。
