# MCP Server Evaluation Guide

## Overview

Create evaluations to test whether DAX agents can effectively use your MCP server to answer realistic questions.

## Evaluation Requirements

| Requirement      | Description                      |
| ---------------- | -------------------------------- |
| **10 questions** | Human-readable questions         |
| **Read-only**    | Only non-destructive operations  |
| **Independent**  | Each question stands alone       |
| **Complex**      | May require dozens of tool calls |
| **Verifiable**   | Single, clear answer             |
| **Stable**       | Answer won't change over time    |

## Output Format

```xml
<evaluation>
  <qa_pair>
    <question>Find the repository created in Q2 2024 with most stars</question>
    <answer>my-repo</answer>
  </qa_pair>
</evaluation>
```

---

## Good Questions

**Multi-step exploration:**

```xml
<qa_pair>
  <question>Find the project completed in December 2023 with highest budget. What industry?</question>
  <answer>Healthcare</answer>
</qa_pair>
```

**Aggregation:**

```xml
<qa_pair>
  <question>Which user closed most critical bugs in January 2024? Username?</question>
  <answer>alex_dev</answer>
</qa_pair>
```

## Bad Questions

**Changes over time:**

```xml>
<qa_pair>
  <question>How many open issues are there?</question>
  <answer>47</answer>
</qa_pair>
```

**Too easy:**

```xml>
<qa_pair>
  <question>Find PR titled "Add auth" - who created it?</question>
  <answer>developer123</answer>
</qa_pair>
```

---

## Running in DAX

Test your MCP server with DAX:

```bash
# List MCP tools
dax mcp tools my-server

# Inspect MCP
dax mcp inspect my-server

# Run a test session
dax run --mcp my-server
```

---

## Evaluation Tips

1. Use historical/closed data (won't change)
2. Require multi-step exploration
3. Test pagination and filtering
4. Verify answers yourself first
5. Avoid "current state" questions
