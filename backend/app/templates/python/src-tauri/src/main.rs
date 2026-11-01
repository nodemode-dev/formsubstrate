#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent};

const PORT: u16 = {{port_engine}};

struct Engine(Mutex<Option<Child>>);

fn spawn_engine() -> Result<Child, String> {
    let backend = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("backend");
    let python = if cfg!(windows) { backend.join("venv/Scripts/python.exe") } else { backend.join("venv/bin/python") };
    if !python.is_file() {
        return Err(format!("{{name}} needs its Python environment at {}; run the app's setup script first", python.display()));
    }
    Command::new(python)
        .args(["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", &PORT.to_string()])
        .current_dir(backend)
        .stdin(Stdio::null())
        .spawn()
        .map_err(|err| format!("{{name}} could not start its engine: {err}"))
}

fn engine_up() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            *app.state::<Engine>().0.lock().unwrap() = Some(spawn_engine()?);
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for _ in 0..150 {
                    if engine_up() {
                        if let (Some(window), Ok(url)) =
                            (handle.get_webview_window("main"), format!("http://127.0.0.1:{PORT}").parse())
                        {
                            let _ = window.navigate(url);
                        }
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the {{name}} window failed to start");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Engine>().0.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
