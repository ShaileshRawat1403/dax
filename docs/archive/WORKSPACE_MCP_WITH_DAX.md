# Use `workspace-mcp` With DAX

## What This Means

You can use the `workspace-mcp` kernel from Soothsayer with DAX today.

The smart architecture is:

- DAX stays your main product.
- `workspace-mcp` stays an external kernel/runtime dependency for now.
- DAX connects to it through MCP over local stdio.

This gives DAX access to your kernel without pulling in the whole Soothsayer platform.

## Why This Is The Right First Step

This approach is strategic because it:

- reuses your strongest kernel work immediately
- avoids merging the Soothsayer API/worker stack into DAX
- keeps DAX as the only main product
- lets you prove value before porting kernel ideas deeper into DAX

## What DAX Already Supports

DAX already supports local MCP servers configured as a command plus arguments.

Relevant DAX behavior:

- DAX can launch local MCP servers over stdio from config.
- DAX can list MCP tools, prompts, and resources from connected servers.
- DAX can surface MCP connection status in the CLI/TUI.

That means `workspace-mcp` does not need a new DAX protocol. It only needs to be configured as a local MCP server.

## Recommended Integration Shape

Treat `workspace-mcp` as:

- external
- local
- explicitly configured
- optional

Do not:

- copy Soothsayer app code into DAX
- make DAX depend on the Soothsayer API or worker
- rewrite DAX around the kernel before the integration proves useful

## Prerequisites

You need a working `workspace-mcp` install from the Soothsayer repo.

Example from the Soothsayer repo:

```bash
cd /Users/Shared/MYAIAGENTS/soothsayer/workspace-mcp
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

The executable will typically be:

```bash
/Users/Shared/MYAIAGENTS/soothsayer/workspace-mcp/.venv/bin/workspace-mcp
```

## DAX Config Example

Use a local MCP server entry in your DAX config.

Example:

```jsonc
{
  "mcp": {
    "workspace_kernel": {
      "type": "local",
      "command": [
        "/Users/Shared/MYAIAGENTS/soothsayer/workspace-mcp/.venv/bin/workspace-mcp",
        "--workspace-root",
        "/Users/Shared/MYAIAGENTS/dax",
        "--profile",
        "dev"
      ],
      "environment": {
        "PYTHONUNBUFFERED": "1"
      },
      "timeout": 30000
    }
  }
}
```

A copyable sample file also exists at:

- `examples/dax.workspace-mcp.jsonc`

## Verify The Connection

Run:

```bash
dax mcp list
```

You should see your configured server and a connected status.

Then use DAX normally and confirm MCP tools/resources are visible in the session.

## Recommended First Tool Scope

Start with read-oriented kernel tools first.

Good first candidates:

- `kernel_version`
- `self_check`
- `workspace_info`
- `repo_search`
- `read_file`

Delay write or task-oriented kernel flows until the read path is stable in DAX.

## Strategic Integration Policy

### Keep external for now

Keep these outside DAX for the first wave:

- Python kernel implementation
- Soothsayer API MCP bridge
- Soothsayer worker queue model
- Soothsayer web-only orchestration features

### Align conceptually in DAX

Borrow these concepts into DAX over time:

- canonical lifecycle vocabulary
- explicit violation/error shape
- deterministic bundle/run semantics where useful
- kernel health and self-check behavior

### Only port after proof

Only pull deeper kernel behavior into DAX if:

- the MCP integration is used regularly
- DAX needs tighter local coupling
- the semantics clearly improve DAX’s execution model

## ELI12

Think of it like this:

- DAX is your main workshop.
- `workspace-mcp` is a specialized safety machine in another room.
- DAX can call that machine when needed.
- You do not need to rebuild the whole building just to use the machine.

## Current Recommendation

For the next implementation wave:

1. Use `workspace-mcp` from DAX as an external local MCP server.
2. Validate the read-only tool path first.
3. Keep Soothsayer-specific MCP brokering out of DAX.
4. Port only proven kernel ideas into DAX later.
