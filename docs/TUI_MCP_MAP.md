# MCP Feature Map In The DAX TUI

## What You See Today

When `workspace-mcp` is connected to DAX, MCP features surface in the current TUI in a few specific places.

There is not a dedicated full-screen “MCP pane” yet.
Instead, MCP shows up through status, autocomplete, commands, and in-session behavior.

## 1. Sidebar

Location:

- Session sidebar

What you see:

- connected MCP servers
- failed MCP servers
- auth-required state
- client-registration-required state

What this means for `workspace-mcp`:

- if the kernel is connected, you will see it listed as connected
- if startup fails, the error appears in the sidebar

## 2. Status Dialog

Location:

- DAX status dialog

What you see:

- number of MCP servers
- per-server state
- failure or auth messages

This is the fastest way to confirm whether the kernel is available in the current DAX session.

## 3. Slash Commands

Location:

- prompt autocomplete for `/...`

What you see:

- MCP prompts exposed as slash commands

Important note:

- this only happens if the MCP server exposes prompts
- if `workspace-mcp` provides only tools and resources, you may not see new slash commands

## 4. Prompt Autocomplete For Resources

Location:

- prompt autocomplete when adding context/resources

What you see:

- MCP resources appear as selectable prompt items
- selecting one inserts it like a file/resource attachment

What happens next:

- DAX reads the MCP resource
- the resource content is injected into the conversation as synthetic text

## 5. Tool Execution During A Session

Location:

- normal model/tool execution flow

What you see:

- MCP tools become callable during agent execution
- they are permission-gated like other tools
- their outputs are folded into the session

For `workspace-mcp`, this is where tools like:

- `kernel_version`
- `self_check`
- `workspace_info`
- `repo_search`
- `read_file`

become useful to the agent.

## 6. Footer/Connection Presence

Location:

- session footer and general connected-state UI

What you see:

- MCP connection count and error hinting

This gives you a lightweight “is the kernel alive?” signal while working.

## Best First User Flow

For your `workspace-mcp` kernel, the best current DAX flow is:

1. configure it as a local MCP server
2. run `dax mcp list`
3. start DAX TUI
4. confirm the server appears in the sidebar/status dialog
5. use read-oriented MCP capabilities first
6. expand to richer tool usage after the read path feels stable

## What Is Missing Today

Not yet first-class in the current TUI:

- dedicated MCP browser pane
- dedicated kernel health dashboard
- explicit per-tool MCP explorer
- bundle/run lifecycle visualizations tailored to `workspace-mcp`

## Strategic Recommendation

Do not build those missing UI surfaces first.

The right order is:

1. validate kernel usefulness through the existing MCP integration
2. confirm which tools/resources are actually used
3. add richer TUI affordances only for the MCP behaviors that prove valuable
