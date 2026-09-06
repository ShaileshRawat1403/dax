import { expect, test } from "bun:test"
import { redactDeep } from "../worker/evidence-redaction"

// A share link is public and a GitHub comment on a public repo is world
// readable. Both paths used to send their payload through verbatim.
test("redacting a JSON payload leaves valid JSON and removes the secrets", () => {
  const payload = [
    { type: "text", text: "export GITHUB_TOKEN=ghp_abcdefghijklmnop1234" },
    { type: "diff", text: 'Authorization: Bearer sk-ant-api03-abcdefghijklmnop' },
    { type: "text", text: 'const config = { "api_key": "abcdef1234567890" }' },
    { type: "text", text: "nothing sensitive here" },
  ]

  const parsed = redactDeep(payload)
  const redacted = JSON.stringify(parsed)

  expect(redacted).not.toContain("ghp_abcdefghijklmnop1234")
  expect(redacted).not.toContain("sk-ant-api03-abcdefghijklmnop")
  expect(redacted).not.toContain("abcdef1234567890")
  expect(parsed).toHaveLength(4)
  expect(parsed[3]!.text).toBe("nothing sensitive here")
})
