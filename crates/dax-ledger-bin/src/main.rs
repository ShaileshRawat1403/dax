use dax_ledger::{append, append_to_file, load_jsonl, verify_chain, LedgerEntry};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::io::{self, Read};
use std::path::PathBuf;
use std::process;

#[derive(Debug, Deserialize)]
struct AppendRequest {
    prev: Option<LedgerEntry>,
    body: serde_json::Value,
    ts: String,
}

#[derive(Debug, Deserialize)]
struct VerifyRequest {
    entries: Vec<LedgerEntry>,
}

#[derive(Debug, Serialize)]
struct VerifyResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seq: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct FileRequest {
    path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct AppendFileRequest {
    path: PathBuf,
    body: serde_json::Value,
    ts: String,
}

#[derive(Debug, Serialize)]
struct ExportResponse {
    entries: Vec<LedgerEntry>,
    verified: bool,
}

/// JSON boundary entry point.
///
/// Commands:
///   dax-ledger append       — reads AppendRequest JSON from stdin, emits LedgerEntry JSON
///   dax-ledger verify       — reads VerifyRequest JSON from stdin, emits VerifyResponse JSON
///   dax-ledger append-file  — appends a body to a JSONL ledger file and emits LedgerEntry JSON
///   dax-ledger export       — reads a JSONL ledger file and emits entries + verified status
///   dax-ledger version      — prints crate version
fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str).unwrap_or("verify") {
        "append" => run_append(),
        "verify" => run_verify(),
        "append-file" => run_append_file(),
        "export" => run_export(),
        "version" => println!("{}", env!("CARGO_PKG_VERSION")),
        other => {
            eprintln!("unknown command: {other}");
            eprintln!("usage: dax-ledger <append|verify|append-file|export|version>");
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
            eprintln!("error parsing ledger request: {e}");
            process::exit(1);
        }
    }
}

fn print_json<T: Serialize>(value: &T) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).expect("serialization failed")
    );
}

fn run_append() {
    let request: AppendRequest = read_request();
    let entry = append(request.prev.as_ref(), &request.body, &request.ts);
    print_json(&entry);
}

fn run_verify() {
    let request: VerifyRequest = read_request();
    let response = match verify_chain(&request.entries) {
        Ok(()) => VerifyResponse {
            ok: true,
            error: None,
            seq: None,
        },
        Err(error) => VerifyResponse {
            seq: match &error {
                dax_ledger::ChainError::Break { seq, .. } => Some(*seq),
                dax_ledger::ChainError::BodyHashMismatch { seq } => Some(*seq),
                dax_ledger::ChainError::Gap { got, .. } => Some(*got),
            },
            ok: false,
            error: Some(error.to_string()),
        },
    };
    print_json(&response);
}

fn run_append_file() {
    let request: AppendFileRequest = read_request();
    match append_to_file(&request.path, &request.body, &request.ts) {
        Ok(entry) => print_json(&entry),
        Err(error) => {
            eprintln!("ledger append-file error: {error}");
            process::exit(1);
        }
    }
}

fn run_export() {
    let request: FileRequest = read_request();
    match load_jsonl(&request.path) {
        Ok(entries) => print_json(&ExportResponse {
            entries,
            verified: true,
        }),
        Err(error) => {
            eprintln!("ledger export error: {error}");
            process::exit(1);
        }
    }
}
