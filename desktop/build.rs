// The window commands, declared so the capability file can allow them for the city page, which is
// served by the local server (a remote origin as far as Tauri is concerned).
const COMMANDS: &[&str] = &["window_state", "set_pinned", "set_opacity", "set_click_through", "start_drag", "minimize", "toggle_maximize", "close"];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri build");
}
