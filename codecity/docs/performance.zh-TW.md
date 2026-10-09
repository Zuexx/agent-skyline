# 效能

[English](performance.md)

2026-10-09 量測:Windows 11、RTX 4090、Chrome(無頭模式,GPU 經 ANGLE/D3D11)、畫面 1600×900、夜間主題。測試用的 repo 是合成的(`bench/make-repo.mjs`):檔案分散在最多四層資料夾,每個檔案 1 到 400 行。

## 伺服器

| 檔案數 | 資料夾(街區) | 掃描 | 版面 | `/api/city` JSON |
|---:|---:|---:|---:|---:|
| 518(forgekit) | 234 | 1.8 秒* | 2 ms | 80 KB |
| 5,000 | 1,841 | 258 ms | 10 ms | 545 KB |
| 20,000 | 1,841 | 963 ms | 19 ms | 1.85 MB |

\* forgekit 那次是開機後第一次掃描(磁碟快取是冷的),合成 repo 是熱的。掃描只在啟動和重新掃描時執行;版面計算很便宜,每次切換分組都可以在瀏覽器重算。

## 瀏覽器,20,000 個檔案

同一個 Chrome、同一個腳本(`bench/perf.mjs`),連線時重送 3,000 筆歷史事件,量測期間每秒 10 筆即時事件。

| | 優化前 | 優化後 |
|---|---:|---:|
| 主執行緒忙碌比例 | 44% | 9% |
| 首次載入 | 2,054 ms | 133 ms |
| JS 記憶體 | 79 MB | 36 MB |
| 每秒影格 | 56 | 61(螢幕上限) |
| 8 倍速重播 | — | 61 fps,忙碌 14% |

在 Orca 內建的瀏覽器(資源較少)裡,優化前的版本掉到每秒約 2 格,分頁直接卡死。

### 改了什麼

1. **動態列表每次更新都把整段歷史畫出來**(最多 1,000 列),每秒 10 次。現在只畫 120 列,捲動時再增加;每一列都做 memo,並使用穩定的 callback,沒變的列不重畫。
2. **每個資料夾都是獨立的 mesh 和 React 元素**:每次更新要比對 1,841 個元素、發出 1,841 次繪製呼叫。現在所有資料夾合成一個 `InstancedMesh`,點擊時用實例編號找出是哪個資料夾。
3. **大樓上色每秒 4 次檢查全部 20,000 棟**。現在只檢查候選:有活動的檔案、比較中 diff 裡的檔案,以及目前不是預設顏色的大樓。

## 重現

```bash
cd codecity/bench && npm install
node make-repo.mjs /tmp/repo20000 20000
CODECITY_EVENTS=/tmp/perf/events.jsonl node ../server/server.mjs --repo /tmp/repo20000 --port 4479 --no-watch
node ../cli/simulate.mjs --repo /tmp/repo20000 --file /tmp/perf/events.jsonl --agents 4 --interval 100 --count 3000
node perf.mjs http://127.0.0.1:4479/ 8            # 或:... 8 replay
```

`perf.mjs` 驅動系統已安裝的 Chrome(`channel: "chrome"`),不會另外下載瀏覽器。
