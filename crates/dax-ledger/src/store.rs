use crate::chain::{append, verify_chain};
use crate::entry::LedgerEntry;
use crate::error::LedgerError;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

pub fn load_jsonl(path: &Path) -> Result<Vec<LedgerEntry>, LedgerError> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path)?;
    let mut entries = Vec::new();
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        entries.push(serde_json::from_str(line)?);
    }
    verify_chain(&entries)?;
    Ok(entries)
}

pub fn append_to_file(path: &Path, body: &Value, ts: &str) -> Result<LedgerEntry, LedgerError> {
    let entries = load_jsonl(path)?;
    let entry = append(entries.last(), body, ts);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{}", serde_json::to_string(&entry)?)?;
    file.sync_data()?;

    Ok(entry)
}
