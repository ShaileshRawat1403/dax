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

| Model Prefix | Auth Path |
| --- | --- |
| `google/*` | Gemini API key or Google OAuth (email) |
| `google-vertex/*` | ADC + project |
| `google-vertex-anthropic/*` | ADC + project |

Use diagnostics:

```bash
dax auth doctor
dax auth doctor google/gemini-2.5-flash
```
