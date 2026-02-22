import { listSessions } from "../../core/session/store";

export function runSessions(args: string[], cwd: string): void {
  const sessions = listSessions(cwd);
  console.log(JSON.stringify(sessions, null, 2));
}
