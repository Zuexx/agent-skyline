// Agent Skyline in its own window (specs/08). Started by `skyline --window`:
//   agent-skyline-window --url=<city page> --state=<window.json> [--title=<repo name>]
//
// A frameless, transparent window that loads the repo's running city. The page draws its own slim
// title bar (pin, opacity, click-through, close) and talks to this shell only through
// `window.agentSkyline`, injected below. Opacity is done by the page itself over the transparent
// window, since WebView2 windows have no whole-window opacity.
//
// Position, size, pin and opacity are saved to the state file. Click-through always starts off, and
// Ctrl+Alt+Shift+C turns it off again from anywhere (the window cannot be clicked while it is on).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
struct Saved {
    x: Option<i32>,
    y: Option<i32>,
    width: Option<u32>,
    height: Option<u32>,
    pinned: bool,
    opacity: f64,
}

impl Default for Saved {
    fn default() -> Self {
        Saved { x: None, y: None, width: None, height: None, pinned: false, opacity: 1.0 }
    }
}

struct Shell {
    file: PathBuf,
    saved: Saved,
    click_through: bool,
}

impl Shell {
    fn save(&self) {
        if let Some(dir) = self.file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(&self.saved) {
            let _ = std::fs::write(&self.file, text + "\n");
        }
    }
    // What the page sees.
    fn page_state(&self) -> serde_json::Value {
        serde_json::json!({ "pinned": self.saved.pinned, "opacity": self.saved.opacity, "clickThrough": self.click_through })
    }
}

type ShellState = Mutex<Shell>;

const MIN_OPACITY: f64 = 0.3;

// Tell the page about a change made outside it (the global shortcut).
fn push(window: &WebviewWindow, shell: &Shell) {
    let _ = window.eval(&format!("window.agentSkyline && window.agentSkyline._update({})", shell.page_state()));
}

fn set_click_through_on(window: &WebviewWindow, shell: &mut Shell, on: bool) {
    // Only while pinned: an unpinned window that ignores clicks could hide under others and be lost.
    let on = on && shell.saved.pinned;
    if window.set_ignore_cursor_events(on).is_ok() {
        shell.click_through = on;
    }
}

#[tauri::command]
fn window_state(state: tauri::State<ShellState>) -> serde_json::Value {
    state.lock().unwrap().page_state()
}

#[tauri::command]
fn set_pinned(window: WebviewWindow, state: tauri::State<ShellState>, on: bool) -> serde_json::Value {
    let mut shell = state.lock().unwrap();
    if window.set_always_on_top(on).is_ok() {
        shell.saved.pinned = on;
        if !on {
            set_click_through_on(&window, &mut shell, false);
        }
        shell.save();
    }
    shell.page_state()
}

#[tauri::command]
fn set_opacity(state: tauri::State<ShellState>, value: f64) -> serde_json::Value {
    let mut shell = state.lock().unwrap();
    shell.saved.opacity = value.clamp(MIN_OPACITY, 1.0);
    shell.save();
    shell.page_state()
}

#[tauri::command]
fn set_click_through(window: WebviewWindow, state: tauri::State<ShellState>, on: bool) -> serde_json::Value {
    let mut shell = state.lock().unwrap();
    set_click_through_on(&window, &mut shell, on);
    shell.page_state()
}

#[tauri::command]
fn start_drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn toggle_maximize(window: WebviewWindow) {
    let _ = if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() };
}

#[tauri::command]
fn close(window: WebviewWindow) {
    let _ = window.close();
}

