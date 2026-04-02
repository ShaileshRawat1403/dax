import { describe, test, expect } from "bun:test"
import { isWhitelistedVerificationCommand, isGenericShellEscape } from "../../src/tool/shell-whitelist"
import { VERIFICATION_SHELL_WHITELIST } from "../../src/tool/constants"

describe("shell-whitelist: isWhitelistedVerificationCommand", () => {
  describe("allowed commands", () => {
    test("npm test is allowed", () => {
      expect(isWhitelistedVerificationCommand("npm test")).toBe(true)
    })

    test("pnpm test is allowed", () => {
      expect(isWhitelistedVerificationCommand("pnpm test")).toBe(true)
    })

    test("bun test is allowed", () => {
      expect(isWhitelistedVerificationCommand("bun test")).toBe(true)
    })

    test("pytest is allowed", () => {
      expect(isWhitelistedVerificationCommand("pytest")).toBe(true)
    })

    test("cargo test is allowed", () => {
      expect(isWhitelistedVerificationCommand("cargo test")).toBe(true)
    })

    test("go test is allowed", () => {
      expect(isWhitelistedVerificationCommand("go test")).toBe(true)
    })

    test("npm test --silent is allowed", () => {
      expect(isWhitelistedVerificationCommand("npm test --silent")).toBe(true)
    })

    test("npm run test is allowed", () => {
      expect(isWhitelistedVerificationCommand("npm run test")).toBe(true)
    })

    test("cargo test --quiet is allowed", () => {
      expect(isWhitelistedVerificationCommand("cargo test --quiet")).toBe(true)
    })

    test("tsc --noEmit is allowed", () => {
      expect(isWhitelistedVerificationCommand("tsc --noEmit")).toBe(true)
    })

    test("vitest run is allowed", () => {
      expect(isWhitelistedVerificationCommand("vitest run")).toBe(true)
    })

    test("python -m pytest is allowed", () => {
      expect(isWhitelistedVerificationCommand("python -m pytest")).toBe(true)
    })

    test("go test ./... is allowed", () => {
      expect(isWhitelistedVerificationCommand("go test ./...")).toBe(true)
    })

    test("npm exec vitest run is allowed", () => {
      expect(isWhitelistedVerificationCommand("npm exec vitest run")).toBe(true)
    })

    test("pnpm exec vitest run is allowed", () => {
      expect(isWhitelistedVerificationCommand("pnpm exec vitest run")).toBe(true)
    })
  })

  describe("blocked commands", () => {
    test("node -e is blocked", () => {
      expect(isWhitelistedVerificationCommand("node -e 'console.log(1)'")).toBe(false)
    })

    test("python -c is blocked", () => {
      expect(isWhitelistedVerificationCommand("python -c 'print(1)'")).toBe(false)
    })

    test("bash -c is blocked", () => {
      expect(isWhitelistedVerificationCommand("bash -c 'ls'")).toBe(false)
    })

    test("sh -c is blocked", () => {
      expect(isWhitelistedVerificationCommand("sh -c 'ls'")).toBe(false)
    })

    test("npm install is blocked", () => {
      expect(isWhitelistedVerificationCommand("npm install")).toBe(false)
    })

    test("npm publish is blocked", () => {
      expect(isWhitelistedVerificationCommand("npm publish")).toBe(false)
    })

    test("npm exec bash -c is blocked", () => {
      expect(isWhitelistedVerificationCommand("npm exec bash -c 'ls'")).toBe(false)
    })

    test("pip install is blocked", () => {
      expect(isWhitelistedVerificationCommand("pip install pytest")).toBe(false)
    })

    test("ls is blocked", () => {
      expect(isWhitelistedVerificationCommand("ls")).toBe(false)
    })

    test("cat is blocked", () => {
      expect(isWhitelistedVerificationCommand("cat file.txt")).toBe(false)
    })

    test("rm -rf is blocked", () => {
      expect(isWhitelistedVerificationCommand("rm -rf /")).toBe(false)
    })

    test("echo is blocked", () => {
      expect(isWhitelistedVerificationCommand("echo hello")).toBe(false)
    })
  })
})

describe("shell-whitelist: isGenericShellEscape", () => {
  test("node -e is detected as escape", () => {
    expect(isGenericShellEscape("node -e 'console.log(1)'")).toBe(true)
  })

  test("python -c is detected as escape", () => {
    expect(isGenericShellEscape("python -c 'print(1)'")).toBe(true)
  })

  test("bash -c is detected as escape", () => {
    expect(isGenericShellEscape("bash -c 'ls'")).toBe(true)
  })

  test("sh -c is detected as escape", () => {
    expect(isGenericShellEscape("sh -c 'ls'")).toBe(true)
  })

  test("zsh -c is detected as escape", () => {
    expect(isGenericShellEscape("zsh -c 'ls'")).toBe(true)
  })

  test("command substitution is detected", () => {
    expect(isGenericShellEscape("$(ls)")).toBe(true)
  })

  test("pipe is detected", () => {
    expect(isGenericShellEscape("ls | grep foo")).toBe(true)
  })

  test("chain is detected", () => {
    expect(isGenericShellEscape("ls && echo done")).toBe(true)
  })

  test("output redirect is detected", () => {
    expect(isGenericShellEscape("ls > file.txt")).toBe(true)
  })

  test("npm test is NOT detected as escape", () => {
    expect(isGenericShellEscape("npm test")).toBe(false)
  })

  test("cargo test is NOT detected as escape", () => {
    expect(isGenericShellEscape("cargo test")).toBe(false)
  })
})

describe("VERIFICATION_SHELL_WHITELIST", () => {
  test("whitelist has all expected executables", () => {
    const executables = VERIFICATION_SHELL_WHITELIST.map((e: { executable: string }) => e.executable)
    expect(executables).toContain("npm")
    expect(executables).toContain("pnpm")
    expect(executables).toContain("bun")
    expect(executables).toContain("yarn")
    expect(executables).toContain("pytest")
    expect(executables).toContain("python")
    expect(executables).toContain("cargo")
    expect(executables).toContain("go")
    expect(executables).toContain("ruff")
    expect(executables).toContain("eslint")
    expect(executables).toContain("tsc")
    expect(executables).toContain("vitest")
  })
})
