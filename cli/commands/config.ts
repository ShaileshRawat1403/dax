import {
  loadConfig,
  saveConfig,
  ProviderConfigEntry,
} from "../../core/storage/config";

export function runConfig(args: string[], cwd: string): void {
  const sub = args[0];
  if (!sub || sub === "show") {
    console.log(JSON.stringify(loadConfig(cwd), null, 2));
    return;
  }
  if (sub === "add-provider") {
    const name = args[1];
    const model = args.find((a) => a.startsWith("--model="))?.split("=")[1];
    const baseURL = args.find((a) => a.startsWith("--base="))?.split("=")[1];
    if (!name) {
      console.error(
        "Usage: dax config add-provider <name> [--model=...] [--base=...]",
      );
      process.exit(1);
    }
    const cfg = loadConfig(cwd);
    const entry: ProviderConfigEntry =
      model || baseURL ? { id: name, model, baseURL } : name;
    const list = [...(cfg.providers || []), entry];
    saveConfig(cwd, { ...cfg, providers: list });
    console.log(JSON.stringify(loadConfig(cwd), null, 2));
    return;
  }
  if (sub === "remove-provider") {
    const name = args[1];
    if (!name) {
      console.error("Usage: dax config remove-provider <name>");
      process.exit(1);
    }
    const cfg = loadConfig(cwd);
    const next = {
      ...cfg,
      providers: (cfg.providers || []).filter((p) =>
        typeof p === "string" ? p !== name : p.id !== name,
      ),
    };
    saveConfig(cwd, next);
    console.log(JSON.stringify(next, null, 2));
    return;
  }
  console.error(
    "Usage: dax config [show] | dax config add-provider <name> [--model=...] [--base=...] | dax config remove-provider <name>",
  );
  process.exit(1);
}
