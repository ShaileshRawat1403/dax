# Streaming

DAX streaming emits two channels:
- thinking: intermediate model reasoning tokens
- text: final output tokens

CLI usage:
- `node cli/index.js stream "prompt"`
- `node cli/index.js tui --thinking "prompt"`
- `node cli/index.js tui --no-thinking "prompt"`

Thinking visibility can be toggled in TUI with `t`.
