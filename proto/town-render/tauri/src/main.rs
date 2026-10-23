// Tauri shell around the web town renderer, for the desktop-window comparison (specs/08):
//   town-render-tauri --url=<page> [--size=WxH] [--on-top] [--frameless] [--transparent]
// Opacity is done by the page itself (?opacity=0.85) over a transparent window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let get = |k: &str| args.iter().find_map(|a| a.strip_prefix(&format!("--{k}=")).map(str::to_string));
    let has = |k: &str| args.iter().any(|a| a == &format!("--{k}"));
    let url = get("url").unwrap_or_else(|| "http://127.0.0.1:4478/".into());
    let (w, h) = get("size")
        .and_then(|s| s.split_once('x').map(|(a, b)| (a.parse().unwrap_or(1440.0), b.parse().unwrap_or(720.0))))
        .unwrap_or((1440.0, 720.0));
    let on_top = has("on-top");
    let frameless = has("frameless");
    let transparent = has("transparent");
    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("Agent Skyline town (Tauri)")
                .inner_size(w, h)
                .resizable(true)
                .always_on_top(on_top)
                .decorations(!frameless)
                .transparent(transparent)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri app");
}
