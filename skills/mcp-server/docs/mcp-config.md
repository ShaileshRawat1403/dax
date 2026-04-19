# MCP Configuration in DAX

## Adding an MCP Server

### Local MCP (stdio)

```json
{
  "mcp": {
    "servers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_TOKEN": "ghp_xxx"
        }
      }
    }
  }
}
```

### Remote MCP

```json
{
  "mcp": {
    "remotes": {
      "my-api": {
        "url": "https://api.example.com/mcp",
        "headers": {
          "Authorization": "Bearer token"
        }
      }
    }
  }
}
```

## Permissions

Configure MCP tool permissions in `dax.json`:

```json
{
  "permissions": {
    "tools": {
      "github_*": "ask",
      "filesystem_*": "auto"
    }
  }
}
```

## Commands

| Command                  | Description              |
| ------------------------ | ------------------------ |
| `dax mcp list`           | List all configured MCPs |
| `dax mcp add <name>`     | Add new MCP server       |
| `dax mcp tools <name>`   | Show tools from MCP      |
| `dax mcp inspect <name>` | Inspect MCP status       |
| `dax mcp remove <name>`  | Remove MCP server        |
