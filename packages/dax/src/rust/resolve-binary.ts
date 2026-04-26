import path from "path"
import { existsSync } from "fs"

// packages/dax/dist/bin/ — populated by the build script for release builds
const DIST_BIN = path.resolve(import.meta.dir, "../../../dist/bin")

/**
 * Resolve the argv prefix for a Rust sidecar binary.
 *
 * Resolution order:
 *  1. DAX_RUST_BIN_DIR env var (absolute path to a directory of pre-built binaries).
 *  2. packages/dax/dist/bin/<binaryName>  (populated by build script in release builds).
 *  3. cargo run -q -p <crateName>-bin --  (development fallback; requires Rust toolchain).
 *
 * The returned array is an argv prefix — append the command name before spawning.
 */
export function resolveRustBinary(crateName: string, binaryName: string): string[] {
  const binDir = process.env.DAX_RUST_BIN_DIR
  if (binDir) {
    return [path.join(binDir, binaryName)]
  }

  const bundled = path.join(DIST_BIN, binaryName)
  if (existsSync(bundled)) {
    return [bundled]
  }

  return ["cargo", "run", "-q", "-p", `${crateName}-bin`, "--"]
}
