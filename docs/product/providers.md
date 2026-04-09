# Providers

DAX can be configured via project/global config and environment variables.

By default, provider authentication is local to the current machine and OS user. If you authenticate once on your laptop, DAX can usually reuse that authentication across repositories on the same machine. Other users still need to authenticate with their own accounts on their own machines.

## Common Provider Env Vars

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- `GOOGLE_CLOUD_PROJECT` (for Vertex providers)
- `GOOGLE_APPLICATION_CREDENTIALS` (optional explicit ADC path)
- `OLLAMA_BASE_URL` (default: `http://localhost:11434`)

## Google Provider Split (Important)

| Model Prefix | Auth Path                                                     |
| ------------ | ------------------------------------------------------------- |
| `google/*`   | Gemini API key, Gemini CLI session import, Google OAuth client sign-in |

Use diagnostics:

```bash
dax auth doctor
dax auth doctor google/gemini-2.5-flash
```

## Google Auth Lanes

DAX supports three clear authentication lanes for the `google/*` provider.

In the current CLI and TUI UX, most operators will see three visible options by default:

- `Gemini API Key`
- `Gemini CLI Session Import`
- `Google OAuth Client Sign-In`

`Gemini CLI Session Import` uses your local `gemini` CLI session when available.

`Google OAuth Client Sign-In` is the browser-based lane. If `DAX_GOOGLE_CLI_CLIENT_ID` and `DAX_GOOGLE_CLI_CLIENT_SECRET` are configured, DAX can use them directly. Otherwise DAX will prompt for your own OAuth client credentials.

### Visible Lanes vs Underlying Implementation

The picker intentionally shows three operator-facing choices even though the Gemini plugin may use more specific internal auth methods underneath.

| Visible lane | What DAX may use underneath | Best mental model |
| ------------ | --------------------------- | ----------------- |
| `Gemini API Key` | Google AI Studio API key | simplest direct API access |
| `Gemini CLI Session Import` | local `gemini` CLI import | reuse your existing local Gemini login |
| `Google OAuth Client Sign-In` | configured browser sign-in or user-managed Google OAuth client credentials | browser-based OAuth lane |

```mermaid
flowchart TD
    A[Visible Google Picker] --> B[Gemini API Key]
    A --> C[Gemini CLI Session Import]
    A --> D[Google OAuth Client Sign-In]
    D --> E[Configured Google OAuth client]
    D --> F[Prompted custom Google OAuth client]
```

The internal method names are implementation details. They help DAX choose the right subscription path for the current machine, but they are not meant to be treated as separate public lanes.

## Anthropic Pro/Max Note

Anthropic recently changed how third-party apps consume Claude Pro/Max access.

For DAX operators, the practical implication is simple:

- DAX can still use the `Claude Pro/Max Sign-In` lane when your Anthropic session is healthy
- third-party usage may now draw from Anthropic "extra usage" credit instead of your normal plan bucket
- if the lane suddenly feels different from yesterday, the change may be billing or policy-side rather than a DAX auth bug

Builder note:

> Apparently the open ecosystem now comes with a velvet rope and a cover charge. A bleakly efficient business model, if not a particularly romantic one for open tooling.

Use diagnostics:

```bash
dax doctor auth anthropic
```

If DAX reports `auth_expired`, reconnect. If it reports `ready` but your run still fails, the next likely suspects are rate limits, model availability, or Anthropic-side policy pressure rather than local token expiry.

### 1. Gemini API Key (Default)

Fastest setup. Uses a free or pay-as-you-go API key from Google AI Studio.

### 2. Gemini CLI Session Import

This lane reuses your existing local `gemini` CLI login for the Gemini subscription path.

By default, DAX will use your existing local `gemini` CLI login when it finds one.

This is a local-user credential flow. DAX is not hard-coded to a particular builder account or bundled subscription.

If your imported Gemini CLI session expires, DAX will tell you to run `gemini` again or switch to `Google OAuth Client Sign-In`.

If Google temporarily rate-limits this lane, DAX will wait and retry automatically. The TUI should say that the Gemini subscription lane is busy and show the retry countdown.

### 3. Google OAuth Client Sign-In

If you prefer browser-based sign-in or need stronger control, use the Google OAuth client lane:

1. Create an OAuth 2.0 Client ID at [Google Cloud Console](https://console.cloud.google.com/apis/credentials/oauthclient)
   - Application type: "Desktop app" or "Web application"
   - Note the Client ID and Client Secret

2. **In the TUI** (easiest):

   ```
   dax
   → Connect a model provider → Google
   → Google OAuth Client Sign-In
   → Enter your Client ID and Client Secret
   → Complete Google sign-in in browser
   ```

3. **Pre-configure credentials** (for repeated use):
   ```bash
   # Set environment variables before running dax
   export DAX_GOOGLE_CLI_CLIENT_ID="your-client-id"
   export DAX_GOOGLE_CLI_CLIENT_SECRET="your-client-secret"
   # Then run dax auth login and select "Google OAuth Client Sign-In"
   ```

### Troubleshooting

**Token refresh fails**

- If you used `Gemini CLI Session Import`, run `gemini` again and reconnect.
- If you used `Google OAuth Client Sign-In`, re-run `dax auth login` and complete OAuth again.

**Scope errors**

- Make sure you're using `google/*` models (not `google-vertex/*`)
- Vertex uses different authentication (ADC credentials)

### Security Notes

- Your OAuth credentials are stored locally in `~/.dax/data/auth.json`
- Access and refresh tokens are stored securely
- Each user should use their own keys, CLI login, or OAuth client
- See [Security Policy](../../SECURITY.md) for more details