// Runs in the page before its own scripts: the only API the page uses to talk to the window.
fn bridge_script(initial: &serde_json::Value) -> String {
    format!(
        r#"(() => {{
  const call = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args || {{}});
  const listeners = new Set();
  const api = {{
    state: {initial},
    shortcut: "Ctrl+Alt+Shift+C",
    _update(s) {{ api.state = s; listeners.forEach((f) => f(s)); }},
    onChange(f) {{ listeners.add(f); return () => listeners.delete(f); }},
    setPinned: (on) => call("set_pinned", {{ on }}).then(api._update),
    setOpacity: (value) => call("set_opacity", {{ value }}).then(api._update),
    setClickThrough: (on) => call("set_click_through", {{ on }}).then(api._update),
    drag: () => call("start_drag"),
    minimize: () => call("minimize"),
    toggleMaximize: () => call("toggle_maximize"),
    close: () => call("close"),
  }};
  window.agentSkyline = api;
}})();"#
    )
}

// The saved position, if some monitor still shows the window's top-left area.
fn on_screen(window: &WebviewWindow, x: i32, y: i32) -> bool {
    window.available_monitors().unwrap_or_default().iter().any(|m| {
        let (p, s) = (m.position(), m.size());
        x + 40 >= p.x && y >= p.y && x + 40 < p.x + s.width as i32 && y + 20 < p.y + s.height as i32
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let get = |k: &str| args.iter().find_map(|a| a.strip_prefix(&format!("--{k}=")).map(str::to_string));
    let url = get("url").unwrap_or_else(|| "http://127.0.0.1:4477/".into());
    let file = PathBuf::from(get("state").unwrap_or_else(|| "window.json".into()));
    let title = get("title").map(|t| format!("{t} · Agent Skyline")).unwrap_or_else(|| "Agent Skyline".into());

    let mut saved: Saved = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    saved.opacity = saved.opacity.clamp(MIN_OPACITY, 1.0);
    let shell = Shell { file, saved: saved.clone(), click_through: false };
    let initial = shell.page_state();

    let off_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT), Code::KeyC);

    tauri::Builder::default()
        .manage(Mutex::new(shell))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed || shortcut != &off_shortcut {
                        return;
                    }
                    let Some(window) = app.get_webview_window("main") else { return };
                    let state = app.state::<ShellState>();
                    let mut shell = state.lock().unwrap();
                    // Off if on; on (when pinned) if off.
                    let next = !shell.click_through;
                    set_click_through_on(&window, &mut shell, next);
                    push(&window, &shell);
                    if !shell.click_through {
                        let _ = window.set_focus();
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            window_state,
            set_pinned,
            set_opacity,
            set_click_through,
            start_drag,
            minimize,
            toggle_maximize,
            close
        ])
        .setup(move |app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title(&title)
                .inner_size(1280.0, 760.0)
                .min_inner_size(360.0, 240.0)
                .resizable(true)
                .decorations(false)
                .transparent(true)
                .always_on_top(saved.pinned)
                .visible(false)
                .initialization_script(&bridge_script(&initial))
                .build()?;
            if let (Some(w), Some(h)) = (saved.width, saved.height) {
                let _ = window.set_size(PhysicalSize::new(w.max(360), h.max(240)));
            }
            match (saved.x, saved.y) {
                (Some(x), Some(y)) if on_screen(&window, x, y) => {
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                }
                _ => {
                    let _ = window.center();
                }
            }
            window.show()?;
            if let Err(err) = app.global_shortcut().register(off_shortcut) {
                eprintln!("could not register {off_shortcut:?}: {err}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let state = window.state::<ShellState>();
            let mut shell = state.lock().unwrap();
            if let WindowEvent::CloseRequested { .. } = event {
                // A minimized window reports a far-off position (-32000 on Windows) and a maximized one
                // the screen; keep the last normal geometry then.
                if !window.is_minimized().unwrap_or(false) && !window.is_maximized().unwrap_or(false) {
                    if let (Ok(p), Ok(s)) = (window.outer_position(), window.inner_size()) {
                        shell.saved.x = Some(p.x);
                        shell.saved.y = Some(p.y);
                        shell.saved.width = Some(s.width);
                        shell.saved.height = Some(s.height);
                    }
                }
                shell.save();
            }
        })
        .run(tauri::generate_context!())
        .expect("agent skyline window");
}
