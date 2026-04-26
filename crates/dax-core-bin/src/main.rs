use dax_core::events::RunEvent;
use dax_core::reducer::replay_run_state;
use std::io::{self, Read};
use std::process;

/// JSON boundary entry point.
///
/// Usage:
///   echo '[...events]' | dax-core replay
///   dax-core replay < events.json
///
/// Exits 0 with the final RunState JSON on stdout.
/// Exits 1 with an error message on stderr.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let command = args.get(1).map(String::as_str).unwrap_or("replay");

    match command {
        "replay" => run_replay(),
        "version" => {
            println!("{}", env!("CARGO_PKG_VERSION"));
        }
        other => {
            eprintln!("unknown command: {other}");
            eprintln!("usage: dax-core <replay|version>");
            process::exit(1);
        }
    }
}

fn run_replay() {
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        eprintln!("error reading stdin: {e}");
        process::exit(1);
    }

    let events: Vec<RunEvent> = match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("error parsing events: {e}");
            process::exit(1);
        }
    };

    match replay_run_state(&events) {
        Ok(state) => {
            let output = serde_json::to_string_pretty(&state).expect("serialization failed");
            println!("{output}");
        }
        Err(e) => {
            eprintln!("replay error: {e}");
            process::exit(1);
        }
    }
}
