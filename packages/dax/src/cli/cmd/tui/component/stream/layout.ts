/**
 * The stream's indent scale.
 *
 * Indentation was a literal at each box and had drifted to four different
 * values, so the phase rail sat one column left of everything it contained.
 * Two steps: structural elements mark the left edge, content sits inside them.
 */
export const STREAM_INDENT = {
  /** Phase rails and other grouping chrome. */
  structure: 2,
  /** Rows that belong to a phase. */
  content: 2,
} as const
