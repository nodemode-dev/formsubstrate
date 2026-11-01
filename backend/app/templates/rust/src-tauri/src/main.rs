#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::Command;

use tauri::Manager;

fn cli_banner() -> Option<String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let name = if cfg!(windows) { "{{name}}-cli.exe" } else { "{{name}}-cli" };
    let cli = ["release", "debug"].iter().map(|dir| root.join("target").join(dir).join(name)).find(|p| p.is_file())?;
    let out = Command::new(cli).arg("version").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let (Some(title), Some(window)) = (cli_banner(), app.get_webview_window("main")) {
                let _ = window.set_title(&title);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the {{name}} window failed to start");
}
