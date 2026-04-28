import { describe, expect, test } from "bun:test"
import { legacyToolTogglesToPermissionConfig } from "./legacy-tools"

describe("legacy tool compatibility", () => {
  test("maps legacy edit-style tools onto a single edit permission", () => {
    expect(
      legacyToolTogglesToPermissionConfig({
        write: true,
        patch: false,
      }),
    ).toEqual({
      edit: "deny",
    })
  })

  test("preserves non-edit tools as direct permission entries", () => {
    expect(
      legacyToolTogglesToPermissionConfig({
        shell: true,
        webfetch: false,
      }),
    ).toEqual({
      shell: "allow",
      webfetch: "deny",
    })
  })

  test("returns an empty config when no legacy tool toggles are provided", () => {
    expect(legacyToolTogglesToPermissionConfig()).toEqual({})
  })
})
