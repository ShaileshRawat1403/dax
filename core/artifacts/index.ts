import { join } from "node:path";
import { readJson, writeJson } from "../storage/json";

// Base interface for all artifacts
interface ArtifactBase {
  id: string;
  ts: string;
}

// Specific artifact types
export interface WriteArtifact extends ArtifactBase {
  type: "write";
  path: string;
  before: string;
  after: string;
}

export interface ExecArtifact extends ArtifactBase {
  type: "exec";
  command: string;
  output: string;
  exitCode: number;
}

// A union of all possible artifact types
export type Artifact = WriteArtifact | ExecArtifact;

// The data required to create a new artifact record
export type ArtifactEntry =
  | Omit<WriteArtifact, keyof ArtifactBase>
  | Omit<ExecArtifact, keyof ArtifactBase>;

// The shape of the artifacts.json file
interface ArtifactStore {
  items: Artifact[];
}

function artifactsPath(projectDir: string): string {
  return join(projectDir, ".dax", "artifacts.json");
}

export function recordArtifact(
  projectDir: string,
  entry: ArtifactEntry,
): Artifact {
  const path = artifactsPath(projectDir);
  const current = readJson<ArtifactStore>(path, { items: [] });

  const row: Artifact = {
    id: Date.now().toString(36),
    ts: new Date().toISOString(),
    ...entry,
  } as Artifact;

  const next: ArtifactStore = { ...current, items: [row, ...current.items] };
  writeJson(path, next);
  return row;
}

export function listArtifacts(projectDir: string, limit = 20): Artifact[] {
  const path = artifactsPath(projectDir);
  const data = readJson<ArtifactStore>(path, { items: [] });
  return data.items.slice(0, limit);
}
