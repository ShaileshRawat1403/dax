import { readFile, writeFile, execCommand } from "../../core/tools/actions";

export async function runTool(args: string[], cwd: string): Promise<void> {
  const sub = args[0];
  if (sub === "read") {
    const path = args[1];
    if (!path) {
      console.error("Usage: dax tool read <path>");
      process.exit(1);
    }
    const out = await readFile({ projectDir: cwd, path });
    process.stdout.write(out);
    return;
  }
  if (sub === "write") {
    const path = args[1];
    const content = args.slice(2).join(" ");
    if (!path) {
      console.error("Usage: dax tool write <path> <content>");
      process.exit(1);
    }
    await writeFile({ projectDir: cwd, path, content });
    console.log("ok");
    return;
  }
  if (sub === "exec") {
    const command = args.slice(1).join(" ");
    if (!command) {
      console.error("Usage: dax tool exec <command>");
      process.exit(1);
    }
    const out = await execCommand({ projectDir: cwd, command });
    process.stdout.write(out);
    return;
  }
  console.error("Usage: dax tool <read|write|exec> ...");
  process.exit(1);
}
