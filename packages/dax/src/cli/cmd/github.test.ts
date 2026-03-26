import { describe, expect, test } from "bun:test"
import { buildGitHubWorkflow, extractResponseText, gitHubActionRef, parseGitHubRemote } from "./github"

describe("github command helpers", () => {
  test("parses common GitHub remote URL formats", () => {
    expect(parseGitHubRemote("https://github.com/ShaileshRawat1403/dax-tui.git")).toEqual({
      owner: "ShaileshRawat1403",
      repo: "dax-tui",
    })
    expect(parseGitHubRemote("git@github.com:ShaileshRawat1403/dax-tui")).toEqual({
      owner: "ShaileshRawat1403",
      repo: "dax-tui",
    })
  })

  test("uses an exact release tag for published builds and main for local builds", () => {
    expect(gitHubActionRef("1.0.3")).toBe("v1.0.3")
    expect(gitHubActionRef("local")).toBe("main")
  })

  test("builds a deterministic workflow pinned to the release ref", () => {
    const workflow = buildGitHubWorkflow({
      provider: "openai",
      model: "gpt-5",
      envKeys: ["OPENAI_API_KEY"],
      actionRef: "v1.0.3",
    })

    expect(workflow).toContain("uses: ShaileshRawat1403/dax-tui/github@v1.0.3")
    expect(workflow).toContain("OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}")
    expect(workflow).toContain("model: openai/gpt-5")
    expect(workflow).not.toContain("@latest")
  })

  test("extracts the last text response when present", () => {
    expect(
      extractResponseText([
        { id: "1", type: "tool", toolCallId: "call-1", toolName: "shell", state: "output-available", input: {} } as any,
        { id: "2", type: "text", text: "final answer" } as any,
      ]),
    ).toBe("final answer")
  })

  test("returns null when only non-text parts are present", () => {
    expect(
      extractResponseText([{ id: "1", type: "tool", toolCallId: "call-1", toolName: "shell", state: "output-available", input: {} } as any]),
    ).toBeNull()
  })
})
