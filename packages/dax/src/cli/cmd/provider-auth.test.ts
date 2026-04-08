import { describe, expect, test } from "bun:test"
import { getVisibleProviderAuthMethods } from "./provider-auth"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("getVisibleProviderAuthMethods", () => {
  const googleMethods = [
    {
      type: "api" as const,
      label: "Gemini API Key",
      description: "Use your API key from Google AI Studio.",
    },
    {
      type: "oauth" as const,
      label: "Import from Gemini CLI",
      description: "Import your Google account from the gemini CLI.",
    },
    {
      type: "oauth" as const,
      label: "Google Code Assist / Pro-Plus Sign-In",
      description: "Sign in directly with your Google account.",
    },
    {
      type: "oauth" as const,
      label: "Custom Google OAuth Client",
      description: "Sign in with your own OAuth credentials.",
    },
  ]

  test("uses Gemini CLI as the subscription lane when CLI creds exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dax-google-auth-"))
    const credsPath = join(dir, "oauth_creds.json")
    await writeFile(credsPath, JSON.stringify({ access_token: "x", refresh_token: "y" }))

    const visible = await getVisibleProviderAuthMethods("google", googleMethods, {
      GEMINI_OAUTH_CREDS_PATH: credsPath,
    })

    expect(visible.map((item) => item.title)).toEqual([
      "Gemini API Key",
      "Gemini CLI Session Import",
      "Google OAuth Client Sign-In",
    ])
    expect(visible.map((item) => item.originalIndex)).toEqual([0, 1, 3])
    await rm(dir, { recursive: true, force: true })
  })

  test("uses direct sign-in as the subscription lane when client env vars are present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dax-google-auth-"))
    const visible = await getVisibleProviderAuthMethods("google", googleMethods, {
      HOME: dir,
      DAX_GOOGLE_CLI_CLIENT_ID: "client-id",
      DAX_GOOGLE_CLI_CLIENT_SECRET: "client-secret",
    })

    expect(visible.map((item) => item.title)).toEqual([
      "Gemini API Key",
      "Gemini CLI Session Import",
      "Google OAuth Client Sign-In",
    ])
    expect(visible.map((item) => item.originalIndex)).toEqual([0, 1, 2])
    await rm(dir, { recursive: true, force: true })
  })

  test("falls back to CLI import when neither CLI creds nor direct sign-in env are present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dax-google-auth-"))
    const visible = await getVisibleProviderAuthMethods("google", googleMethods, {
      HOME: dir,
    })

    expect(visible.map((item) => item.title)).toEqual([
      "Gemini API Key",
      "Gemini CLI Session Import",
      "Google OAuth Client Sign-In",
    ])
    expect(visible.map((item) => item.originalIndex)).toEqual([0, 1, 3])
    await rm(dir, { recursive: true, force: true })
  })

  test("leaves non-google providers unchanged", async () => {
    const visible = await getVisibleProviderAuthMethods("openai", [
      {
        type: "api" as const,
        label: "API key",
        description: "Use your OpenAI API key.",
      },
    ])

    expect(visible).toHaveLength(1)
    expect(visible[0]?.title).toBe("API key")
    expect(visible[0]?.originalIndex).toBe(0)
  })

  test("collapses anthropic auth into api key and subscription sign-in lanes", async () => {
    const visible = await getVisibleProviderAuthMethods("anthropic", [
      {
        type: "oauth" as const,
        label: "Claude Pro/Plus Sign-In",
        description: "Use Claude with your Anthropic Pro or Plus subscription",
      },
      {
        type: "api" as const,
        label: "Anthropic API Key",
        description: "Use your API key from console.anthropic.com",
      },
    ])

    expect(visible.map((item) => item.title)).toEqual(["Claude API Key", "Claude Pro/Max Sign-In"])
  })
})
