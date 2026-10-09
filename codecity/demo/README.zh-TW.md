# 演示影片

[English](README.md)

`codecity-demo.mp4`(3 分 10 秒、1080p、30 fps、繁中與英文字幕、無配音)是錄**真正在運作的 App**,不是模擬畫面:腳本在 Chrome 裡操作 CodeCity,像 hook 一樣把劇本事件寫進事件紀錄,同時錄下畫面。影片檔不進版控;`poster.jpg` 是影片中的一格。

## 怎麼做的

- `record.mjs`:導演。用 `?demo` 打開 App(會提供大樓在螢幕上的位置)、移動看得見的游標、點真正的按鈕、注入事件、錄影。
- `overlay.js`:疊在頁面上的東西:游標和點擊波紋、雙語字幕、標題卡。
- `cards.mjs`:標題、問題、架構、結尾四張卡(HTML)。

畫面來自 Chrome 的 screencast(CDP,1080p 約 60 fps);一個計時器以固定 30 fps 把最新的一格寫給 ffmpeg,所以影片長度和實際時間一致。

為什麼不用 Remotion:Remotion 是用 React 元件逐格渲染,適合做動畫合成,但拍不了「即時串流事件、用 WebGL 播動畫」的真實 App。直接錄真的 App,演示才不會作假;標題卡和字幕用 HTML/CSS 做,概念跟 Remotion 一樣,但不需要另一套工具鏈。

## 重新錄製

需要 Chrome 和 ffmpeg。用全新的空事件檔啟動兩個伺服器,再執行導演腳本:

```bash
npm install
mkdir -p /tmp/v/main /tmp/v/big && : > /tmp/v/main/events.jsonl && : > /tmp/v/big/events.jsonl
CODECITY_EVENTS=/tmp/v/main/events.jsonl CODECITY_ZONES=/tmp/v/main/zones.json \
  node ../server/server.mjs --repo D:/Labs/forgekit --port 4490 --no-watch &
node ../bench/make-repo.mjs /tmp/repo20000 20000
CODECITY_EVENTS=/tmp/v/big/events.jsonl CODECITY_ZONES=/tmp/v/big/zones.json \
  node ../server/server.mjs --repo /tmp/repo20000 --port 4491 --no-watch &
node record.mjs --out codecity-demo.mp4 --events /tmp/v/main/events.jsonl --big-events /tmp/v/big/events.jsonl
```

劇本用的是 forgekit `main` 分支和 `fix/api-error-and-jwks-hardening` 分支上的檔案;換成別的 repo 時,要改 `record.mjs` 裡的路徑。
