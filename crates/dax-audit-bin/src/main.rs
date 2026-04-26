use dax_audit::{evaluate, AuditInput};
use std::io::{self, Read};
use std::process;

/// JSON boundary entry point.
///
/// Commands:
///   dax-audit evaluate  — reads AuditInput JSON from stdin, emits TrustReport JSON
///   dax-audit version   — prints crate version
fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str).unwrap_or("evaluate") {
        "evaluate" => run_evaluate(),
        "version" => println!("{}", env!("CARGO_PKG_VERSION")),
        other => {
            eprintln!("unknown command: {other}");
            eprintln!("usage: dax-audit <evaluate|version>");
            process::exit(1);
        }
    }
}

fn read_input() -> AuditInput {
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        eprintln!("error reading stdin: {e}");
        process::exit(1);
    }
    match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("error parsing audit input: {e}");
            process::exit(1);
        }
    }
}

fn run_evaluate() {
    let input = read_input();
    let report = evaluate(&input);
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("serialization failed")
    );
}
