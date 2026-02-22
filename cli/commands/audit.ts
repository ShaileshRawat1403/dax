import { readEvents } from "../../core/ledger";

export function runAudit(args: string[], cwd: string): void {
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 50;
  const events = readEvents(cwd, Number.isFinite(limit) ? limit : 50);
  for (const e of events) {
    const payload = e.payload ? JSON.stringify(e.payload) : "";
    console.log(`${e.ts} ${e.type || "event"} ${payload}`);
  }
}
