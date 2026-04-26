use crate::command::ActionClass;
use crate::decision::RiskLevel;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolClassification {
    pub risk: RiskLevel,
    pub action_class: ActionClass,
}

pub fn classify_tool(tool: &str) -> ToolClassification {
    match tool {
        "bash" | "shell" | "exec" | "run_command" => ToolClassification {
            risk: RiskLevel::High,
            action_class: ActionClass::Mutate,
        },
        "write_file" | "create_file" | "overwrite_file" => ToolClassification {
            risk: RiskLevel::Medium,
            action_class: ActionClass::Mutate,
        },
        "edit_file" | "patch_file" | "replace_in_file" => ToolClassification {
            risk: RiskLevel::Medium,
            action_class: ActionClass::Mutate,
        },
        "delete_file" | "remove_file" | "unlink" => ToolClassification {
            risk: RiskLevel::High,
            action_class: ActionClass::Mutate,
        },
        "read_file" | "cat_file" | "view_file" => ToolClassification {
            risk: RiskLevel::Low,
            action_class: ActionClass::Analyze,
        },
        "list_dir" | "ls" | "find_files" | "glob" => ToolClassification {
            risk: RiskLevel::Low,
            action_class: ActionClass::Analyze,
        },
        "search_code" | "grep" | "ripgrep" => ToolClassification {
            risk: RiskLevel::Low,
            action_class: ActionClass::Analyze,
        },
        "web_fetch" | "http_get" | "fetch_url" => ToolClassification {
            risk: RiskLevel::Medium,
            action_class: ActionClass::Analyze,
        },
        "web_search" | "search_web" => ToolClassification {
            risk: RiskLevel::Low,
            action_class: ActionClass::Analyze,
        },
        "git_commit" | "git_push" | "git_tag" => ToolClassification {
            risk: RiskLevel::High,
            action_class: ActionClass::Commit,
        },
        "github_pr" | "github_issue" | "github_release" => ToolClassification {
            risk: RiskLevel::Critical,
            action_class: ActionClass::Publish,
        },
        "deploy" | "publish" | "upload" => ToolClassification {
            risk: RiskLevel::Critical,
            action_class: ActionClass::Publish,
        },
        _ => ToolClassification {
            risk: RiskLevel::Medium,
            action_class: ActionClass::Analyze,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bash_is_high_risk() {
        let c = classify_tool("bash");
        assert_eq!(c.risk, RiskLevel::High);
        assert_eq!(c.action_class, ActionClass::Mutate);
    }

    #[test]
    fn read_file_is_low_risk() {
        let c = classify_tool("read_file");
        assert_eq!(c.risk, RiskLevel::Low);
        assert_eq!(c.action_class, ActionClass::Analyze);
    }

    #[test]
    fn github_release_is_critical() {
        let c = classify_tool("github_release");
        assert_eq!(c.risk, RiskLevel::Critical);
        assert_eq!(c.action_class, ActionClass::Publish);
    }

    #[test]
    fn unknown_tool_defaults_medium_analyze() {
        let c = classify_tool("some_unknown_tool");
        assert_eq!(c.risk, RiskLevel::Medium);
        assert_eq!(c.action_class, ActionClass::Analyze);
    }
}
