import { verifyLedger } from "../../core/ledger";

export function runVerifyLedger(args: string[], cwd: string): void {
  const result = verifyLedger(cwd);
  console.log(JSON.stringify(result, null, 2));
}
