use dax_core::events::RunEvent;
use dax_core::reducer::replay_run_state;
use sha2::{Digest, Sha256};
use std::io::{self, Read};
use std::process;

/// JSON boundary entry point.
///
/// Commands:
///   dax-core replay   — reads JSON event array from stdin, emits final RunState JSON
///   dax-core proof    — reads JSON event array from stdin, emits determinism proof report
///   dax-core version  — prints crate version
fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str).unwrap_or("replay") {
        "replay" => run_replay(),
        "proof" => run_proof(),
        "version" => println!("{}", env!("CARGO_PKG_VERSION")),
        other => {
            eprintln!("unknown command: {other}");
            eprintln!("usage: dax-core <replay|proof|version>");
            process::exit(1);
        }
    }
}

fn read_events() -> Vec<RunEvent> {
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        eprintln!("error reading stdin: {e}");
        process::exit(1);
    }
    match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("error parsing events: {e}");
            process::exit(1);
        }
    }
}

fn sha256_of(value: &serde_json::Value) -> String {
    let canonical = serde_json::to_string(value).expect("serialization failed");
    let digest = Sha256::digest(canonical.as_bytes());
    format!("sha256:{}", hex::encode(digest))
}

fn run_replay() {
    let events = read_events();
    match replay_run_state(&events) {
        Ok(state) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&state).expect("serialization failed")
            );
        }
        Err(e) => {
            eprintln!("replay error: {e}");
            process::exit(1);
        }
    }
}

fn run_proof() {
    let events = read_events();

    let mut sorted = events.clone();
    sorted.sort_by_key(|e| e.sequence);
    let event_value = serde_json::to_value(&sorted).expect("serialization failed");
    let event_sequence_hash = sha256_of(&event_value);

    match replay_run_state(&events) {
        Ok(state) => {
            let state_value = serde_json::to_value(&state).expect("serialization failed");
            let state_hash = sha256_of(&state_value);
            let final_status = serde_json::to_value(&state.status).expect("serialization failed");

            let report = serde_json::json!({
                "schemaVersion": "dax.core.proof.v1",
                "result": "pass",
                "eventCount": events.len(),
                "finalStatus": final_status,
                "stateHash": state_hash,
                "eventSequenceHash": event_sequence_hash
            });
            println!(
                "{}",
                serde_json::to_string_pretty(&report).expect("serialization failed")
            );
        }
        Err(e) => {
            let report = serde_json::json!({
                "schemaVersion": "dax.core.proof.v1",
                "result": "fail",
                "eventCount": events.len(),
                "error": e.to_string(),
                "eventSequenceHash": event_sequence_hash
            });
            eprintln!(
                "{}",
                serde_json::to_string_pretty(&report).expect("serialization failed")
            );
            process::exit(1);
        }
    }
}
