// Single implementation lives in the shared package. This module stays as a
// re-export so the existing import paths keep working; it used to be a second,
// diverged copy - it had grown `reset()` while the shared one had not, and both
// were imported from inside this package.
export { lazy } from "@dax-ai/util/lazy"
