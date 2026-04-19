# Python MCP Server Guide

## Quick Reference

### Key Imports

```python
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field
```

### Server Setup

```python
mcp = FastMCP("my_service_mcp")
```

### Tool Registration

```python
class SearchInput(BaseModel):
    query: str = Field(..., description="Search query")
    limit: int = Field(default=20, ge=1, le=100)

@mcp.tool(
    name="service_search",
    annotations={
        "title": "Search Service",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True
    }
)
async def service_search(params: SearchInput) -> str:
    return "Results..."
```

---

## Project Structure

```
my-service-mcp/
├── requirements.txt
├── main.py              # MCP server
└── schemas.py           # Pydantic models
```

---

## Key Points

### Naming

- Server: `{service}_mcp`
- Tools: `{service}_{action}_{resource}` (snake_case)

### Annotations (DAX uses these)

- `readOnlyHint: true` → Usually auto-approved
- `destructiveHint: true` → Strict approval required
- `idempotentHint: true` → Safe to retry

### Pydantic Model

- Use `Field(...)` with constraints
- Add `description` for parameter docs
- Use `model_config = ConfigDict(extra='forbid')`

---

## Running

```bash
# Local (stdio)
python main.py

# HTTP
python main.py --transport streamable_http --port 8000
```

---

## DAX Integration

```json
{
  "mcp": {
    "servers": {
      "my-service": {
        "command": "python",
        "args": ["main.py"]
      }
    }
  }
}
```

DAX commands:

- `dax mcp list` - Show configured MCPs
- `dax mcp tools my-service` - Show tools
