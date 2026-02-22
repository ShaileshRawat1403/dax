#!/usr/bin/env node

import blessed from "blessed";
import { createInitialState, TUIState, Message } from "./state";
import { createMessageList } from "./components/MessageList";
import { createPromptInput } from "./components/PromptInput";
import { createHeader } from "./components/Header";
import { createPermissionDialog } from "./components/PermissionDialog";
import { createHomeView } from "./views/HomeView";
import { streamSession } from "../core/session/stream";
import { parsePlan } from "../core/session/parser";
import { runSession } from "../core/session";
import { listPending, addPending } from "../core/governance/pending";
import { addRule } from "../core/policy";
import { resolvePending } from "../core/governance/pending";
import { getProviders } from "../core/providers";
import { Step } from "../core/tools/schema";

// Parse arguments
const args = process.argv.slice(2);
let promptArg = "";
let viewMode = "session"; // "home" or "session"

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--home") {
    viewMode = "home";
  } else if (!args[i].startsWith("--")) {
    promptArg = args.slice(i).join(" ");
    break;
  }
}

// Initialize state
const state: TUIState = createInitialState();
if (promptArg) {
  state.currentPrompt = promptArg;
}

// Create screen
const screen = blessed.screen({
  smartCSR: true,
  title: "DAX - Deterministic AI Execution",
  dump: process.env.DAX_TUI_DUMP,
});

// Create components
const { box: messageBox, render: renderMessages } = createMessageList(screen);
const { box: promptBox, clear: clearPrompt } = createPromptInput(screen, handlePromptSubmit);
const { header, setStatus } = createHeader(screen);
const { show: showPermission, hide: hidePermission } = createPermissionDialog(
  screen,
  handleApprove,
  handleDeny
);
const { show: showHome, hide: hideHome } = createHomeView(screen);

// Set initial view
if (viewMode === "home") {
  state.view = "home";
  messageBox.hide();
  promptBox.hide();
  showHome();
} else {
  state.view = "session";
  renderMessages(state.messages);
}

// Handle key presses
screen.key(["q", "C-c"], () => {
  return process.exit(0);
});

screen.key(["h"], () => {
  if (state.view === "home") {
    state.view = "session";
    showHome(); // Toggle logic would go here
  } else {
    state.view = "home";
    hideHome();
  }
});

screen.key(["a"], () => {
  if (state.pendingApproval) {
    handleApprove(false);
  }
});

screen.key(["A"], () => {
  if (state.pendingApproval) {
    handleApprove(true);
  }
});

screen.key(["d"], () => {
  if (state.pendingApproval) {
    handleDeny();
  }
});

screen.key(["r"], async () => {
  if (state.currentPlan) {
    await executePlan();
  }
});

// Render loop
screen.render();

// Auto-start if prompt provided
if (promptArg && state.view === "session") {
  await handlePromptSubmit(promptArg);
}

async function handlePromptSubmit(prompt: string) {
  const userMessage: Message = {
    id: Date.now().toString(36),
    role: "user",
    content: prompt,
    timestamp: new Date().toISOString(),
  };
  state.messages.push(userMessage);
  renderMessages(state.messages);
  clearPrompt();

  setStatus("Streaming...");
  state.isStreaming = true;

  let fullResponse = "";
  let thinking = "";
  let currentPlan: Step[] | null = null;

  try {
    for await (const chunk of streamSession({
      projectDir: process.cwd(),
      prompt,
    })) {
      if (chunk.type === "thinking") {
        thinking += chunk.delta;
      } else if (chunk.type === "text") {
        fullResponse += chunk.delta;
        
        // Update the last assistant message or create new one
        const lastMsg = state.messages[state.messages.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          lastMsg.content = fullResponse;
        } else {
          state.messages.push({
            id: Date.now().toString(36),
            role: "assistant",
            content: fullResponse,
            timestamp: new Date().toISOString(),
          });
        }
        renderMessages(state.messages);
      } else if (chunk.type === "done") {
        // Try to parse a plan from the response
        currentPlan = parsePlan(fullResponse);
        if (currentPlan) {
          state.currentPlan = currentPlan;
          setStatus("Plan ready! Press [r] to execute, [a] to approve.");
        } else {
          setStatus("Done.");
        }
        state.isStreaming = false;
        renderMessages(state.messages);
      } else if (chunk.type === "error") {
        const errorMsg: Message = {
          id: Date.now().toString(36),
          role: "assistant",
          content: `Error: ${chunk.error}`,
          timestamp: new Date().toISOString(),
        };
        state.messages.push(errorMsg);
        renderMessages(state.messages);
        setStatus("Error occurred.");
        state.isStreaming = false;
      }
    }
  } catch (err: any) {
    setStatus(`Error: ${err.message}`);
    state.isStreaming = false;
  }
}

async function handleApprove(always: boolean) {
  if (!state.pendingApproval) return;

  const { permission, pattern } = state.pendingApproval;
  
  if (always) {
    addRule(process.cwd(), { permission, pattern, action: "allow" });
  }
  
  // Remove from pending
  const pending = listPending(process.cwd());
  const item = pending.find(p => p.permission === permission && p.pattern === pattern);
  if (item) {
    resolvePending(process.cwd(), item.id);
  }

  hidePermission();
  setStatus("Approved.");
  
  // Re-execute plan if we were waiting
  if (state.currentPlan) {
    await executePlan();
  }
}

function handleDeny() {
  if (!state.pendingApproval) return;
  
  const { permission } = state.pendingApproval;
  const pending = listPending(process.cwd());
  const item = pending.find(p => p.permission === permission);
  if (item) {
    resolvePending(process.cwd(), item.id);
  }

  hidePermission();
  setStatus("Denied.");
}

async function executePlan() {
  if (!state.currentPlan) return;

  setStatus("Executing plan...");
  state.isExecuting = true;

  const result = await runSession({
    projectDir: process.cwd(),
    plan: state.currentPlan,
  });

  if (result.status === "ok") {
    setStatus("Execution successful!");
    
    // Add result messages
    if (result.results) {
      for (const r of result.results) {
        state.messages.push({
          id: Date.now().toString(36),
          role: "tool",
          content: JSON.stringify(r.result, null, 2),
          timestamp: new Date().toISOString(),
          toolName: r.step,
        });
      }
    }
  } else {
    setStatus(`Execution failed: ${(result as any).error}`);
  }

  state.currentPlan = null;
  state.isExecuting = false;
  renderMessages(state.messages);
}
