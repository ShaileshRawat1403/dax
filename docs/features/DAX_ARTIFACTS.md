# Artifacts

Artifacts are retained execution outputs associated with DAX work.

In the canonical runtime, artifacts currently come from real retained-output surfaces such as:

- tool attachments
- truncated tool output references
- session diffs

Use:

```bash
dax artifacts
dax artifacts --format json
dax artifacts --session <session-id>
```

Artifacts answer:

- what outputs exist
- where they came from
- which session they belong to

Artifacts do not answer trust or verification questions yet. Those stay in later audit/evidence surfaces.
