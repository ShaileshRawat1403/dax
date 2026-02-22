# Providers

DAX reads providers from `.dax/config.json`.

Example:
```json
{
  "providers": [
    { "id": "openai", "model": "gpt-4.1-mini" },
    { "id": "anthropic", "model": "claude-3-5-sonnet" },
    { "id": "google", "model": "gemini-1.5-flash" },
    { "id": "ollama", "model": "llama3" }
  ]
}
```

Environment variables:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- `OLLAMA_HOST` (default: `http://localhost:11434`)
