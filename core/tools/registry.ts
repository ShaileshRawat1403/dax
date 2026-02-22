
export type Tool = (params: { projectDir: string; [key: string]: any }) => Promise<any>;

const registry = new Map<string, Tool>();

export function registerTool(name: string, def: Tool): void {
  if (registry.has(name)) {
    // In a real scenario, you might want to allow re-registration for hot-reloading
    // For now, we'll just log a warning instead of throwing an error.
    console.warn(`Tool already registered: ${name}. Overwriting.`);
  }
  registry.set(name, def);
}

export function listTools(): { name: string }[] {
  return Array.from(registry.keys()).map((name) => ({ name }));
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}
