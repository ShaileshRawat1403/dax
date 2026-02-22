import { listArtifacts } from "../../core/artifacts";

export function runArtifacts(args: string[], cwd: string): void {
  const items = listArtifacts(cwd);
  console.log(JSON.stringify(items, null, 2));
}
