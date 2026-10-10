// Injected into every page of the recording (page.addInitScript). Draws what a headless browser
// does not: a visible cursor with click ripples, bilingual captions, and full-screen title cards.
// Everything ignores pointer events, so the app underneath stays fully interactive.
(() => {
  const FONT = '"Microsoft JhengHei", "Segoe UI", system-ui, sans-serif';
  const css = `
    #demo-cursor { position: fixed; z-index: 100000; left: 0; top: 0; width: 28px; height: 28px;
      pointer-events: none; transform: translate(-3px, -2px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.5)); }
    .demo-ripple { position: fixed; z-index: 99999; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      border: 3px solid #4da3ff; pointer-events: none; animation: demo-ripple .6s ease-out forwards; }
    @keyframes demo-ripple { to { transform: scale(4); opacity: 0; } }
    #demo-caption { position: fixed; z-index: 99990; left: 50%; bottom: 92px; transform: translate(-50%, 12px);
      max-width: 1180px; padding: 16px 30px 14px; border-radius: 16px; background: rgba(6,10,22,.86);
      border: 1px solid rgba(120,160,255,.35); box-shadow: 0 10px 40px rgba(0,0,0,.45); text-align: center;
      opacity: 0; transition: opacity .45s ease, transform .45s ease; pointer-events: none; font-family: ${FONT}; }
    #demo-caption.on { opacity: 1; transform: translate(-50%, 0); }
    #demo-caption .zh { color: #fff; font-size: 34px; font-weight: 700; letter-spacing: .5px; line-height: 1.35; }
    #demo-caption .en { color: #9fb2d6; font-size: 20px; margin-top: 6px; line-height: 1.35; }
    #demo-card { position: fixed; inset: 0; z-index: 99995; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(1200px 700px at 50% 40%, #13224a 0%, #070b18 60%, #04060d 100%);
      opacity: 0; transition: opacity .6s ease; pointer-events: none; font-family: ${FONT}; color: #e6edf7; }
    #demo-card.on { opacity: 1; }
    #demo-card .inner { text-align: center; max-width: 1500px; padding: 0 60px; }
    #demo-card .inner > * { opacity: 0; transform: translateY(18px); animation: demo-rise .8s ease forwards; }
    #demo-card .inner > *:nth-child(2) { animation-delay: .25s } #demo-card .inner > *:nth-child(3) { animation-delay: .5s }
    #demo-card .inner > *:nth-child(4) { animation-delay: .75s } #demo-card .inner > *:nth-child(5) { animation-delay: 1s }
    #demo-card .inner > *:nth-child(6) { animation-delay: 1.25s }
    @keyframes demo-rise { to { opacity: 1; transform: none; } }
  `;
  const cursorSvg = `<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2 L4 20 L9 15.5 L12.5 22 L15.5 20.6 L12 14 L19 14 Z"
    fill="#fff" stroke="#0b1020" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

  function mount() {
    if (document.getElementById("demo-cursor")) return;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML = cursorSvg;
    cursor.style.transform = "translate(-100px, -100px)";
    document.body.appendChild(cursor);
    const cap = document.createElement("div");
    cap.id = "demo-caption";
    cap.innerHTML = '<div class="zh"></div><div class="en"></div>';
    document.body.appendChild(cap);
    const card = document.createElement("div");
    card.id = "demo-card";
    document.body.appendChild(card);
    // Capture phase, so the app's own handlers (which may stop propagation) cannot hide the cursor.
    window.addEventListener("pointermove", (e) => (cursor.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`), true);
    window.addEventListener(
      "pointerdown",
      (e) => {
        const r = document.createElement("div");
        r.className = "demo-ripple";
        r.style.left = e.clientX + "px";
        r.style.top = e.clientY + "px";
        document.body.appendChild(r);
        setTimeout(() => r.remove(), 700);
      },
      true
    );
  }

  window.__demo = {
    caption(zh, en) {
      mount();
      const c = document.getElementById("demo-caption");
      c.querySelector(".zh").textContent = zh;
      c.querySelector(".en").textContent = en ?? "";
      c.classList.add("on");
    },
    hideCaption() {
      document.getElementById("demo-caption")?.classList.remove("on");
    },
    card(html) {
      mount();
      const c = document.getElementById("demo-card");
      c.innerHTML = `<div class="inner">${html}</div>`;
      c.classList.add("on");
      document.getElementById("demo-cursor").style.visibility = "hidden"; // no cursor over a title card
    },
    hideCard() {
      document.getElementById("demo-card")?.classList.remove("on");
      const cur = document.getElementById("demo-cursor");
      if (cur) cur.style.visibility = "visible";
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
