import { listTools } from "../../core/tools/registry";

export function runTools(): void {
  const tools = listTools();
  console.log(JSON.stringify(tools, null, 2));
}
