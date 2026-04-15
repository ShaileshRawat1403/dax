import { describe, expect, test } from "bun:test"
import { Sandbox } from "./sandbox"

// Tests for the pure buildDockerCommand helper — no I/O, no Config dependency.

describe("Sandbox.buildDockerCommand", () => {
  test("produces a docker run command with the correct image and workspace mount", () => {
    const result = Sandbox.buildDockerCommand("echo hello", "/home/user/project", "node:20")
    expect(result).toContain("docker run")
    expect(result).toContain("--rm")
    expect(result).toContain("/workspace:rw")
    expect(result).toContain("-w /workspace")
    expect(result).toContain("node:20")
    expect(result).toContain("sh -c")
    expect(result).toContain("echo hello")
  })

  test("bind-mounts cwd as /workspace", () => {
    const result = Sandbox.buildDockerCommand("ls", "/my/project", "alpine")
    expect(result).toContain('"/my/project":/workspace:rw')
  })

  test("escapes double quotes in cwd for docker -v flag", () => {
    const result = Sandbox.buildDockerCommand("ls", '/path/with"quote', "alpine")
    expect(result).toContain('"/path/with\\"quote":/workspace:rw')
    // Must not contain a raw unescaped double-quote inside the bind mount token
    const mountToken = result.match(/-v\s+"([^"]+)":/)?.[1] ?? ""
    expect(mountToken).not.toContain('"')
  })

  test("escapes single quotes in the shell command via the POSIX '\\'' technique", () => {
    const result = Sandbox.buildDockerCommand("echo 'hello world'", "/project", "alpine")
    // The sh -c argument should have the embedded single-quote escaped
    expect(result).toContain("'\\''")
    expect(result).not.toMatch(/sh -c ''[^']/)
  })

  test("handles commands with special characters that should not break the shell -c argument", () => {
    const cmd = 'grep -r "pattern" . && echo "done"'
    const result = Sandbox.buildDockerCommand(cmd, "/workspace", "ubuntu:22.04")
    expect(result).toContain("ubuntu:22.04")
    expect(result).toContain("sh -c")
    // Command content should appear inside the single-quoted sh -c argument
    expect(result).toContain("grep")
    expect(result).toContain("echo")
  })

  test("wraps a complex multi-step command without losing content", () => {
    const cmd = "npm install && npm run build && npm test"
    const result = Sandbox.buildDockerCommand(cmd, "/app", "node:20-alpine")
    expect(result).toContain("npm install")
    expect(result).toContain("npm run build")
    expect(result).toContain("npm test")
  })

  test("handles cwd paths with spaces via double-quote escaping", () => {
    const result = Sandbox.buildDockerCommand("make", "/Users/dev/my project", "alpine")
    // Path with space must be double-quoted in the docker -v flag
    expect(result).toContain('"/Users/dev/my project":/workspace:rw')
  })

  test("uses the exact image string passed — no normalisation", () => {
    const result = Sandbox.buildDockerCommand("node -e 'console.log(1)'", "/code", "gcr.io/company/runner:sha-abc123")
    expect(result).toContain("gcr.io/company/runner:sha-abc123")
  })
})

// Note: Sandbox.wrap() is an I/O-adjacent orchestrator that reads Config (which requires
// Instance initialization). It is covered by integration tests in the session-execution suite.
// Unit coverage for the command-building logic is provided by buildDockerCommand above.
