import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function runTui(args: string[]): void {
  const entry = join(__dirname, "../../tui/index.tsx"); // Changed to .tsx
  const child = spawn("bun", ["run", entry, ...args], { stdio: "inherit" }); // Changed to bun run
  child.on("exit", (code) => process.exit(code ?? 0));
}
