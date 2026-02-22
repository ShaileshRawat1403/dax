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
import { listPending } from "../core/governance/pending";
import { addRule } from "../core/policy";
import { resolvePending } from "../core/governance/pending";
import { loadConfig, saveConfig } from "../core/storage/config";
import { Step } from "../core/tools/schema";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Check for API key and prompt setup if missing
function checkApiKey(): boolean {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey.startsWith("sk-")) return true;
  
  // Also check config file
  const config = loadConfig(process.cwd());
  const provider = config.providers?.find(p => 
    typeof p === "object" && p.id === "openai" && p.apiKey
  );
  if (provider && typeof provider === "object" && provider.apiKey) return true;
  
  return false;
}

function showSetupWizard(screen: any, onComplete: () => void) {
  const overlay = blessed.box({
    top: "center",
    left: "center",
    width: 70,
    height: 15,
    border: { type: "line", fg: "cyan" } as any,
    style: { fg: "white", bg: "black" },
  });
  
  const content = blessed.box({ width: "100%", height: "100%" });
  overlay.append(content);
  screen.append(overlay);
  
  content.setContent(`
{bold}{cyan}Welcome to DAX!{/cyan}{/bold}

It looks like you haven't configured an AI provider yet.

To get started, you'll need an OpenAI API key.

{bold}Option 1:{/bold} Set environment variable
  export OPENAI_API_KEY="sk-your-key-here"

{bold}Option 2:{/bold} Configure in .dax/config.json
  Add your provider there.

{bold}Quick setup:{/bold} Enter your API key now, or press 'q' to quit.

Your API Key: `);
  
  const input = blessed.textbox({
    bottom: 1,
    left: 3,
    width: "90%",
    height: 3,
    style: { fg: "yellow", bg: "black" },
    inputOnFocus: true,
  });
  overlay.append(input);
  
  screen.render();
  input.focus();
  
  input.on("submit", (value: string) => {
    const key = value.trim();
    if (key.startsWith("sk-")) {
      // Save to config
      const configPath = join(process.cwd(), ".dax", "config.json");
      const config = loadConfig(process.cwd());
      const providers = config.providers || [];
      
      // Add or update openai provider
      const hasOpenAI = providers.some(p => 
        typeof p === "object" && p.id === "openai"
      );
      
      if (hasOpenAI) {
        const updated = providers.map(p => 
          typeof p === "object" && p.id === "openai" 
            ? { ...p, apiKey: key }
            : p
        );
        saveConfig(process.cwd(), { ...config, providers: updated });
      } else {
        saveConfig(process.cwd(), { 
          ...config, 
          providers: [...providers, { id: "openai", apiKey: key }] 
        });
      }
      
      overlay.destroy();
      screen.render();
      onComplete();
    }
  });
  
  screen.key(["q", "C-c"], () => process.exit(0));
}

// Parse arguments
const args = process.argv.slice(2);

// Initialize state
const state: TUIState = createInitialState();

// Create screen
const screen = blessed.screen({
  smartCSR: true,
  title: "DAX - Deterministic AI Execution",
  dockBorders: true,
  autoPadding: true,
});

// Create components
const { box: messageBox, render: renderMessages } = createMessageList(screen);
const { box: promptBox, clear: clearPrompt } = createPromptInput(screen, handlePromptSubmit);
const { setStatus } = createHeader(screen);
const { show: showPermission, hide: hidePermission } = createPermissionDialog(
  screen,
  handleApprove,
  handleDeny
);
const { show: showHome, hide: hideHome } = createHomeView(screen);

// Add welcome message
function showWelcome() {
  const welcomeMessage: Message = {
    id: "welcome",
    role: "assistant",
    content: `Welcome to DAX!

I'm ready to help you with:
• Writing and reading files
• Running shell commands
• Searching code
• And more...

Just type your request above and press Enter to start.`,
    timestamp: new Date().toISOString(),
  };
  state.messages.push(welcomeMessage);
  renderMessages(state.messages);
}

// Set initial view - check for API key first
if (!checkApiKey()) {
  showSetupWizard(screen, () => {
    // After setup, start normally
    state.view = "session";
    showWelcome();
    setStatus("Ready. Type a message and press Enter to start.");
    screen.render();
    promptBox.focus();
  });
} else {
  state.view = "session";
  showWelcome();
  setStatus("Ready. Type a message and press Enter to start.");
  screen.render();
  promptBox.focus();
}

// Handle key presses
screen.key(["q", "C-c"], () => process.exit(0));

