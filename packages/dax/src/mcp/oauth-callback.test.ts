import { expect, spyOn, test } from "bun:test"
import { McpOAuthCallback } from "./oauth-callback"
import { OAUTH_CALLBACK_PATH } from "./oauth-provider"

test("OAuth callback binds loopback and escapes remote error descriptions", async () => {
  const original = Bun.serve
  let url: URL | undefined
  const serve = spyOn(Bun, "serve").mockImplementation(((options) => {
    const server = original({ ...options, unix: undefined, port: 0 })
    url = server.url
    return server
  }) as typeof Bun.serve)
  const inUse = spyOn(McpOAuthCallback, "isPortInUse").mockResolvedValue(false)
  try {
    await McpOAuthCallback.ensureRunning()
    expect(url?.hostname).toBe("127.0.0.1")
    const request = new URL(OAUTH_CALLBACK_PATH, url)
    request.searchParams.set("state", "test")
    request.searchParams.set("error", "denied")
    request.searchParams.set("error_description", '<script>alert("x")</script>&\'')
    const response = await fetch(request)
    const html = await response.text()
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;")
  } finally {
    await McpOAuthCallback.stop()
    inUse.mockRestore()
    serve.mockRestore()
  }
})
