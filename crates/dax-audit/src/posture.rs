use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationResult {
    Passed,
    Failed,
    Incomplete,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustPostureLevel {
    Verified,
    PolicyClean,
    ReviewNeeded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustReport {
    pub schema_version: String,
    pub session_id: String,
    pub posture: TrustPostureLevel,
    pub verification_result: VerificationResult,
    pub checks: Vec<crate::check::AuditCheck>,
    pub blocking_factors: Vec<String>,
    pub missing_evidence: Vec<String>,
    pub degrading_factors: Vec<String>,
    pub passing_signals: Vec<String>,
}
