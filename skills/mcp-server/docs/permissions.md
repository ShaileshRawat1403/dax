# MCP Server Permissions

Model Context Protocol (MCP) servers can expose various tools, resources, and prompts. To ensure the safety of your local environment, DAX enforces a strict permission model for executing tools provided by MCP servers.

## The Approval Flow

When an MCP server requests to execute a tool that modifies system state, runs shell commands, or accesses sensitive paths, DAX interrupts the execution and requires explicit operator approval.

DAX uses a simple and effective approval flow to ensure safety without hurting user experience:
- **Interactive Prompt:** The UI presents a clear, containerized alert detailing the requested action, the associated risk, and the specific tool being called.
- **Short Generic Signals:** If you are using DAX in chat mode, you can approve blocked actions with simple, natural language signals like `"yes"`, `"approve"`, `"go ahead"`, or `"proceed"`. DAX is smart enough to map these generic signals to the pending blocked resource without requiring you to type out the full file path or command.
- **Denials:** You can deny the request just as easily by typing `"no"`, `"stop"`, or `"deny"`, or by selecting the Deny option in the TUI.

## Configuring Permissions

Permissions and environment access are scoped when defining your MCP servers. For example, when configuring a filesystem server, you can pass arguments to restrict its sandbox:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "./allowed-dir"]
      }
    }
  }
}
```

By default, any tool that falls outside of the implicitly safe zone or attempts high-risk mutations will trigger the runtime guard, invoking the interactive approval UX. This keeps your workflow smooth, simple, and secure.
