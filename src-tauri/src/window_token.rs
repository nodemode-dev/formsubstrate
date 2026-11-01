pub const ENV: &str = "SUBFORM_WINDOW_TOKEN";

pub struct WindowToken(String);

impl WindowToken {
    pub fn mint() -> Option<Self> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).ok()?;
        Some(Self(bytes.iter().map(|b| format!("{b:02x}")).collect()))
    }

    pub fn value(&self) -> &str {
        &self.0
    }
}

#[tauri::command]
pub fn window_token<R: tauri::Runtime>(window: tauri::Window<R>, token: tauri::State<'_, WindowToken>) -> Result<String, String> {
    if window.label() != "main" {
        return Err("the window token is for the main window only".into());
    }
    Ok(token.value().to_string())
}
