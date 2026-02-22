import { readJson, writeJson } from "./json";
import { join } from "node:path";

export type ProviderConfigEntry = string | { id: string; [key: string]: any };

export interface DaxConfig {
  providers: ProviderConfigEntry[];
  models: Record<string, any>;
  baseUrls: Record<string, string>;
}

const DEFAULT_CONFIG: DaxConfig = {
  providers: ["openai"],
  models: {},
  baseUrls: {},
};

function configPath(projectDir: string): string {
  return join(projectDir, ".dax", "config.json");
}

/**
 * Loads the DAX configuration from the project directory.
 */
export function loadConfig(projectDir: string): DaxConfig {
  return readJson<DaxConfig>(configPath(projectDir), DEFAULT_CONFIG);
}

/**
 * Saves the DAX configuration to the project directory.
 */
export function saveConfig(projectDir: string, config: DaxConfig): void {
  writeJson(configPath(projectDir), config);
}
