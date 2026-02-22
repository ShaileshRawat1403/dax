export interface ThinkingChunk {
  type: "thinking";
  delta: string;
}

export interface TextChunk {
  type: "text";
  delta: string;
}

export interface MetricsChunk {
  type: "metrics";
  data: any;
}

export interface DoneChunk {
  type: "done";
  data: any;
}

export interface ErrorChunk {
  type: "error";
  error: any;
}

export type StreamChunk =
  | ThinkingChunk
  | TextChunk
  | MetricsChunk
  | DoneChunk
  | ErrorChunk;

export interface StreamInput {
  prompt: string;
  context?: any;
}

export interface Provider {
  id: string;
  stream: (input: StreamInput) => AsyncGenerator<StreamChunk>;
  sdk?: any; // To hold the underlying AI SDK provider object
}
