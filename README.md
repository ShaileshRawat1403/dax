# DAX — Deterministic AI Execution

DAX is a policy-driven execution system for software delivery. It is built around RAO:
- **Run**: Propose minimal action to advance a goal.
- **Audit**: Evaluate scope, risk, and policy.
- **Override**: Accept explicit allow/deny/persist decisions.

## Features

- **Policy Engine**: First-class system for controlling tool access.
- **RAO Ledger**: Per-project audit trail with event history.
- **AI Planning**: Generate execution plans from natural language prompts.
- **Tool Registry**: Declarative tool definitions with permissions.
- **Deterministic Execution**: Traceable automation with explicit policy checkpoints.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) runtime installed.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/dax.git
   cd dax
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Set your API key (for OpenAI):
   ```bash
   export OPENAI_API_KEY="sk-..."
   ```

### Usage

#### Run a plan from a file
```bash
bun run dev run plan.json
```

#### Run from a prompt (AI generates the plan)
```bash
bun run dev run --prompt "Create a file called hello.txt with 'Hello World'"
```

#### Start the interactive TUI
```bash
bun run dev tui
```

#### Other commands
- `dax audit`: Show RAO ledger events.
- `dax policy`: View or edit policy rules.
- `dax memory`: Read/write project memory.
- `dax sessions`: List session history.

## Architecture

- `core/session`: Execution runtime.
- `core/tools`: Tool registry and actions.
- `core/policy`: Policy engine.
- `core/ledger`: Audit ledger.
- `cli`: Command-line interface.
- `tui`: Interactive terminal UI.
- `providers`: AI provider integrations.

## Development

- `bun run dev`: Run the CLI in development mode.
- `bun run build`: Build the production bundle.
- `bun run typecheck`: Check for type errors.

## License

MIT
