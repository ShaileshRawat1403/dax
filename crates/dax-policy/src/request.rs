use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyProfile {
    Strict,
    #[default]
    Standard,
    Permissive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyBudget {
    pub total_allowed: u32,
    pub mutating_allowed: u32,
    pub external_allowed: u32,
    pub total_used: u32,
    pub mutating_used: u32,
    pub external_used: u32,
}

impl Default for PolicyBudget {
    fn default() -> Self {
        Self {
            total_allowed: 8,
            mutating_allowed: 6,
            external_allowed: 4,
            total_used: 0,
            mutating_used: 0,
            external_used: 0,
        }
    }
}

impl PolicyBudget {
    pub fn is_total_exhausted(&self) -> bool {
        self.total_used >= self.total_allowed
    }

    pub fn is_mutating_exhausted(&self) -> bool {
        self.mutating_used >= self.mutating_allowed
    }

    pub fn is_external_exhausted(&self) -> bool {
        self.external_used >= self.external_allowed
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PolicyContext {
    #[serde(default)]
    pub profile: PolicyProfile,
    #[serde(default)]
    pub allowlist: Vec<String>,
    #[serde(default)]
    pub blocklist: Vec<String>,
    #[serde(default)]
    pub avoid_areas: Vec<String>,
    #[serde(default)]
    pub budget: PolicyBudget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyAction {
    #[serde(rename = "type")]
    pub action_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRequest {
    pub session_id: String,
    pub action: PolicyAction,
    #[serde(default)]
    pub context: PolicyContext,
}
