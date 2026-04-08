import { describe, expect, test } from "bun:test"
import { expectedReleaseAssetFilenames, matchesReleaseTagName, toReleaseTag } from "./release-metadata"

describe("release metadata helpers", () => {
  test("builds the canonical release tag from a version", () => {
    expect(toReleaseTag("1.0.26")).toBe("v1.0.26")
  })

  test("matches exact release tag naming", () => {
    expect(matchesReleaseTagName("v1.0.26", "1.0.26")).toBe(true)
    expect(matchesReleaseTagName("1.0.26", "1.0.26")).toBe(false)
  })

  test("returns the full expected release asset inventory", () => {
    const filenames = expectedReleaseAssetFilenames()
    expect(filenames).toContain("dax-darwin-arm64.tar.gz")
    expect(filenames).toContain("dax-windows-x64.zip")
    expect(filenames).toHaveLength(11)
  })
})
