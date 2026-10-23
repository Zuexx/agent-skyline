# Agent Skyline 完整說明

[English](guide.md) · [回到首頁](../README.zh-TW.md)

Agent Skyline 把 git repo 畫成 3D 城市:資料夾是街區、檔案是大樓、大樓高度是行數。主要用途是**監督 AI coding agent**:

- 即時看到 agent 讀寫了哪些檔案;
- 鎖定資料夾,寫入**在發生之前就被擋下**;
- 把分支和 `main` 比較,一眼看出改了什麼、有沒有補測試;
- 依風險順序 review 改動、看檔案的依賴道路、框選檔案直接變成給 agent 的任務範圍。

支援 **Claude Code**(hook)和 **pi**(擴充)。其他 agent 或人改的檔案,也會被檔案監看記錄,只是不知道是誰改的。

延伸閱讀:[`NOTES.zh-TW.md`](NOTES.zh-TW.md)(構想,以及為什麼做成這樣)、[`PROGRESS.zh-TW.md`](PROGRESS.zh-TW.md)(開發過程、每個決定和一次事故)、[`specs/`](../specs/)(每一步的規格)。

## 快速開始

需要 Node 22 以上和 git。在 Agent Skyline 資料夾執行一次 `npm link`,之後在任何 git repo 裡:

```bash
skyline                 # 把這個 repo 接上 Claude Code,並打開城市
skyline off             # 取消上面的設定,並關掉城市
skyline status          # 列出正在跑的城市
```

`skyline` 第一次執行時會建置畫面,把下面的 Claude Code hook(含自動啟動)加進 `<repo>/.claude/settings.local.json`,確保 git 會忽略這個檔案,為這個 repo 啟動伺服器(已經在跑就沿用),然後打開瀏覽器。選項:`[<資料夾>]`(指定目前資料夾以外的 repo)、`--port <n>`、`--no-open`。伺服器只綁 127.0.0.1。

想自己一步步來:

```bash
cd web && npm install && npm run build                  # 建置畫面(只要做一次)
cd .. && node server/server.mjs --repo D:/path/to/repo  # 啟動伺服器
```

然後打開 http://127.0.0.1:4477 。伺服器選項:`--port <n>`、`--no-watch`(關閉檔案監看)。

### 可以監看哪些資料夾

任何 **git repo** 都可以,不一定是程式碼:筆記、文件、寫作專案、資料檔都行。每個檔案是一棟大樓,高度是行數(二進位檔是平的)。被 `.gitignore` 排除的檔案不顯示;新建的檔案不用 `git add` 就會出現。不是 repo 的資料夾也行:檔案直接從磁碟讀,略過隱藏資料夾、`node_modules`、`__pycache__`、`venv`/`env`、`site-packages` 和 `python_embeded`,最多 20,000 個檔案。沒有 git 就沒有分支比較、未 commit 的 diff 和歷史;`git init` 一次(不需要 commit)就會有。依賴道路支援 JS/TS、Python、Go、Java/Kotlin/Scala、C#、C/C++/Objective-C、Rust、PHP、Ruby 和 Swift(見[依賴道路](#依賴道路))。

## 接上 agent

### Claude Code

`skyline` 會幫你做好。手動的話:

```bash
node cli/install-hooks.mjs D:/path/to/repo            # 印出要貼的設定
node cli/install-hooks.mjs D:/path/to/repo --write    # 加進 <repo>/.claude/settings.local.json
```

`--write` 會保留檔案裡原本的其他設定,只替換 Agent Skyline 自己的 hook。請確認目標 repo 的 `.gitignore` 有排除 `.claude/settings.local.json`。之後**新開**的 Claude Code 工作階段才會載入 hook。要停止,執行 `skyline off`(或從檔案裡刪掉這些 hook)。

- `hooks/log-event.mjs`(PostToolUse):每次工具呼叫記一行事件到這個 repo 自己的事件紀錄。
- 每個 repo 有自己的資料夾 `data/repos/<名稱>-<雜湊>/`,裡面是 `events.jsonl`、`zones.json`(禁區)和 `scope.json`(允許範圍),所以在一個 repo 鎖 `api/**` 不會鎖到別的 repo。在子資料夾開的工作階段用的是它所屬 repo 的資料夾。第一次使用時,會從舊的共用檔案複製一份過來:`data/zones.json`、`data/scope.json`,以及舊 `data/events.jsonl` 裡屬於這個 repo 的事件;舊檔案本身不會被改動。
- `hooks/guard.mjs`(PreToolUse):擋下寫進禁區的動作,不論是透過 Edit/Write **還是** shell 指令。

**開工作階段時自動帶起城市(選用,預設關閉):**

```bash
node cli/install-hooks.mjs D:/path/to/repo --write --autostart          # 啟動伺服器
node cli/install-hooks.mjs D:/path/to/repo --write --autostart --open   # …並打開瀏覽器
```

這會加一個 SessionStart hook(`hooks/session-start.mjs`)。已經有伺服器在服務這個 repo 就沿用;沒有的話,從 4477 開始找第一個空的埠號在背景啟動(用 `--port` 改起始埠號)。`--open` 只在這次真的啟動了伺服器時才打開瀏覽器。hook 不輸出任何東西,也不會讓工作階段失敗。它啟動的伺服器在工作階段結束後會繼續跑;用 `node cli/stop-server.mjs [<埠號> | --all]` 依 PID 列出或關閉。

