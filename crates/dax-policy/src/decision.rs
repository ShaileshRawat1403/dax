use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub decision: Decision,
    pub risk: RiskLevel,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<String>,
}

impl PolicyDecision {
    pub fn allow(risk: RiskLevel, reason: impl Into<String>) -> Self {
        Self {
            decision: Decision::Allow,
            risk,
            reason: reason.into(),
            gate: None,
        }
    }

    pub fn ask(risk: RiskLevel, reason: impl Into<String>, gate: impl Into<String>) -> Self {
        Self {
            decision: Decision::Ask,
            risk,
            reason: reason.into(),
            gate: Some(gate.into()),
        }
    }

    pub fn deny(risk: RiskLevel, reason: impl Into<String>) -> Self {
        Self {
            decision: Decision::Deny,
            risk,
            reason: reason.into(),
            gate: None,
        }
    }
}
