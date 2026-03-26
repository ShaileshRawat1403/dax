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
| `google/*`   | Gemini API key, Gemini subscription sign-in, Custom OAuth     |

Use diagnostics:

```bash
dax auth doctor
dax auth doctor google/gemini-2.5-flash
```

## Google Auth Lanes

DAX supports three clear authentication lanes for the `google/*` provider.

In the current CLI and TUI UX, most operators will see three visible options by default:

- `Gemini API Key`
- `Gemini Subscription Sign-In`
- `Custom Google OAuth Client`

`Gemini Subscription Sign-In` uses your local `gemini` CLI session when available. If `DAX_GOOGLE_CLI_CLIENT_ID` and `DAX_GOOGLE_CLI_CLIENT_SECRET` are configured, DAX can also use direct browser sign-in for the same subscription lane.

### 1. Gemini API Key (Default)

Fastest setup. Uses a free or pay-as-you-go API key from Google AI Studio.

### 2. Gemini Subscription Sign-In

This lane is for Gemini Pro, Pro Plus, and Code Assist style subscription access. DAX routes requests through the `cloudcode-pa` quota lane and manages the integration details for you.

By default, DAX will use your existing local `gemini` CLI login when it finds one.

This is a local-user credential flow. DAX is not hard-coded to a particular builder account or bundled subscription.

If your imported Gemini CLI session expires, DAX will tell you to run `gemini` again instead of sending you to custom OAuth setup.

If `DAX_GOOGLE_CLI_CLIENT_ID` and `DAX_GOOGLE_CLI_CLIENT_SECRET` are configured, DAX can also use direct browser-based subscription sign-in for the same lane.

If Google temporarily rate-limits this lane, DAX will wait and retry automatically. The TUI should say that the Gemini subscription lane is busy and show the retry countdown.

### 3. Custom Google OAuth Client

If you prefer to maintain isolation or run in an enterprise setting, you can use your own Google OAuth client:

1. Create an OAuth 2.0 Client ID at [Google Cloud Console](https://console.cloud.google.com/apis/credentials/oauthclient)
   - Application type: "Desktop app" or "Web application"
   - Note the Client ID and Client Secret

2. **In the TUI** (easiest):

   ```
   dax
   → Connect a model provider → Google
   → Custom Google OAuth Client
   → Enter your Client ID and Client Secret
   → Complete Google sign-in in browser
   ```

3. **Pre-configure credentials** (for repeated use):
   ```bash
   # Set environment variables before running dax
   export DAX_GOOGLE_CLI_CLIENT_ID="your-client-id"
   export DAX_GOOGLE_CLI_CLIENT_SECRET="your-client-secret"
   # Then run dax auth login and select "Custom Google OAuth Client"
   ```

### Troubleshooting

**Token refresh fails**

- If you used `Gemini Subscription Sign-In` through the Gemini CLI import path, run `gemini` again and reconnect.
- If you used `Custom Google OAuth Client`, re-run `dax auth login` and complete OAuth again.

**Scope errors**

- Make sure you're using `google/*` models (not `google-vertex/*`)
- Vertex uses different authentication (ADC credentials)

### Security Notes

- Your OAuth credentials are stored locally in `~/.dax/data/auth.json`
- Access and refresh tokens are stored securely
- Each user should use their own keys, CLI login, or OAuth client
- See [Security Policy](../../SECURITY.md) for more details
