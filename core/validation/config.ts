import { DaxConfig, ProviderConfigEntry } from "../storage/config";

/**
 * Validates the structure of the DAX configuration object.
 * @param cfg The config object to validate.
 * @returns An error message string if invalid, otherwise null.
 */
export function validateConfig(cfg: any): string | null {
  if (!cfg || typeof cfg !== "object") {
    return "Config must be an object.";
  }

  if (cfg.providers && !Array.isArray(cfg.providers)) {
    return "Config 'providers' must be an array.";
  }

  if (Array.isArray(cfg.providers)) {
    for (const p of cfg.providers as ProviderConfigEntry[]) {
      if (typeof p === "string") {
        continue;
      }
      if (typeof p !== "object" || p === null) {
        return "Provider entries in the 'providers' array must be a string or an object.";
      }
      if (!p.id || typeof p.id !== "string") {
        return "Each provider object in the 'providers' array must have an 'id' string property.";
      }
      if (p.model && typeof p.model !== "string") {
        return `Provider '${p.id}' has an invalid 'model' property; it must be a string.`;
      }
      if (p.baseURL && typeof p.baseURL !== "string") {
        return `Provider '${p.id}' has an invalid 'baseURL' property; it must be a string.`;
      }
    }
  }

  if (
    cfg.models &&
    (typeof cfg.models !== "object" || Array.isArray(cfg.models))
  ) {
    return "Config 'models' must be an object (key-value map).";
  }

  if (
    cfg.baseUrls &&
    (typeof cfg.baseUrls !== "object" || Array.isArray(cfg.baseUrls))
  ) {
    return "Config 'baseUrls' must be an object (key-value map).";
  }

  return null;
}
