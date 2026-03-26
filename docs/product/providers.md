# Providers

DAX can be configured via project/global config and environment variables.

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
| `google/*`   | Gemini API key, Code Assist Sign-In, CLI Import, Custom OAuth |

Use diagnostics:

```bash
dax auth doctor
dax auth doctor google/gemini-2.5-flash
```

## Google Auth Lanes

DAX supports multiple authentication lanes for the `google/*` provider.

In the current CLI and TUI UX, most operators will see three visible options by default:

- `Gemini API Key`
- `Import from Gemini CLI`
- `Custom Google OAuth Client`

The advanced direct Google sign-in lane is shown only when both `DAX_GOOGLE_CLI_CLIENT_ID` and `DAX_GOOGLE_CLI_CLIENT_SECRET` are configured.

### 1. Gemini API Key (Default)

Fastest setup. Uses a free or pay-as-you-go API key from Google AI Studio.

### 2. Google Code Assist / Pro-Plus Sign-In

Direct browser-based sign-in for Gemini Pro/Plus subscriptions. This lane routes your models to Code Assist's `cloudcode-pa` endpoints and enables advanced subscription quota behavior.

_Note: This advanced lane is hidden from the auth picker unless Code Assist compatible credentials are provided via `DAX_GOOGLE_CLI_CLIENT_ID` and `DAX_GOOGLE_CLI_CLIENT_SECRET`._

### 3. Import from Gemini CLI

Imports existing credentials configured via `gemini login` locally. This also routes requests through Pro-Plus `cloudcode-pa` endpoints using your pre-authorized identity.

### 4. Custom Google OAuth Client

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

- Check if the refresh token hasn't been revoked
- Run `dax auth login` to re-authenticate if needed

**Scope errors**

- Make sure you're using `google/*` models (not `google-vertex/*`)
- Vertex uses different authentication (ADC credentials)

### Security Notes

- Your OAuth credentials are stored locally in `~/.dax/data/auth.json`
- Access and refresh tokens are stored securely
- Each user should create their own OAuth client (no shared credentials)
- See [Security Policy](../../SECURITY.md) for more details
