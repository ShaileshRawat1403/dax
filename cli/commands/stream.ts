import { streamSession } from "../../core/session/stream";

export async function runStream(args: string[], cwd: string): Promise<void> {
  const prompt = args.join(" ") || "hello";
  for await (const chunk of streamSession({ projectDir: cwd, prompt })) {
    if (chunk.type === "thinking") {
      // process.stdout.write(chunk.delta); // Often too noisy for CLI
    } else if (chunk.type === "text") {
      process.stdout.write(chunk.delta);
    } else if (chunk.type === "done") {
      process.stdout.write("\n");
    }
  }
}
