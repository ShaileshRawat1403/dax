export type IntentType =
  | 'explore_repo'
  | 'write_code'
  | 'fix_bug'
  | 'review_pr'
  | 'generate_docs'
  | 'general_query'
  | 'unknown';

export interface IntentContext {
  cwd: string;
  session_id?: string;
  recent_history?: string[];
}

export interface Intent {
  type: IntentType;
  raw_prompt: string;
  constraints: Record<string, string | boolean | number>;
  expected_output: 'report' | 'code' | 'patch' | 'narrative';
  context: IntentContext;
  confidence: number;
}

/**
 * Interpret a raw user prompt into a structured intent.
 * This will eventually be backed by an LLM call or a robust parser.
 */
export async function interpretIntent(prompt: string, context: IntentContext): Promise<Intent> {
  // TODO: implement actual interpretation logic
  // For now, simple heuristic routing
  let type: IntentType = 'general_query';
  if (prompt.includes('explore') || prompt.includes('read my repo')) {
    type = 'explore_repo';
  }

  return {
    type,
    raw_prompt: prompt,
    constraints: {},
    expected_output: type === 'explore_repo' ? 'report' : 'narrative',
    context,
    confidence: 0.8,
  };
}
