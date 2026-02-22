import { createProvider } from "./stub";
import {
  loadConfig,
  DaxConfig,
  ProviderConfigEntry,
} from "../storage/config";
import { createOpenAI } from "./openai";
import { createAnthropic } from "./anthropic";
import { createGoogle } from "./google";
import { createOllama } from "./ollama";
import { retryStream } from "./retry";
import { withMetrics } from "./metrics";
import { Provider, StreamInput } from "./types";

interface NormalizedProviderConfig {
  id: string;
  [key: string]: any;
}

function normalize(
  entry: ProviderConfigEntry,
  config: DaxConfig,
): NormalizedProviderConfig {
  if (typeof entry === "string") {
    return {
      id: entry,
      model: config.models?.[entry],
      baseURL: config.baseUrls?.[entry],
    };
  }
  return entry;
}

function wrap(provider: Provider): Provider {
  const originalStream = provider.stream;
  const wrapped = {
    ...provider,
    stream: (input: StreamInput) => {
      // The function passed to retryStream must be a zero-arg function
      const fn = () => originalStream(input);
      return retryStream(fn, { retries: 2, delayMs: 500 });
    },
  };
  return withMetrics(wrapped);
}

export function getProviders(projectDir: string): Provider[] {
  const cfg: DaxConfig = loadConfig(projectDir);
  const providers = (cfg.providers || []).map((p) => normalize(p, cfg));

  return providers.map((p) => {
    if (p.id === "openai") return wrap(createOpenAI(p));
    if (p.id === "anthropic") return wrap(createAnthropic(p));
    if (p.id === "google") return wrap(createGoogle(p));
    if (p.id === "ollama") return wrap(createOllama(p));
    return wrap(createProvider(p.id));
  });
}
