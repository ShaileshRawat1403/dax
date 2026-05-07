use serde::{Deserialize, Serialize};

pub const LEDGER_ENTRY_SCHEMA_VERSION: &str = "dax.ledger.entry.v1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub schema_version: String,
    pub seq: u64,
    pub ts: String,
    pub prev_hash: String,
    pub body_hash: String,
    pub chain_hash: String,
    pub body: serde_json::Value,
}
