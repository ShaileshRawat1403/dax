import { join } from "node:path";
import { readJson, writeJson } from "../storage/json";

export interface PendingItem {
  id: string;
  ts: string;
  permission: string;
  pattern: string;
  reason: string;
}

interface PendingStore {
  pending: PendingItem[];
}

function pendingPath(projectDir: string): string {
  return join(projectDir, ".dax", "approvals.json");
}

export function listPending(projectDir: string): PendingItem[] {
  const store = readJson<PendingStore>(pendingPath(projectDir), { pending: [] });
  return store.pending;
}

export function addPending(projectDir: string, item: PendingItem): PendingItem {
  const current = readJson<PendingStore>(pendingPath(projectDir), { pending: [] });
  const next: PendingStore = { ...current, pending: [item, ...current.pending] };
  writeJson(pendingPath(projectDir), next);
  return item;
}

export function resolvePending(projectDir: string, id: string): PendingStore {
  const current = readJson<PendingStore>(pendingPath(projectDir), { pending: [] });
  const next: PendingStore = {
    ...current,
    pending: current.pending.filter((p) => p.id !== id),
  };
  writeJson(pendingPath(projectDir), next);
  return next;
}
