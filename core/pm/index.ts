import { join } from "node:path";
import { readJson, writeJson } from "../storage/json";

export interface Note {
  id: string;
  ts: string;
  text: string;
  tags: string[];
  author: string | null;
  source: string;
}

// The input for creating a new note
export type NewNote = Pick<Note, "text"> &
  Partial<Omit<Note, "id" | "ts" | "text">>;

interface NoteStore {
  notes: Note[];
}

function pmPath(projectDir: string): string {
  return join(projectDir, ".dax", "pm.json");
}

export function addNote(projectDir: string, note: NewNote): Note {
  const current = readJson<NoteStore>(pmPath(projectDir), { notes: [] });
  const row: Note = {
    id: Date.now().toString(36),
    ts: new Date().toISOString(),
    text: note.text,
    tags: note.tags || [],
    author: note.author || null,
    source: note.source || "user",
  };
  const next: NoteStore = { ...current, notes: [row, ...current.notes] };
  writeJson(pmPath(projectDir), next);
  return row;
}

export function listNotes(projectDir: string, limit = 20): Note[] {
  const current = readJson<NoteStore>(pmPath(projectDir), { notes: [] });
  return current.notes.slice(0, limit);
}

export function searchNotes(projectDir: string, query: string): Note[] {
  const current = readJson<NoteStore>(pmPath(projectDir), { notes: [] });
  const q = query.toLowerCase();
  return current.notes.filter((n) => n.text.toLowerCase().includes(q));
}

export function filterByTags(projectDir: string, tags: string[]): Note[] {
  const current = readJson<NoteStore>(pmPath(projectDir), { notes: [] });
  const set = new Set(tags);
  return current.notes.filter((n) => n.tags.some((t) => set.has(t)));
}

export function removeNote(projectDir: string, id: string): NoteStore {
  const current = readJson<NoteStore>(pmPath(projectDir), { notes: [] });
  const next = { ...current, notes: current.notes.filter((n) => n.id !== id) };
  writeJson(pmPath(projectDir), next);
  return next;
}

export function exportNotes(projectDir: string): NoteStore {
  const current = readJson<NoteStore>(pmPath(projectDir), { notes: [] });
  return current;
}
