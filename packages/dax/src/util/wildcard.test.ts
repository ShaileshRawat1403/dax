import { describe, expect, it } from "bun:test"

import { Wildcard } from "./wildcard"

describe("Wildcard.match", () => {
  it("matches standard wildcards", () => {
    expect(Wildcard.match("hello.txt", "*.txt")).toBe(true)
    expect(Wildcard.match("hello.txt", "he??o.*")).toBe(true)
    expect(Wildcard.match("notes.md", "*.txt")).toBe(false)
  })

  it("treats trailing space-star as optional segment", () => {
    expect(Wildcard.match("ls", "ls *")).toBe(true)
    expect(Wildcard.match("ls -la", "ls *")).toBe(true)
  })
})

describe("Wildcard.all", () => {
  it("returns the value for the last matching pattern", () => {
    const result = Wildcard.all("src/util/wildcard.ts", {
      "src/*": "shallow",
      "src/util/*": "nested",
    })

    expect(result).toBe("nested")
  })
})

describe("Wildcard.allStructured", () => {
  it("matches head and tail sequences", () => {
    const result = Wildcard.allStructured(
      { head: "git", tail: ["commit", "-m", "test"] },
      {
        "git status": "status",
        "git commit *": "commit",
      },
    )

    expect(result).toBe("commit")
  })
})
