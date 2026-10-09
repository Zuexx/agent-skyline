// Title cards for the demo video, as HTML fragments shown by overlay.js.
const big = (s) => `<div style="font-size:120px;font-weight:800;letter-spacing:2px;background:linear-gradient(90deg,#7cc4ff,#b388ff);-webkit-background-clip:text;color:transparent">${s}</div>`;
const zh = (s, size = 46) => `<div style="font-size:${size}px;font-weight:700;margin-top:18px">${s}</div>`;
const en = (s, size = 26) => `<div style="font-size:${size}px;color:#9fb2d6;margin-top:10px">${s}</div>`;
const chip = (s, c) =>
  `<span style="display:inline-block;margin:0 8px;padding:8px 18px;border-radius:999px;border:1px solid ${c};color:${c};font-size:24px;font-weight:600">${s}</span>`;

export const title = [
  big("CodeCity"),
  zh("把 AI coding agent 的每一步,看在眼裡", 52),
  en("Watch every move your AI coding agent makes — and stop the ones it should not", 28),
  `<div style="margin-top:40px">${chip("Claude Code", "#4da3ff")}${chip("pi", "#2ee6c5")}${chip("任何 agent / any agent", "#ffb347")}</div>`,
].join("");

export const problem = [
  zh("AI agent 一次改幾十個檔案", 54),
  en("An agent changes dozens of files in one go", 28),
  `<div style="margin-top:48px;display:flex;gap:28px;justify-content:center">${[
    ["它改了哪裡?", "Where did it change things?"],
    ["有沒有越界?", "Did it step outside the task?"],
    ["有沒有補測試?", "Did tests come with the change?"],
  ]
    .map(
      ([a, b]) =>
        `<div style="width:380px;padding:26px 20px;border-radius:18px;background:rgba(77,163,255,.08);border:1px solid rgba(77,163,255,.35)"><div style="font-size:36px;font-weight:700">${a}</div><div style="font-size:21px;color:#9fb2d6;margin-top:8px">${b}</div></div>`
    )
    .join("")}</div>`,
  en("終端機只給你一長串捲動的輸出。 · The terminal only gives you a scrolling wall of text.", 24),
].join("");

const box = (t, s, c) =>
  `<div style="padding:18px 22px;border-radius:14px;border:2px solid ${c};background:${c}14;min-width:230px"><div style="font-size:28px;font-weight:700;color:${c}">${t}</div><div style="font-size:19px;color:#9fb2d6;margin-top:4px">${s}</div></div>`;
const arrow = `<div style="font-size:44px;color:#5b6780;padding:0 14px">→</div>`;

export const architecture = [
  zh("怎麼運作", 52),
  en("How it works", 28),
  `<div style="margin-top:44px;display:flex;align-items:center;justify-content:center">
     <div style="display:flex;flex-direction:column;gap:14px">
       ${box("Claude Code hooks", "記錄 · 寫入前檢查 / log · check before write", "#4da3ff")}
       ${box("pi extension", "同一套規則 / same rules", "#2ee6c5")}
       ${box("File watcher", "其他 agent 或人 / anyone else", "#8a97b0")}
     </div>
     ${arrow}
     ${box("events.jsonl", "一行一個事件 / one line per event", "#ffb347")}
     ${arrow}
     ${box("CodeCity server", "SSE · git diff · zones", "#b388ff")}
     ${arrow}
     ${box("3D city", "React Three Fiber", "#3ddc84")}
   </div>`,
  en("禁區在寫入發生「之前」就擋下:Edit、Write,連 bash 的 echo > file 也擋。 · Locked zones block writes before they happen — including shell writes.", 22),
].join("");

export const outro = [
  big("CodeCity"),
  zh("看得見,才管得住", 50),
  en("You can only steer what you can see", 28),
  `<div style="margin-top:36px;font-size:22px;color:#9fb2d6;line-height:1.8">
     即時監看 · 禁區 · 範圍檢查 · 分支比較 · 重播 · 20,000 個檔案 60 fps<br/>
     Live view · locked zones · scope check · branch diff · replay · 20k files at 60 fps
   </div>`,
  `<div style="margin-top:30px;font-size:20px;color:#5b6780">codecity/ · README.md · README.zh-TW.md</div>`,
].join("");
