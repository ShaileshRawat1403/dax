export const INTENT_MODE = ["normal", "eli12"] as const;
export type IntentMode = (typeof INTENT_MODE)[number];

export function parseIntentMode(value: string): IntentMode {
  return value === "eli12" ? "eli12" : "normal";
}

export function isEli12Mode(value: string): boolean {
  return parseIntentMode(value) === "eli12";
}

export function nextIntentMode(value: string): IntentMode {
  return isEli12Mode(value) ? "normal" : "eli12";
}
