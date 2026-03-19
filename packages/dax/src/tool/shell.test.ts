import { describe, expect, test } from "bun:test"
import { shellHasOpaquePathEffects, shellPathCandidates } from "./shell-approval"

describe("shell approval analysis", () => {
  test("extracts redirected output targets as path candidates", () => {
    expect(shellPathCandidates('echo "hi" > ../tmp/out.txt', ["echo", '"hi"'])).toContain("../tmp/out.txt")
  })

  test("treats interpreter eval flows as opaque path effects", () => {
    expect(shellHasOpaquePathEffects('python -c "open(\'/tmp/x\', \'w\')"', ["python", "-c"])).toBe(true)
    expect(shellHasOpaquePathEffects("node -e \"console.log('x')\"", ["node", "-e"])).toBe(true)
  })

  test("collects path-like args for opaque file mutation commands", () => {
    expect(shellPathCandidates("sed -i ../tmp/file.txt", ["sed", "-i", "../tmp/file.txt"])).toContain("../tmp/file.txt")
    expect(shellPathCandidates("tee ./out.log", ["tee", "./out.log"])).toContain("./out.log")
  })
})
