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

DAX supports multiple discrete authentication lanes for the `google/*` provider:

### 1. Gemini API Key (Default)

Fastest setup. Uses a free or pay-as-you-go API key from Google AI Studio.

### 2. Google Code Assist / Pro-Plus Sign-In

Direct browser-based sign-in for Gemini Pro/Plus subscriptions. This lane routes your models to Code Assist's `cloudcode-pa` endpoints and enables advanced subscription quota behavior.

_Note: This advanced lane requires the operator to provide Code Assist compatible credentials via the `DAX_GOOGLE_CLI_CLIENT_ID` and `DAX_GOOGLE_CLI_CLIENT_SECRET` environment variables._

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
   dax auth add --oauth-creds ./path/to/client_secret.json
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
