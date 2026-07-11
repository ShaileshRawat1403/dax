import { describe, it, expect } from "bun:test"
import { packageVersionForChannel, releaseChannelForVersion } from "../src"

describe("script/index", () => {
  it("should work", () => {
    expect(true).toBe(true)
  })

  it("keeps prerelease binaries on the beta channel", () => {
    expect(releaseChannelForVersion("1.2.0-beta.1")).toBe("beta")
    expect(packageVersionForChannel("1.2.0-beta.1", "beta")).toBe("1.2.0-beta.1")
  })

  it("keeps stable binaries on the latest channel", () => {
    expect(releaseChannelForVersion("1.2.0")).toBe("latest")
    expect(packageVersionForChannel("1.2.0", "latest")).toBe("1.2.0")
  })

  it("does not replace branch-preview versions with the package release", () => {
    expect(packageVersionForChannel("1.2.0-beta.1", "feature-demo")).toBeUndefined()
  })
})
