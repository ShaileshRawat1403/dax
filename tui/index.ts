#!/usr/bin/env node

import { streamSession } from "../core/session/stream";
import { listNotes } from "../core/pm";
import { readEvents } from "../core/ledger";
import { listPending } from "../core/governance/pending";
import { listArtifacts, Artifact } from "../core/artifacts";
import { addRule } from "../core/policy";
import { resolvePending } from "../core/governance/pending";
import { recordEvent } from "../core/ledger";
import { parsePlan } from "../core/session/parser";
import { runSession } from "../core/session";
import { Step } from "../core/tools/schema";

type Pane = "rao" | "pm" | "approvals" | "artifacts" | "plan";

const args = process.argv.slice(2);
let showThinking: boolean = !args.includes("--no-thinking");
let pane: Pane = "rao";
let lastMetrics: any = null;
const prompt: string =
  args.filter((a) => !a.startsWith("--")).join(" ") || "hello";
let currentPlan: Step[] | null = null;
let thinking: string = "";
let text: string = "";

function clear(): void {
  process.stdout.write("\x1b[2J\x1b[0;0H");
}

function moveCursor(row: number, col: number): void {
  process.stdout.write(`\x1b[${row};${col}H`);
}

function renderPane(): void {
  // This function was called but not defined in the original code.
  // It should just re-render the UI.
  renderUI();
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (buf: Buffer) => {
    const key = buf.toString("utf8");
    if (key === "q" || key === "\u0003") {
      // Handle Ctrl+C
      clear();
      process.exit(0);
    }
    if (key === "t") showThinking = !showThinking;
    if (key === "1") pane = "rao";
    if (key === "2") pane = "pm";
    if (key === "3") pane = "approvals";
    if (key === "4") pane = "artifacts";
    if (key === "5") pane = "plan";
    if (key === "a" && pane === "approvals") approveFirst();
    if (key === "d" && pane === "approvals") denyFirst();
    if (key === "r") executePlan();
    renderUI();
  });
} else {
  console.error("Error: TUI requires an interactive terminal (TTY).");
  process.exit(1);
}

function approveFirst(): void {
  const pending = listPending(process.cwd());
  const item = pending[0];
  if (!item) return;
  addRule(process.cwd(), {
    permission: item.permission,
    pattern: item.pattern,
    action: "allow",
  });
  resolvePending(process.cwd(), item.id);
  recordEvent(process.cwd(), {
    type: "override",
    payload: { decision: "allow_always", permission: item.permission },
  });
  renderPane();
}

function denyFirst(): void {
  const pending = listPending(process.cwd());
  const item = pending[0];
  if (!item) return;
  resolvePending(process.cwd(), item.id);
  recordEvent(process.cwd(), {
    type: "override",
    payload: { decision: "deny", permission: item.permission },
  });
  renderUI();
}

async function executePlan(): Promise<void> {
  if (!currentPlan) return;
  process.stdout.write("\n[SYSTEM] Executing plan...\n");
  const result = await runSession({
    projectDir: process.cwd(),
    plan: currentPlan,
  });
  if (result.status === "ok") {
    process.stdout.write("[SYSTEM] Execution successful.\n");
  } else {
    process.stdout.write(
      `[SYSTEM] Execution failed: ${
        (result as { error?: string }).error || "Unknown error"
      }\n`,
    );
  }
  renderUI();
}

function renderUI(): void {
  process.stdout.write("\x1b[s"); // Save cursor
  moveCursor(1, 1);

  // Header
  process.stdout.write("\x1b[7m DAX | Deterministic AI Execution \x1b[0m");
  process.stdout.write(
    `  Pane: \x1b[1m${pane.toUpperCase()}\x1b[0m  |  Thinking: ${
      showThinking ? "ON" : "OFF"
    }\n`,
  );
  process.stdout.write("─".repeat(process.stdout.columns) + "\n");

  // Content
  let content = "";
  if (pane === "pm") {
    const notes = listNotes(process.cwd(), 5);
    content = notes.map((n) => `• ${n.text}`).join("\n") || "(empty)";
  } else if (pane === "rao") {
    const events = readEvents(process.cwd(), 5);
    content =
      events
        .map(
          (e) =>
            `[${e.ts.slice(11, 19)}] ${e.type.padEnd(12)} | ${JSON.stringify(
              e.payload,
            ).slice(0, 60)}...`,
        )
        .join("\n") || "(empty)";
  } else if (pane === "approvals") {
    const pending = listPending(process.cwd());
    content =
      pending.map((p) => `⚠️  ${p.permission} -> ${p.pattern}`).join("\n") ||
      "(none)";
  } else if (pane === "artifacts") {
    const items = listArtifacts(process.cwd(), 5);
    content =
      items
        .map(
          (a: Artifact) =>
            `📦 ${a.type}: ${(a as any).path || (a as any).command || ""}`,
        )
        .join("\n") || "(none)";
  } else if (pane === "plan") {
    content = currentPlan
      ? JSON.stringify(currentPlan, null, 2)
      : "(no plan detected)";
  }

  const lines = content.split("\n").slice(0, 6);
  for (let i = 0; i < 6; i++) {
    process.stdout.write("\x1b[K" + (lines[i] || "") + "\n");
  }

  // Footer
  process.stdout.write("─".repeat(process.stdout.columns) + "\n");
  if (lastMetrics) {
    process.stdout.write(
      `\x1b[K\x1b[90mMetrics: ${lastMetrics.provider} | ${lastMetrics.ms}ms | ~${lastMetrics.tokens} tokens\x1b[0m\n`,
    );
  } else {
    process.stdout.write("\x1b[K\n");
  }
  process.stdout.write(
    "\x1b[K\x1b[90mKeys: 1-5:Panes | t:Thinking | r:Run | a/d:Approve/Deny | q:Quit\x1b[0m\n",
  );
  process.stdout.write("─".repeat(process.stdout.columns) + "\n");

  process.stdout.write("\x1b[u"); // Restore cursor
}

async function main() {
  clear();
  process.stdout.write("\n".repeat(12));
  renderUI();

  for await (const chunk of streamSession({
    projectDir: process.cwd(),
    prompt,
  })) {
    if (chunk.type === "thinking") {
      thinking += chunk.delta;
      if (showThinking) process.stdout.write(chunk.delta);
    } else if (chunk.type === "text") {
      text += chunk.delta;
      process.stdout.write(chunk.delta);
    } else if (chunk.type === "metrics") {
      lastMetrics = chunk.data;
      renderUI();
    } else if (chunk.type === "done" || chunk.type === "error") {
      currentPlan = parsePlan(text);
      process.stdout.write("\n");
      if (currentPlan)
        process.stdout.write(
          "\x1b[1;32m[SYSTEM] Plan detected. Press '5' to view or 'r' to run.\x1b[0m\n",
        );
      renderUI();
    }
  }

  if (!showThinking && thinking) {
    process.stdout.write("\n[thinking hidden]\n");
  }
}

main().catch(console.error);
