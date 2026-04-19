---
name: "skill-repro"
description: "Reproduce reported bugs or symptoms by creating minimal, verifiable scripts in the DAX Lab."
---

# Bug Reproduction Skill

Use this skill when a user reports a bug, unexpected behavior, or failing symptom that needs to be isolated and verified before a fix is implemented.

## When to Use

- User reports a bug or regression
- User provides a failing code snippet
- You need to confirm a failure state before drafting a fix
- You need to verify that a fix actually resolves the reported issue

## The DAX Lab

Experimental reproduction scripts should ALWAYS be placed in the `.dax/lab/` directory. DAX has **Implicit Approval** to write and execute any code within this directory. This keeps the main `src/` tree clean and avoids unnecessary approval prompts.

## Workflow

1.  **Analyze**: Map the reported symptom to the likely codebase modules. Identify relevant dependencies and configurations.
2.  **Draft**: Write a standalone reproduction script in `.dax/lab/` (e.g., `.dax/lab/repro_issue_123.ts`).
    - Use absolute imports or relative paths correctly.
    - Ensure the script is self-contained or explicitly imports the required local modules.
3.  **Verify Failure**: Execute the script using `bun run` or the appropriate runtime and confirm it fails as expected with the reported symptom.
4.  **Minimize**: Strip away unrelated logic until the script is the smallest possible "proof of bug".
5.  **Link to Fix**: 
    - Once a fix is drafted, run the repro script again.
    - Confirm the script now passes (or the failure is resolved).
6.  **Cleanup (Optional)**: If the repro is no longer needed, delete the script from `.dax/lab/`.

## Output Contract

When the reproduction is complete, report:

1.  `Reproduction Script`: Path to the script in `.dax/lab/`.
2.  `Failure Symptom`: The exact error or output that confirms the bug.
3.  `Isolation Level`: Confirmation that the bug is reproduced in isolation from unrelated logic.
4.  `Verification Plan`: How you will use this script to verify the upcoming fix.

## Tooling

- Use `write_file` to create the script in `.dax/lab/`.
- Use `run_shell_command` (e.g., `bun run .dax/lab/repro.ts`) to execute it.
- Use `enforceRuntimeGuard` logic which implicitly allows these actions in the Lab.
