# DAX — Deterministic AI Execution

DAX is a policy-driven execution system for software delivery. It is built around RAO:
- **Run**: Propose minimal action to advance a goal.
- **Audit**: Evaluate scope, risk, and policy.
- **Override**: Accept explicit allow/deny/persist decisions.

## Features

- **Modern Terminal UIs**: Two interactive TUIs (SolidJS-based and Ink-based) with 70/30 split views and real-time agent activity tracking.
- **Ollama Integration**: Seamless support for local models with automatic detection and no-auth setup.
- **Ultra-Compact UI**: Icon-based command strip and streamlined header for maximum focus.
- **Policy Engine**: First-class system for controlling tool access.
- **RAO Ledger**: Per-project audit trail with event history.
- **AI Planning**: Generate execution plans from natural language prompts.
- **Tool Registry**: Declarative tool definitions with permissions.
- **Deterministic Execution**: Traceable automation with explicit policy checkpoints.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) runtime installed.
- [Ollama](https://ollama.com) (optional, for local models).

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/ShaileshRawat1403/dax.git
   cd dax
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Configure a provider (optional if using Ollama):
   ```bash
   export OPENAI_API_KEY="sk-..."
   # Or run 'dax auth' in the TUI
   ```

### Usage

#### Start the interactive TUI (Modern)
```bash
bun dev
```

#### Run a plan from a file
```bash
bun dev run plan.json
```

#### Run from a prompt (AI generates the plan)
```bash
bun dev run --prompt "Create a file called hello.txt with 'Hello World'"
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
