/**
 * Sensitive-path gates applied to every file-discovery / file-content
 * operation by default. Mirrors github.com/github/gitignore Node.gitignore
 * `.env` patterns plus broader secret markers. Allowed exceptions:
 * `.env.example` (commonly committed as a template).
 *
 * Each tool that consumes path-relevant input passes that input into
 * ctx.ask's `patterns` array so these rules actually fire. The set covers
 * existence-leak (glob/list), content-leak (grep/read), and content-egress
 * (webfetch/codesearch/websearch) vectors uniformly.
 *
 * This module deliberately has no dependencies so security rules can be read
 * during module initialization without coupling callers to the Agent module's
 * larger dependency graph.
 */
export const SENSITIVE_PATH_RULES = {
  "*": "allow",
  "*.env": "ask",
  "*.env.*": "ask",
  "*.env.example": "allow",
  "*secrets*": "ask",
  "*credentials*": "ask",
  "*/id_rsa": "ask",
  "*/id_ed25519": "ask",
  "*/id_ecdsa": "ask",
  "*.pem": "ask",
  "*.key": "ask",
  "*.p12": "ask",
  "*.pfx": "ask",
} as const
