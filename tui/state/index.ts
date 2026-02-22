export type View = "home" | "session" | "settings";

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
  toolName?: string;
  toolResult?: string;
}

export interface TUIState {
  view: View;
  messages: Message[];
  isStreaming: boolean;
  currentPrompt: string;
  pendingApproval: {
    permission: string;
    pattern: string;
    reason: string;
    toolParams: any;
  } | null;
  currentPlan: any | null;
  isExecuting: boolean;
  sessions: { id: string; summary: string; ts: string }[];
}

export function createInitialState(): TUIState {
  return {
    view: "home",
    messages: [],
    isStreaming: false,
    currentPrompt: "",
    pendingApproval: null,
    currentPlan: null,
    isExecuting: false,
    sessions: [],
  };
}
