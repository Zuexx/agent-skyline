import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import WindowBar, { BAR_HEIGHT, inWindow } from "./ui/WindowBar.jsx";

const root = document.getElementById("root");

// Inside the desktop window (specs/08) the page draws its own title bar above the city. The
// transform makes #root the box that the app's position:fixed layers fill, so they sit under the bar.
if (inWindow) {
  document.documentElement.style.background = document.body.style.background = "transparent";
  Object.assign(root.style, { position: "fixed", top: `${BAR_HEIGHT}px`, left: 0, right: 0, bottom: 0, transform: "translateZ(0)" });
  const bar = document.createElement("div");
  document.body.appendChild(bar);
  createRoot(bar).render(<WindowBar />);
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
