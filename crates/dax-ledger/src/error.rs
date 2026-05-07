#[derive(Debug, thiserror::Error)]
pub enum ChainError {
    #[error("chain broken at seq {seq}: {reason}")]
    Break { seq: u64, reason: String },
    #[error("sequence gap at expected seq {expected}, got {got}")]
    Gap { expected: u64, got: u64 },
    #[error("body hash mismatch at seq {seq}")]
    BodyHashMismatch { seq: u64 },
}

#[derive(Debug, thiserror::Error)]
pub enum LedgerError {
    #[error(transparent)]
    Chain(#[from] ChainError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
