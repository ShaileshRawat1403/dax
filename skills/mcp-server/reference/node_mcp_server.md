# TypeScript MCP Server Guide

## Quick Reference

### Key Imports

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
```

### Server Setup

```typescript
const server = new McpServer({
  name: "my-service-mcp",
  version: "1.0.0",
})
```

---

## Project Structure

```
my-service-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Main entry point
│   ├── tools/            # Tool implementations
│   ├── services/          # API clients
│   └── schemas/          # Zod validation schemas
└── dist/                 # Built output
```

---

## Tool Registration

```typescript
import { z } from "zod"

const SearchInputSchema = z
  .object({
    query: z.string().min(2, "Query must be at least 2 characters").max(200).describe("Search string"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max results"),
    response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
  })
  .strict()

server.registerTool(
  "service_search",
  {
    title: "Search Service",
    description: "Search for resources in the service",
    inputSchema: SearchInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (params) => {
    // Implementation
    return {
      content: [{ type: "text", text: "Results..." }],
      structuredContent: { results: [] },
    }
  },
)
```

---

## Key Points

### Naming

- Server: `{service}-mcp-server`
- Tools: `{service}_{action}_{resource}` (snake_case)

### Annotations (DAX uses these)

- `readOnlyHint: true` → Usually auto-approved
- `destructiveHint: true` → Strict approval required
- `idempotentHint: true` → Safe to retry

### Zod Schema

- Use `.strict()` to forbid extra fields
- Add constraints with error messages
- Use `.describe()` for parameter docs

### Response Format

```typescript
return {
  content: [{ type: "text", text: markdownText }],
  structuredContent: { json: "data" }, // Modern pattern
}
```

---

## Running

### Local (stdio)

```bash
npm run build
node dist/index.js
```

### Remote (HTTP)

```typescript
// In index.ts
const transport = new StreamableHTTPServerTransport({...});
await server.connect(transport);
```

### Testing

```bash
npx @modelcontextprotocol/inspector
```

---

## DAX Integration

```json
{
  "mcp": {
    "servers": {
      "my-service": {
        "command": "node",
        "args": ["./dist/index.js"]
      }
    }
  }
}
```

DAX commands:

- `dax mcp list` - Show configured MCPs
- `dax mcp tools my-service` - Show available tools
- `dax mcp inspect my-service` - Inspect connection
