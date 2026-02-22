import { join } from "node:path";
import { readJson, writeJson } from "../storage/json";
import { Step } from "../tools/schema";

export interface Session {
  id: string;
  ts: string;
  plan: Step[];
  status: "running" | "pending" | "error" | "denied" | "ok";
  results: {
    step: string;
    status: "success";
    result: any;
  }[];
  error?: string;
}

interface SessionStore {
  sessions: Session[];
}

function sessionsPath(projectDir: string): string {
  return join(projectDir, ".dax", "sessions.json");
}

export function listSessions(projectDir: string): Session[] {
  const store = readJson<SessionStore>(sessionsPath(projectDir), {
    sessions: [],
  });
  return store.sessions;
}

export function saveSession(projectDir: string, session: Session): Session {
  const current = readJson<SessionStore>(sessionsPath(projectDir), {
    sessions: [],
  });

  // Avoid saving duplicate sessions by checking the ID
  const existingIndex = current.sessions.findIndex((s) => s.id === session.id);
  if (existingIndex !== -1) {
    // If found, replace the existing session
    current.sessions[existingIndex] = session;
  } else {
    // If not found, add it to the beginning
    current.sessions.unshift(session);
  }

  writeJson(sessionsPath(projectDir), current);
  return session;
}
