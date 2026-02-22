#!/usr/bin/env node

import { runAudit } from "./commands/audit";
import { runPolicy } from "./commands/policy";
import { runDax } from "./commands/run";
import { runVerifyLedger } from "./commands/verify-ledger";
import { runTools } from "./commands/tools";
import { runConfig } from "./commands/config";
import { runTui } from "./commands/tui";
import { runStream } from "./commands/stream";
import { runMemory } from "./commands/memory";
import { runTool } from "./commands/tool";
import { runSessions } from "./commands/sessions";
import { runApprovals } from "./commands/approvals";
import { runArtifacts } from "./commands/artifacts";

const args = process.argv.slice(2);
const cmd = args[0];

const commandMap: { [key: string]: (...args: any[]) => any } = {
  audit: runAudit,
  policy: runPolicy,
  run: runDax,
  verify: runVerifyLedger,
  tools: runTools,
  config: runConfig,
  tui: runTui,
  stream: runStream,
  memory: runMemory,
  tool: runTool,
  sessions: runSessions,
  approvals: runApprovals,
  artifacts: runArtifacts,
};

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(`dax: clean-room scaffold

Commands:
  audit      Show RAO ledger events
  policy     View or edit policy rules
  run        Execute a JSON plan
  tools      List available tools
  tool       Execute tool (read/write/exec)
  verify     Verify ledger hash chain
  config     View or edit config
  memory     Read/write project memory
  sessions   List session history
  approvals  List pending approvals
  artifacts  List artifacts
  tui        Start terminal UI (stream)
  stream     Stream a prompt (thinking + text)
  help       Show help`);
  process.exit(0);
}

const commandFn = commandMap[cmd];
if (commandFn) {
  // some commands don't take cwd
  const takesCwd = [
    "audit",
    "policy",
    "run",
    "verify",
    "config",
    "memory",
    "tool",
    "sessions",
    "approvals",
    "artifacts",
    "stream",
  ];
  if (takesCwd.includes(cmd)) {
    commandFn(args.slice(1), process.cwd());
  } else {
    commandFn(args.slice(1));
  }
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}
