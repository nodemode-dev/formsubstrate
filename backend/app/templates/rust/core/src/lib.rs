pub const NAME: &str = "{{name}}";
pub const PORT_BASE: u16 = {{port_base}};
pub const PORT_FRONTEND: u16 = {{port_frontend}};
pub const PORT_PREVIEW: u16 = {{port_preview}};
pub const PORT_ENGINE: u16 = {{port_engine}};

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn banner() -> String {
    format!("{} v{}", NAME, version())
}
