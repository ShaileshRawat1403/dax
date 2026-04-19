# MCP Server Best Practices

## Quick Reference

### Server Naming

- **Python**: `{service}_mcp` (e.g., `slack_mcp`)
- **Node/TypeScript**: `{service}-mcp-server` (e.g., `slack-mcp-server`)

### Tool Naming

- Use snake_case with service prefix
- Format: `{service}_{action}_{resource}`
- Example: `slack_send_message`, `github_create_issue`

### Response Formats

- Support both JSON and Markdown formats
- JSON for programmatic processing
- Markdown for human readability

### Pagination

- Always respect `limit` parameter
- Return `has_more`, `next_offset`, `total_count`
- Default to 20-50 items

### Transport

- **Streamable HTTP**: For remote servers, multi-client scenarios
- **stdio**: For local integrations, command-line tools
- Avoid SSE (deprecated in favor of streamable HTTP)

---

## Server Naming Conventions

**Python**: Use format `{service}_mcp` (lowercase with underscores)

- Examples: `slack_mcp`, `github_mcp`, `jira_mcp`

**Node/TypeScript**: Use format `{service}-mcp-server` (lowercase with hyphens)

- Examples: `slack-mcp-server`, `github-mcp-server`, `jira-mcp-server`

The name should be descriptive of the service being integrated, easy to infer from the task description, and without version numbers.

---

## Tool Naming and Design

### Tool Naming

1. **Use snake_case**: `search_users`, `create_project`, `get_channel_info`
2. **Include service prefix**: Anticipate that your MCP server may be used alongside other MCP servers
   - Use `slack_send_message` instead of just `send_message`
   - Use `github_create_issue` instead of just `create_issue`
3. **Be action-oriented**: Start with verbs (get, list, search, create, etc.)
4. **Be specific**: Avoid generic names that could conflict with other servers

### Tool Design

- Tool descriptions must narrowly and unambiguously describe functionality
- Descriptions must precisely match actual functionality
- Provide tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
- Keep tool operations focused and atomic

---

## Response Formats

All tools that return data should support multiple formats:

### JSON Format (`response_format="json"`)

- Machine-readable structured data
- Include all available fields and metadata
- Consistent field names and types
- Use for programmatic processing

### Markdown Format (`response_format="markdown"`, typically default)

- Human-readable formatted text
- Use headers, lists, and formatting for clarity
- Convert timestamps to human-readable format
- Show display names with IDs in parentheses
- Omit verbose metadata

---

## Pagination

For tools that list resources:

- **Always respect the `limit` parameter**
- **Implement pagination**: Use `offset` or cursor-based pagination
- **Return pagination metadata**: Include `has_more`, `next_offset`/`next_cursor`, `total_count`
- **Never load all results into memory**: Especially important for large datasets
- **Default to reasonable limits**: 20-50 items is typical

Example pagination response:

```json
{
  "total": 150,
  "count": 20,
  "offset": 0,
  "items": [...],
  "has_more": true,
  "next_offset": 20
}
```

---

## Transport Options

### Streamable HTTP

**Best for**: Remote servers, web services, multi-client scenarios

**Use when**:

- Serving multiple clients simultaneously
- Deploying as a cloud service
- Integration with web applications

### stdio

**Best for**: Local integrations, command-line tools

**Use when**:

- Building tools for local development environments
- Integrating with desktop applications
- Single-user, single-session scenarios

**Note**: stdio servers should NOT log to stdout (use stderr for logging)

---

## Tool Annotations

DAX uses these annotations to determine approval requirements:

| Annotation               | DAX Behavior             |
| ------------------------ | ------------------------ |
| `readOnlyHint: true`     | Usually auto-approved    |
| `readOnlyHint: false`    | May require approval     |
| `destructiveHint: true`  | Strict approval required |
| `destructiveHint: false` | Standard approval        |
| `idempotentHint: true`   | Safe to retry            |

---

## Error Handling

- Use standard JSON-RPC error codes
- Report tool errors within result objects (not protocol-level errors)
- Provide helpful, specific error messages with suggested next steps
- Don't expose internal implementation details
- Clean up resources properly on errors

Example:

```typescript
try {
  const result = performOperation()
  return { content: [{ type: "text", text: result }] }
} catch (error) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Error: ${error.message}. Try using filter='active_only' to reduce results.`,
      },
    ],
  }
}
```

---

## Security Best Practices

### Authentication

- Store API keys in environment variables, never in code
- Validate keys on server startup
- Use OAuth 2.1 for production services

### Input Validation

- Sanitize file paths to prevent directory traversal
- Validate URLs and external identifiers
- Use schema validation (Pydantic/Zod) for all inputs
- Prevent command injection in system calls

### DNS Rebinding Protection

- Enable DNS rebinding protection for streamable HTTP
- Validate the `Origin` header on all incoming connections
- Bind to `127.0.0.1` rather than `0.0.0.0`

---

## Integration with DAX

When creating MCP servers for DAX:

1. **Tool names**: Use `{service}_{action}_{resource}` format
2. **Descriptions**: Write clear, specific descriptions for DAX's intent system
3. **Annotations**: Set correctly for DAX's approval system
4. **Testing**: Test with `dax mcp inspect <name>` before production use

DAX commands:

- `dax mcp add` - Add MCP server
- `dax mcp list` - List all MCPs
- `dax mcp tools <name>` - View tools
- `dax mcp inspect <name>` - Inspect configuration
