import { describe, expect, test } from "bun:test"
import { getVisibleProviderAuthMethods } from "./provider-auth"

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

  test("hides advanced Google sign-in when client env vars are absent", () => {
    const visible = getVisibleProviderAuthMethods("google", googleMethods, {})

    expect(visible.map((item) => item.title)).toEqual([
      "Gemini API Key",
      "Import from Gemini CLI",
      "Custom Google OAuth Client",
    ])
    expect(visible.map((item) => item.originalIndex)).toEqual([0, 1, 3])
  })

  test("shows advanced Google sign-in when client env vars are present", () => {
    const visible = getVisibleProviderAuthMethods("google", googleMethods, {
      DAX_GOOGLE_CLI_CLIENT_ID: "client-id",
      DAX_GOOGLE_CLI_CLIENT_SECRET: "client-secret",
    })

    expect(visible.map((item) => item.title)).toEqual([
      "Gemini API Key",
      "Import from Gemini CLI",
      "Advanced Google Sign-In",
      "Custom Google OAuth Client",
    ])
    expect(visible.map((item) => item.originalIndex)).toEqual([0, 1, 2, 3])
  })

  test("leaves non-google providers unchanged", () => {
    const visible = getVisibleProviderAuthMethods("openai", [
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
})