screen.key(["h"], () => {
  if (state.view === "session") {
    state.view = "home";
    messageBox.hide();
    promptBox.hide();
    showHome();
  } else {
    state.view = "session";
    hideHome();
    messageBox.show();
    promptBox.show();
    promptBox.focus();
    screen.render();
  }
});

screen.key(["a"], () => {
  if (state.pendingApproval) handleApprove(false);
});

screen.key(["A"], () => {
  if (state.pendingApproval) handleApprove(true);
});

screen.key(["d"], () => {
  if (state.pendingApproval) handleDeny();
});

screen.key(["r"], async () => {
  if (state.currentPlan) await executePlan();
});

async function handlePromptSubmit(prompt: string) {
  if (!prompt.trim()) return;

  const userMessage: Message = {
    id: Date.now().toString(36),
    role: "user",
    content: prompt,
    timestamp: new Date().toISOString(),
  };
  state.messages.push(userMessage);
  renderMessages(state.messages);
  clearPrompt();

  setStatus("Thinking...");
  
  const conversationHistory = state.messages
    .filter(m => m.role !== "tool" && m.id !== "welcome")
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  let fullResponse = "";
  let currentPlan: Step[] | null = null;

  try {
    const contextPrompt = conversationHistory 
      ? `${conversationHistory}\n\nUser: ${prompt}`
      : prompt;

    for await (const chunk of streamSession({
      projectDir: process.cwd(),
      prompt: contextPrompt,
    })) {
      if (chunk.type === "text") {
        fullResponse += chunk.delta;
        
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
        currentPlan = parsePlan(fullResponse);
        if (currentPlan) {
          state.currentPlan = currentPlan;
          setStatus("Plan ready! Press [r] to execute.");
        } else {
          setStatus("Done. Type another message to continue.");
        }
        renderMessages(state.messages);
        promptBox.focus();
        screen.render();
      } else if (chunk.type === "error") {
        // Handle API key errors specifically
        const errorMsg = chunk.error;
        let userFriendlyMessage = errorMsg;
        
        if (errorMsg.includes("API key is missing") || errorMsg.includes("OPENAI_API_KEY")) {
          userFriendlyMessage = `API Key Error: ${errorMsg}

To fix this, either:
1. Set the environment variable: export OPENAI_API_KEY="sk-..."
2. Or restart DAX and enter your key when prompted.`;
        }
        
        state.messages.push({
          id: Date.now().toString(36),
          role: "assistant",
          content: userFriendlyMessage,
          timestamp: new Date().toISOString(),
        });
        renderMessages(state.messages);
        setStatus("Error. Check the message above.");
        promptBox.focus();
        screen.render();
      }
    }
  } catch (err: any) {
    // Handle connection errors
    let errorMessage = err.message;
    
    if (errorMessage.includes("API key") || errorMessage.includes("OPENAI_API_KEY")) {
      errorMessage = `Connection Error: Could not authenticate with OpenAI.

Your API key may be invalid or missing.
Please check your configuration and try again.`;
    } else if (errorMessage.includes("fetch") || errorMessage.includes("network")) {
      errorMessage = `Network Error: Could not connect to OpenAI.

Please check your internet connection and try again.`;
    }
    
    state.messages.push({
      id: Date.now().toString(36),
      role: "assistant",
      content: errorMessage,
      timestamp: new Date().toISOString(),
    });
    renderMessages(state.messages);
    setStatus("Error. Check the message above.");
    promptBox.focus();
    screen.render();
  }
}

async function handleApprove(always: boolean) {
  if (!state.pendingApproval) return;
  const { permission, pattern } = state.pendingApproval;
  
  if (always) {
    addRule(process.cwd(), { permission, pattern, action: "allow" });
  }
  
  const pending = listPending(process.cwd());
  const item = pending.find(p => p.permission === permission && p.pattern === pattern);
  if (item) resolvePending(process.cwd(), item.id);

  hidePermission();
  setStatus("Approved.");
  
  if (state.currentPlan) await executePlan();
}

function handleDeny() {
  if (!state.pendingApproval) return;
  const { permission } = state.pendingApproval;
  const pending = listPending(process.cwd());
  const item = pending.find(p => p.permission === permission);
  if (item) resolvePending(process.cwd(), item.id);

  hidePermission();
  setStatus("Denied.");
}

async function executePlan() {
  if (!state.currentPlan) return;

  setStatus("Executing plan...");
  const result = await runSession({
    projectDir: process.cwd(),
    plan: state.currentPlan,
  });

  if (result.status === "ok") {
    setStatus("Execution successful! Continue the conversation.");
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
  renderMessages(state.messages);
  promptBox.focus();
  screen.render();
}
