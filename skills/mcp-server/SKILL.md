---
name: mcp-server
description: |
  Create high-quality MCP (Model Context Protocol) servers that extend DAX's tool capabilities.
  Use when building MCP servers to integrate external APIs, services, or custom tools into DAX.
  Supports Python (FastMCP) and TypeScript (MCP SDK). Aligns with DAX's governance model -
  MCP tools will go through DAX's approval system.
license: MIT
---

# MCP Server Development Guide for DAX

## Overview

MCP (Model Context Protocol) servers extend DAX's capabilities by adding custom tools that connect to external APIs and services. This skill guides you through creating high-quality MCP servers that integrate seamlessly with DAX's governance and execution model.

When you create an MCP server for DAX:

- Tools automatically integrate with DAX's tool pipeline
- Each tool call goes through DAX's approval system (RAO contract)
- Tool usage is tracked in the audit ledger
- You can configure per-tool permissions in `dax.json`

---

## Process

### Phase 1: Research and Planning

#### 1.1 Understand MCP Design Principles

**API Coverage vs. Workflow Tools:**

- Prioritize comprehensive API coverage for flexibility
- Add specialized workflow tools for common tasks
- DAX agents can compose operations across multiple tools

**Tool Naming:**

- Use clear, descriptive names with consistent prefixes
- Example: `github_create_issue`, `filesystem_read_file`
- Helps DAX's intent classification match tools to user needs

**Tool Descriptions:**

- Write concise descriptions (1-2 sentences)
- Include parameter descriptions
- DAX uses descriptions for tool selection

**Error Handling:**

- Provide actionable error messages with specific suggestions
- DAX will surface errors through its verification system

#### 1.2 Study MCP Protocol

**Key Resources:**

- MCP Specification: `https://modelcontextprotocol.io/specification/draft.md`
- Best Practices: [MCP Best Practices](./reference/mcp_best_practices.md)

#### 1.3 Choose Your Stack

| Language       | SDK                       | Best For                           |
| -------------- | ------------------------- | ---------------------------------- |
| **TypeScript** | @modelcontextprotocol/sdk | Node.js projects, type safety      |
| **Python**     | mcp                       | FastMCP, data science integrations |

**Transport Selection:**

- **stdio**: Local servers, testing
- **streamable-http**: Production, remote servers

---

### Phase 2: Implementation

#### 2.1 Project Setup

**TypeScript:**

```bash
mkdir my-mcp-server && cd my-mcp-server
npm init -y
npm install @modelcontextprotocol/sdk @modelcontextprotocol/server-filesystem
```

**Python:**

```bash
pip install mcp fastmcp
```

#### 2.2 Core Infrastructure

Create utilities for:

- API client with authentication
- Error handling
- Response formatting
- Pagination

#### 2.3 Implement Tools

For each tool, define:

**Input Schema (TypeScript with Zod):**

```typescript
{
  name: "create_issue",
  description: "Create a new GitHub issue",
  inputSchema: z.object({
    title: z.string().describe("Issue title"),
    body: z.string().optional().describe("Issue body"),
    labels: z.array(z.string()).optional().describe("Labels to apply"),
  })
}
```

**Annotations (important for DAX governance):**

- `readOnlyHint`: true/false - Read-only vs mutating operations
- `destructiveHint`: true/false - Potentially destructive actions
- `idempotentHint`: true/false - Safe to retry

DAX uses these hints to determine approval requirements.

---

### Phase 3: Testing

#### 3.1 Local Testing

**Use MCP Inspector:**

```bash
npx @modelcontextprotocol/inspector
```

This lets you test your MCP server before integrating with DAX.

#### 3.2 DAX Integration Testing

Once your MCP is running, test in DAX:

1. Add to `dax.json` MCP configuration
2. Run `dax mcp list` to verify connection
3. Use `/mcp tools <server>` to see available tools
4. Test tool calls through DAX session

---

### Phase 4: Production

#### 4.1 Add to DAX

**Configuration in dax.json:**

```json
{
  "mcp": {
    "servers": {
      "my-server": {
        "command": "node",
        "args": ["./dist/index.js"],
        "env": {
          "API_KEY": "..."
        }
      }
    }
  }
}
```

**Or for remote MCP:**

```json
{
  "mcp": {
    "remotes": {
      "my-remote": {
        "url": "https://api.example.com/mcp"
      }
    }
  }
}
```

#### 4.2 Permissions

MCP tools use DAX's permission system. Configure in `dax.json`:

```json
{
  "permissions": {
    "tools": {
      "my-server_*": "ask"
    }
  }
}
```

---

## DAX-Specific Considerations

### Governance Integration

When creating MCP tools for DAX:

1. **Annotate correctly**: Use `destructiveHint` and `readOnlyHint` to help DAX determine approval requirements
2. **Provide clear descriptions**: DAX's intent system uses tool descriptions
3. **Handle errors gracefully**: DAX surfaces errors through its verification system

### Approval Requirements

| Tool Type                            | Approval Needed                |
| ------------------------------------ | ------------------------------ |
| Read-only (filesystem read, API GET) | Usually auto-approved          |
| Mutating (create, update, delete)    | Requires approval              |
| Destructive (drop table, force push) | Strict approval + confirmation |

### Tool Naming

Prefix your tools to avoid conflicts:

- `myapp_*` - Your custom prefix
- Example: `myapp_create_issue`, `myapp_search_files`

---

## Reference Files

### Core Documentation

- [MCP Best Practices](./reference/mcp_best_practices.md) - Server and tool design
- [TypeScript Guide](./reference/node_mcp_server.md) - SDK patterns
- [Python Guide](./reference/python_mcp_server.md) - FastMCP patterns
- [Evaluation Guide](./reference/evaluation.md) - Testing methodology

### DAX Commands

- `dax mcp add` - Add MCP server to project
- `dax mcp list` - List configured MCPs
- `dax mcp tools <name>` - Show tools from MCP
- `dax mcp inspect <name>` - Inspect MCP configuration

### DAX Configuration

- [MCP Configuration Docs](./docs/mcp-config.md)
- [Permissions Docs](./docs/permissions.md)
