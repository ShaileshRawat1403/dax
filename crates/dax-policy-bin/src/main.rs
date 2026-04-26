use dax_policy::{evaluate, PolicyRequest};
use std::io::{self, Read};
use std::process;

/// JSON boundary entry point.
///
/// Commands:
///   dax-policy evaluate  — reads PolicyRequest JSON from stdin, emits PolicyDecision JSON
///   dax-policy version   — prints crate version
fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str).unwrap_or("evaluate") {
        "evaluate" => run_evaluate(),
        "version" => println!("{}", env!("CARGO_PKG_VERSION")),
        other => {
            eprintln!("unknown command: {other}");
            eprintln!("usage: dax-policy <evaluate|version>");
            process::exit(1);
        }
    }
}

fn read_request() -> PolicyRequest {
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        eprintln!("error reading stdin: {e}");
        process::exit(1);
    }
    match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("error parsing policy request: {e}");
            process::exit(1);
        }
    }
}

fn run_evaluate() {
    let request = read_request();
    let decision = evaluate(&request);
    println!(
        "{}",
        serde_json::to_string_pretty(&decision).expect("serialization failed")
    );
}
