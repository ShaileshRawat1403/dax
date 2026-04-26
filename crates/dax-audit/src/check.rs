use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckId {
    ApprovalCompliance,
    PolicyCompliance,
    ArtifactPresence,
    EvidenceCompleteness,
    TraceContinuity,
    OverridesJustified,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Pass,
    Fail,
    Warn,
    Incomplete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditCheck {
    pub id: CheckId,
    pub label: String,
    pub status: CheckStatus,
    pub summary: String,
}
