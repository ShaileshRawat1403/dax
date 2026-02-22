import { recordEvent } from "../ledger";
import { getProviders } from "../providers";
import { listNotes } from "../pm";
import { StreamChunk } from "../providers/types";

interface StreamSessionParams {
  projectDir: string;
  prompt: string;
}

export async function* streamSession({
  projectDir,
  prompt,
}: StreamSessionParams): AsyncGenerator<StreamChunk> {
  const providers = getProviders(projectDir);
  const provider = providers[0];
  const notes = listNotes(projectDir, 5);

  recordEvent(projectDir, {
    type: "run",
    payload: { prompt, provider: provider?.id || "stub" },
  });

  if (!provider) {
    recordEvent(projectDir, {
      type: "audit",
      payload: { action: "error", error: "no_provider" },
    });
    yield { type: "text", delta: "No provider configured." };
    yield { type: "done", data: null };
    return;
  }

  let thinking = "";
  let text = "";
  let metrics: any = null;

  for await (const chunk of provider.stream({ prompt, context: { notes } })) {
    if (chunk.type === "thinking") {
      thinking += chunk.delta;
    } else if (chunk.type === "text") {
      text += chunk.delta;
    } else if (chunk.type === "metrics") {
      metrics = chunk.data;
    }
    yield chunk;
  }

  // Record the completion of the "Run" phase
  recordEvent(projectDir, {
    type: "run_complete",
    payload: { thinking, text, metrics },
  });

  yield { type: "done", data: { thinking, text, metrics } };
}
