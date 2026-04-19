---
name: skill-builder
description: |
  Create and improve DAX skills. Use when users want to create a new skill, modify an existing skill,
  run evaluations to test skill performance, or optimize skill triggering. This skill provides the complete
  workflow for building production-ready skills for DAX.
---

# DAX Skill Builder

Create and improve DAX skills with structured evaluation and iteration.

## Overview

DAX skills are markdown files with YAML frontmatter that provide specialized instructions to DAX agents. This skill guides you through creating, testing, and improving skills.

### When to Use This Skill

Use this skill when:

- User wants to create a new skill from scratch
- User wants to improve an existing skill
- User wants to test a skill with evaluations
- User wants to optimize skill triggering accuracy

---

## Creating a Skill

### Step 1: Capture Intent

Start by understanding what the user wants the skill to do:

1. What should this skill enable DAX to do?
2. When should this skill trigger? (user phrases, contexts)
3. What's the expected output format?
4. What tools or resources does it need?

### Step 2: Define the Skill Structure

Skills follow this structure:

```
skill-name/
├── SKILL.md           # Required - skill definition
├── scripts/           # Optional - helper scripts
├── references/        # Optional - reference docs
└── assets/            # Optional - templates, examples
```

### Step 3: Write SKILL.md

Required frontmatter:

```yaml
---
name: skill-name
description: |
  What this skill does and when to trigger it.
  Include specific contexts where this skill applies.
---
```

**Tips for descriptions:**

- Be specific about triggering contexts
- Include example phrases users might say
- Make it "pushy" - skills should be suggested when relevant

Example description:

```
Create documentation from code. Use when user mentions "document",
"docs", "readme", "API docs", or wants to generate documentation
for any code, files, or project.
```

### Step 4: Write the Body

Include:

- **Overview**: What the skill does
- **Process**: Step-by-step workflow
- **Guidelines**: Best practices and patterns
- **Examples**: Sample inputs/outputs

Keep it under 500 lines - reference external docs for deep dives.

---

## Testing Skills

### Test Cases

Create realistic test prompts in `evals/evals.json`:

```json
{
  "skill_name": "my-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result"
    }
  ]
}
```

### Running Tests

Test the skill in DAX:

1. Place skill in `.dax/skills/` or `skills/`
2. Use `/skill <name>` to invoke
3. Run test prompts through DAX
4. Review outputs

### Evaluation Criteria

| Criteria         | Description                      |
| ---------------- | -------------------------------- |
| **Accuracy**     | Does it produce correct outputs? |
| **Completeness** | Does it handle all cases?        |
| **Triggering**   | Does it activate when needed?    |
| **Clarity**      | Are instructions clear?          |

---

## Improving Skills

### Iteration Loop

1. **Run tests** - Execute test prompts with the skill
2. **Review outputs** - Check for issues, improvements needed
3. **Analyze gaps** - Identify what's not working
4. **Improve** - Update skill based on feedback
5. **Repeat** - Continue until satisfied

### Common Improvements

- **More specific triggers** - Add more contexts where it should activate
- **Clearer instructions** - Use imperative, explain the "why"
- **Add examples** - Include realistic examples
- **Bundle scripts** - Move repeated code to `scripts/`

---

## DAX Skill Best Practices

### Naming

- Use lowercase with hyphens: `my-skill`
- Make it descriptive: `code-review`, `test-generator`

### Descriptions

- Include specific triggers: phrases, contexts, file types
- Be comprehensive but not too long (2-4 sentences)
- Use "pushy" language to improve triggering

### Structure

- Keep SKILL.md under 500 lines
- Use references/ for detailed docs
- Bundle scripts for deterministic tasks

### Testing

- Create 3-5 test cases
- Use realistic prompts
- Test edge cases

---

## Skill Examples

### Simple Skill

```yaml
---
name: quick-review
description: |
  Quick code review for small changes. Use when user says "review this",
  "quick look", "check this code", or shares a small code snippet (<50 lines).
---
# Quick Code Review

## When to Use
- User requests quick review
- Code snippet is <50 lines
- No full project context needed

## Process
1. Read the provided code
2. Identify potential issues
3. Provide concise feedback
4. Suggest improvements if critical
```

### Complex Skill with Scripts

```
my-skill/
├── SKILL.md
├── scripts/
│   ├── validate.py    # Validation logic
│   └── format.py      # Formatting helpers
└── references/
    └── api-docs.md    # Detailed documentation
```

---

## DAX Commands

| Command                  | Description               |
| ------------------------ | ------------------------- |
| `dax skills list`        | List all available skills |
| `dax skills info <name>` | Show skill details        |
| `/skill <name>`          | Invoke a skill in DAX     |

---

## Next Steps

After creating a skill:

1. Test with realistic prompts
2. Get user feedback
3. Iterate on improvements
4. Add to `.dax/skills/` for project or `~/.dax/skills/` for global

For advanced optimization (triggering accuracy), consider refining the description based on test results.
