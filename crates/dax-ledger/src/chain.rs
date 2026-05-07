use crate::entry::{LedgerEntry, LEDGER_ENTRY_SCHEMA_VERSION};
use crate::error::ChainError;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub fn canonical_json(value: &Value) -> String {
    let canonical = canonicalize(value);
    serde_json::to_string(&canonical).expect("canonical JSON serialization failed")
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        Value::Object(map) => {
            let mut sorted = Map::new();
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            for key in keys {
                sorted.insert(key.clone(), canonicalize(&map[key]));
            }
            Value::Object(sorted)
        }
        _ => value.clone(),
    }
}

fn sha256(input: &[u8]) -> String {
    let digest = Sha256::digest(input);
    format!("sha256:{}", hex::encode(digest))
}

fn body_hash(body: &Value) -> String {
    sha256(canonical_json(body).as_bytes())
}

fn chain_hash(prev_hash: &str, body_hash: &str) -> String {
    let mut input = Vec::with_capacity(prev_hash.len() + body_hash.len());
    input.extend_from_slice(prev_hash.as_bytes());
    input.extend_from_slice(body_hash.as_bytes());
    sha256(&input)
}

pub fn append(prev: Option<&LedgerEntry>, body: &Value, ts: &str) -> LedgerEntry {
    let seq = prev.map_or(0, |entry| entry.seq + 1);
    let prev_hash = prev.map_or_else(String::new, |entry| entry.chain_hash.clone());
    let body_hash = body_hash(body);
    let chain_hash = chain_hash(&prev_hash, &body_hash);

    LedgerEntry {
        schema_version: LEDGER_ENTRY_SCHEMA_VERSION.to_string(),
        seq,
        ts: ts.to_string(),
        prev_hash,
        body_hash,
        chain_hash,
        body: body.clone(),
    }
}

pub fn verify_chain(entries: &[LedgerEntry]) -> Result<(), ChainError> {
    let mut prev: Option<&LedgerEntry> = None;

    for entry in entries {
        let expected_seq = prev.map_or(0, |previous| previous.seq + 1);
        if entry.seq != expected_seq {
            return Err(ChainError::Gap {
                expected: expected_seq,
                got: entry.seq,
            });
        }

        if entry.schema_version != LEDGER_ENTRY_SCHEMA_VERSION {
            return Err(ChainError::Break {
                seq: entry.seq,
                reason: format!("unsupported schema version: {}", entry.schema_version),
            });
        }

        let expected_prev_hash = prev.map_or("", |previous| previous.chain_hash.as_str());
        if entry.prev_hash != expected_prev_hash {
            return Err(ChainError::Break {
                seq: entry.seq,
                reason: "prev_hash does not match previous chain_hash".to_string(),
            });
        }

        let expected_body_hash = body_hash(&entry.body);
        if entry.body_hash != expected_body_hash {
            return Err(ChainError::BodyHashMismatch { seq: entry.seq });
        }

        let expected_chain_hash = chain_hash(&entry.prev_hash, &entry.body_hash);
        if entry.chain_hash != expected_chain_hash {
            return Err(ChainError::Break {
                seq: entry.seq,
                reason: "chain_hash does not match prev_hash + body_hash".to_string(),
            });
        }

        prev = Some(entry);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_json_sorts_object_keys_recursively() {
        let value = json!({ "z": 1, "a": { "b": 2, "a": 1 } });
        assert_eq!(canonical_json(&value), r#"{"a":{"a":1,"b":2},"z":1}"#);
    }

    #[test]
    fn append_creates_contiguous_chain() {
        let first = append(
            None,
            &json!({ "kind": "run.created" }),
            "2026-05-07T00:00:00Z",
        );
        let second = append(
            Some(&first),
            &json!({ "kind": "run.completed" }),
            "2026-05-07T00:00:01Z",
        );

        assert_eq!(first.seq, 0);
        assert_eq!(first.prev_hash, "");
        assert_eq!(second.seq, 1);
        assert_eq!(second.prev_hash, first.chain_hash);
        verify_chain(&[first, second]).expect("chain should verify");
    }

    #[test]
    fn verify_detects_body_tamper() {
        let first = append(
            None,
            &json!({ "kind": "run.created" }),
            "2026-05-07T00:00:00Z",
        );
        let mut second = append(
            Some(&first),
            &json!({ "kind": "run.completed" }),
            "2026-05-07T00:00:01Z",
        );
        second.body = json!({ "kind": "run.failed" });

        assert!(matches!(
            verify_chain(&[first, second]),
            Err(ChainError::BodyHashMismatch { seq: 1 })
        ));
    }

    #[test]
    fn verify_detects_sequence_gap() {
        let first = append(
            None,
            &json!({ "kind": "run.created" }),
            "2026-05-07T00:00:00Z",
        );
        let mut second = append(
            Some(&first),
            &json!({ "kind": "run.completed" }),
            "2026-05-07T00:00:01Z",
        );
        second.seq = 3;

        assert!(matches!(
            verify_chain(&[first, second]),
            Err(ChainError::Gap {
                expected: 1,
                got: 3
            })
        ));
    }
}
