use dax_core::events::RunEvent;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditSeverity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditFinding {
    pub id: String,
    pub severity: AuditSeverity,
    pub category: String,
    pub title: String,
    pub blocking: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditInput {
    pub session_id: String,
    /// Replayed run events — used to derive RunState signals (approvals, artifacts, steps).
    pub events: Vec<RunEvent>,
    /// Findings from an audit run (severity, blocking flag). Empty means no audit was performed.
    #[serde(default)]
    pub findings: Vec<AuditFinding>,
    /// Number of policy actions that were evaluated (used for evidence_completeness check).
    #[serde(default)]
    pub policy_decision_count: u32,
    /// Number of governance overrides recorded for this session.
    #[serde(default)]
    pub override_count: u32,
    /// Whether an audit has been explicitly run for this session.
    #[serde(default)]
    pub audit_present: bool,
}
