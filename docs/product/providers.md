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

| Model Prefix                | Auth Path                              |
| --------------------------- | -------------------------------------- |
| `google/*`                  | Gemini API key or Google OAuth (email) |
| `google-vertex/*`           | ADC + project                          |
| `google-vertex-anthropic/*` | ADC + project                          |

Use diagnostics:

```bash
dax auth doctor
dax auth doctor google/gemini-2.5-flash
```

## Google OAuth (Sign in with Google)

DAX supports "Sign in with Google (email)" for the `google/*` provider, which uses OAuth instead of an API key.

### How It Works

1. **No API Key Required** - OAuth provides access tokens with proper scopes
2. **Automatic Token Refresh** - Tokens are automatically refreshed when expired
3. **Required Scopes** - Includes Gemini-specific scopes for quota and retrieval

### Setup Options

#### Option 1: Use Your Own OAuth Client (Recommended)

1. Create an OAuth 2.0 Client ID at [Google Cloud Console](https://console.cloud.google.com/apis/credentials/oauthclient)
   - Application type: "Desktop app" or "Web application"
   - Note the Client ID and Client Secret

2. **In the TUI** (easiest):

   ```
   dax
   → Connect a model provider → Google
   → Sign in with Google (email)
   → Enter your Client ID and Client Secret
   → Complete Google sign-in in browser
   ```

3. **Pre-configure credentials** (for repeated use):
   ```bash
   dax auth add --oauth-creds ./path/to/client_secret.json
   ```

#### Option 2: Environment Variables

```bash
export DAX_GEMINI_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export DAX_GEMINI_OAUTH_CLIENT_SECRET="GOCSPX-your-secret"
```

Legacy environment variables are also supported:

```bash
export GEMINI_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export GEMINI_OAUTH_CLIENT_SECRET="GOCSPX-your-secret"
```

### Creating a Google OAuth Client

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Click "Create Credentials" → "OAuth client ID"
3. Application type: "Desktop app" (recommended for local CLI use)
4. Download the JSON file
5. Use with `dax auth add --oauth-creds <file>` or enter credentials in TUI

### Troubleshooting

**"OAuth credentials not configured" error**

- You must provide your own OAuth client credentials
- Cannot use DAX with OAuth without configuring credentials

**Token refresh fails**

- Ensure your OAuth client credentials are valid
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
