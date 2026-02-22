import { registerTool, Tool } from "./registry";
import { readFile, writeFile, execCommand } from "./actions";

export function registerBuiltinTools(): void {
  registerTool("tool.read", readFile as Tool);
  registerTool("tool.write", writeFile as Tool);
  registerTool("tool.exec", execCommand as Tool);
}

export { readFile, writeFile, execCommand };
