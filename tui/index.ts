#!/usr/bin/env node

import blessed from "blessed";
import { streamSession } from "../core/session/stream";
import { listPending } from "../core/governance/pending";
import { addRule } from "../core/policy";
import { resolvePending } from "../core/governance/pending";
import { listArtifacts } from "../core/artifacts";
import { runSession } from "../core/session";
import { parsePlan } from "../core/session/parser";

const args = process.argv.slice(2);
const prompt = args.join(" ") || "Hello, what can you help me with?";

// Create screen
const screen = blessed.screen({
  smartCSR: true,
  title: "DAX - Deterministic AI Execution",
});

// Create layout boxes
const header = blessed.box({
  top: 0,
  left: 0,
  width: "100%",
  height: 3,
  content: `{bold}DAX{/bold} - Deterministic AI Execution`,
  style: {
    fg: "cyan",
    bold: true,
  },
  tags: true,
});

const main = blessed.box({
  top: 3,
  left: 0,
  width: "100%",
  height: "80%",
  content: "Initializing...",
  style: {
    fg: "white",
  },
  scrollable: true,
  alwaysScroll: true,
});

const statusBar = blessed.box({
  bottom: 0,
  left: 0,
  width: "100%",
  height: 3,
  content: "Stream: [Waiting] | Approvals: [0] | Press 'q' to quit, 'r' to run plan",
  style: {
    fg: "green",
    bg: "blue",
  },
});

const sidebar = blessed.box({
  top: 3,
  right: 0,
  width: "30%",
  height: "80%",
  content: "{bold}Pending Approvals{/bold}\n\n(No pending items)",
  style: {
    fg: "white",
    bg: "black",
  },
  border: {
    type: "line" as const,
    fg: "white",
  },
} as any);

// Add boxes to screen
screen.append(header);
screen.append(main);
screen.append(statusBar);
screen.append(sidebar);

// State
let currentPlan: any = null;
let isStreaming = false;
let planText = "";
let metrics: any = null;

// Helper to update status
function updateStatus(msg: string) {
  statusBar.setContent(msg);
  screen.render();
}

// Helper to update sidebar
function updateSidebar() {
  const pending = listPending(process.cwd());
  if (pending.length === 0) {
    sidebar.setContent("{bold}Pending Approvals{/bold}\n\n(No pending items)");
  } else {
    const items = pending
      .map(
        (p, i) =>
          `${i + 1}. {yellow}${p.permission}{/yellow}\n   ${p.pattern}\n`,
      )
      .join("\n");
    sidebar.setContent(`{bold}Pending Approvals (${pending.length}){/bold}\n\n${items}`);
  }
  screen.render();
}

// Render initial
screen.render();
updateSidebar();

// Handle input
screen.key(["q", "C-c"], () => {
  return process.exit(0);
});

screen.key(["r"], async () => {
  if (!currentPlan) {
    updateStatus("{red}No plan to execute!{/red}");
    return;
  }
  updateStatus("{yellow}Executing plan...{/yellow}");
  const result = await runSession({
    projectDir: process.cwd(),
    plan: currentPlan,
  });
  if (result.status === "ok") {
    updateStatus("{green}Execution successful!{/green}");
  } else {
    updateStatus(`{red}Error: ${(result as any).error}{/red}`);
  }
  // Refresh artifacts
  const artifacts = listArtifacts(process.cwd(), 5);
  const artText = artifacts
    .map((a) => `• ${a.type}: ${(a as any).path || (a as any).command}`)
    .join("\n");
  main.setContent(main.content + "\n\n{bold}Recent Artifacts:{/bold}\n" + artText);
  screen.render();
});

screen.key(["a"], () => {
  const pending = listPending(process.cwd());
  if (pending.length > 0) {
    const item = pending[0];
    addRule(process.cwd(), {
      permission: item.permission,
      pattern: item.pattern,
      action: "allow",
    });
    resolvePending(process.cwd(), item.id);
    updateStatus("{green}Approved: " + item.permission + "{/green}");
    updateSidebar();
  }
});

screen.key(["d"], () => {
  const pending = listPending(process.cwd());
  if (pending.length > 0) {
    const item = pending[0];
    resolvePending(process.cwd(), item.id);
    updateStatus("{red}Denied: " + item.permission + "{/red}");
    updateSidebar();
  }
});

// Start streaming
async function run() {
  isStreaming = true;
  updateStatus("{yellow}Streaming...{/yellow}");

  for await (const chunk of streamSession({
    projectDir: process.cwd(),
    prompt,
  })) {
    if (chunk.type === "text") {
      planText += chunk.delta;
      main.setContent(planText);
      screen.render();
    } else if (chunk.type === "thinking") {
      // Could show thinking in a separate box
    } else if (chunk.type === "metrics") {
      metrics = chunk.data;
      updateStatus(
        `{yellow}Done{/yellow} | Provider: ${metrics.provider} | ${metrics.ms}ms | ~${metrics.tokens} tokens`,
      );
    } else if (chunk.type === "done") {
      currentPlan = parsePlan(planText);
      if (currentPlan) {
        main.setContent(
          planText +
            "\n\n{bold}{green}Plan detected!{/green}{/bold}\n" +
            JSON.stringify(currentPlan, null, 2),
        );
        updateStatus(
          "{green}Plan ready!{/green} Press 'r' to execute, 'a/d' to manage approvals.",
        );
      }
      isStreaming = false;
      screen.render();
    }
  }
}

run().catch((err) => {
  main.setContent("{red}Error: " + err.message + "{/red}");
  screen.render();
});
