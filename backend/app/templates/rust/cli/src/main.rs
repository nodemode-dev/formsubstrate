use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None | Some("version") | Some("--version") | Some("-V") => {
            println!("{}", {{name}}_core::banner());
            ExitCode::SUCCESS
        }
        Some("ports") => {
            println!(
                "frontend {} preview {} engine {}",
                {{name}}_core::PORT_FRONTEND,
                {{name}}_core::PORT_PREVIEW,
                {{name}}_core::PORT_ENGINE
            );
            ExitCode::SUCCESS
        }
        Some(other) => {
            eprintln!("{}: unknown command: {}", {{name}}_core::NAME, other);
            ExitCode::from(2)
        }
    }
}
