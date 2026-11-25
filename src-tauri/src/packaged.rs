const ENGINE: &str = if cfg!(windows) { "formsubstrate-engine.exe" } else { "formsubstrate-engine" };

pub fn engine_folder() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    [dir.join("../Resources/engine"), dir.join("engine"), dir.join("../lib/Substrate/engine"), dir.join("../lib/formsubstrate/engine"), dir.join("../lib/substrate/engine")]
        .into_iter()
        .map(|folder| folder.join(ENGINE))
        .find(|program| program.is_file())
}