### pi

```bash
pi --extension D:/path/to/agent-skyline/adapters/pi/agent-skyline.js     # 只在這次執行載入
```

或在 `~/.pi/agent/extensions/` 底下放一個檔案 import `adapters/pi/agent-skyline.js`,每次都載入。它會記錄 pi 的工具呼叫,並擋下寫進禁區的動作(write、edit、bash),規則和 Claude Code 的 hook 完全相同。事件會顯示成「pi 1」「pi 2」……

### 其他

伺服器會監看整個 repo。沒有 agent 回報的改動會顯示成**檔案監看**:看得到,但不知道是誰改的,也擋不了。git 忽略的路徑(`bin/`、`node_modules/`…)不記錄,agent 已經回報過的同一筆寫入也不重複記錄,內容沒變的通知(Windows 上單純讀檔也會觸發)會被忽略。

## 禁區與 shell 指令

禁區擋的是寫入,讀取不受影響。實測時觀察到 agent 被擋下 Edit 之後,改用 `echo … > file` 寫進去,所以 shell 指令也會檢查:重新導向、`tee`、`sed -i`、`cp`、`mv`、`rm`、`touch`、`git checkout --`,以及對應的 PowerShell 指令。在直譯器裡寫檔(`python -c …`、`node -e …`)或透過腳本寫檔,事前看不出來,由檔案監看事後記錄。

## 依賴道路

道路來自每種語言的簡單規則,不是編譯器:不用另外安裝任何東西,而且比較分支時直接從 git 讀出來的內容也能用同一套規則。它回答的是「誰用到這個檔案」,偶爾會多出編譯器不會認的道路(註解裡出現的名稱、兩個同名的型別)。

| 語言 | 什麼情況會畫出道路 |
|---|---|
| JS/TS | 相對路徑的 import 和 tsconfig 的 `paths` 別名;import 了卻沒用到的會標出來 |
| Python | `import a.b`、`from a.b import c`、相對的 `from .x import y`,不管原始碼放在哪一層(`src/` 結構也可以) |
| Go | import repo 自己的 package(依 `go.mod` 的 module)時,連到宣告了用到的名稱的檔案;同一個 package 的檔案依共用的名稱相連,所以 `x_test.go` 會連到 `x.go` |
| Java、Kotlin、Scala | 用到同 package、單一或萬用字元 import、static import 的型別;三種語言彼此看得到 |
| C# | 用到看得見的命名空間裡的型別:自己和上層命名空間、`using`、`global using` |
| C、C++、Objective-C | `#include "…"` 同資料夾的檔案,或路徑結尾相符的 repo 檔案 |
| Rust | `mod x;`,以及 `crate::`、`self::`、`super::`、workspace 裡其他 crate 的路徑,連到最深的那個模組檔案 |
| PHP | 用到同命名空間、`use`(含改名和群組)、完整名稱的類別,以及 `require`/`include` |
| Ruby | `require_relative`、依路徑的 `require`,以及用到的 class/module(Rails 自動載入) |
| Swift | 用到的型別,範圍是 repo 裡所有 Swift 檔案 |

對變數呼叫的方法(`user.save()`)不追:`save` 宣告在哪個檔案,取決於變數的型別,而型別本身通常已經連到同一個檔案。

要支援新語言,就在 `server/deps/` 多寫一個模組(格式和共用工具在 `server/deps/common.mjs`),再加進 `server/deps.mjs` 的 `LANGUAGES`。測試檔是依檔名認的,在 `web/src/lib/views.js` 的 `roleOf`,道路變綠色就是靠它。

## 畫面上能做的事

| 功能 | 怎麼用 |
|---|---|
| 分組方式 | 資料夾 / 角色(程式碼、測試、規格…)/ 本次動過 / 差異。切換時大樓會飛到新位置 |
| 時間範圍 | 連線狀態旁邊:預設是**最近一段工作**(超過 2 小時沒有事件就算新的一段),也可以選今天、某段過去的工作或全部。事件紀錄本身全部保留;城市、時間線、「本次動過」、review 清單和範圍推論都跟著選的範圍走 |
| 即時動態 | 左下角;可篩選、往回捲;點檔案讓鏡頭飛過去,點指令展開完整內容 |
| 比較分支 | 選一個分支和 main 比較,依 git diff 上色;點大樓看 diff |
| 檔案資訊 | 點大樓:行數、活動、**未 commit 的 diff**(比較分支時是分支的 diff)、**在 VS Code 開啟** |
| 依賴道路 | 點大樓同時畫出弧線:紫 = 它用到的、粉紅 = 用到它的、綠 = 它的測試(規則見[依賴道路](#依賴道路);面板也會列出)。JS/TS 裡 import 了卻沒用到任何名稱的,畫成灰色虛線,面板標「沒用到」,review 清單也會列為理由 |
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
AGENT_SKYLINE_EVENTS=/tmp/sim/events.jsonl node server/server.mjs --repo D:/path/to/repo --port 4478
node cli/simulate.mjs --repo D:/path/to/repo --file /tmp/sim/events.jsonl
```

模擬器強制要求 `--file`,不會寫到真正的事件紀錄。
