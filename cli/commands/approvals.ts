import { listPending } from "../../core/governance/pending";

export function runApprovals(args: string[], cwd: string): void {
  const pending = listPending(cwd);
  console.log(JSON.stringify(pending, null, 2));
}
