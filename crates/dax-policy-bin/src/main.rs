use dax_policy::{classify_path, evaluate, PathClassification, PolicyRequest};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::io::{self, Read};
use std::process;

#[derive(Debug, Deserialize)]
struct ClassifyRequest {
    paths: Vec<String>,
    #[serde(default)]
    forbidden: Vec<String>,
    #[serde(default)]
    sensitive_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ClassifyResponse {
    results: Vec<PathClassification>,
}

/// JSON boundary entry point.
///
/// Commands:
///   dax-policy evaluate  — reads PolicyRequest JSON from stdin, emits PolicyDecision JSON
///   dax-policy classify  — reads path list JSON from stdin, emits PathClassification JSON
///   dax-policy version   — prints crate version
fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str).unwrap_or("evaluate") {
        "evaluate" => run_evaluate(),
        "classify" => run_classify(),
        "version" => println!("{}", env!("CARGO_PKG_VERSION")),
        other => {
            eprintln!("unknown command: {other}");
            eprintln!("usage: dax-policy <evaluate|classify|version>");
            process::exit(1);
        }
    }
}

fn read_request<T: DeserializeOwned>() -> T {
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
    let request: PolicyRequest = read_request();
    let decision = evaluate(&request);
    println!(
        "{}",
        serde_json::to_string_pretty(&decision).expect("serialization failed")
    );
}

fn run_classify() {
    let request: ClassifyRequest = read_request();
    let response = ClassifyResponse {
        results: request
            .paths
            .iter()
            .map(|path| classify_path(path, &request.forbidden, &request.sensitive_paths))
            .collect(),
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&response).expect("serialization failed")
    );
}
