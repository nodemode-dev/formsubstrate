use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Manager};

pub const EVENT: &str = "formsubstrate://close-requested";

#[derive(Default)]
pub struct CloseGuard {
    armed: AtomicBool,
    asked: AtomicBool,
}

impl CloseGuard {
    pub fn should_ask(&self) -> bool {
        self.armed.load(Ordering::SeqCst) && !self.asked.swap(true, Ordering::SeqCst)
    }
}

pub fn ask(handle: &tauri::AppHandle) {
    let _ = handle.emit_to("main", EVENT, ());
}

pub fn on_close(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    if window.label() != "main" {
        return;
    }
    if window.state::<CloseGuard>().should_ask() {
        api.prevent_close();
        ask(window.app_handle());
    }
}

#[tauri::command]
pub fn close_guard<R: tauri::Runtime>(window: tauri::Window<R>, guard: tauri::State<'_, CloseGuard>, armed: bool) -> Result<(), String> {
    if window.label() != "main" {
        return Err("the close guard is for the main window only".into());
    }
    guard.armed.store(armed, Ordering::SeqCst);
    guard.asked.store(false, Ordering::SeqCst);
    Ok(())
}
