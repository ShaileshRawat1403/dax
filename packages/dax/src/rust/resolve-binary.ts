import path from "path"
import { existsSync } from "fs"

/**
 * Resolve the argv prefix for a Rust sidecar binary.
 *
 * Resolution order:
 *  1. DAX_RUST_BIN_DIR env var (absolute path to a directory of pre-built binaries).
 *  2. Executable-adjacent lookup: sidecars live next to the dax binary in release builds.
 *  3. cargo run -q -p <crateName>-bin --  (development fallback; requires Rust toolchain).
 *
 * The returned array is an argv prefix — append the command name before spawning.
 */
export function resolveRustBinary(crateName: string, binaryName: string): string[] {
  const ext = process.platform === "win32" ? ".exe" : ""

  const binDir = process.env.DAX_RUST_BIN_DIR
  if (binDir) {
    return [path.join(binDir, `${binaryName}${ext}`)]
  }

  // In compiled release builds, process.execPath is the dax binary itself;
  // sidecars live in the same directory. In dev (bun script), process.execPath
  // is the bun runtime — no sidecars there, so existsSync returns false.
  const exeAdjacent = path.join(path.dirname(process.execPath), `${binaryName}${ext}`)
  if (existsSync(exeAdjacent)) {
    return [exeAdjacent]
  }

  return ["cargo", "run", "-q", "-p", `${crateName}-bin`, "--"]
}
