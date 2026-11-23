---
name: skill-creator
description: Create a new skill for XroMax Code when the user asks to make, save or turn something into a skill (a reusable instruction set for a kind of task).
---

# Creating a skill

A skill is a folder with a `SKILL.md` file. XroMax Code picks it up automatically from the next message.

Skills folder: `{{SKILLS_DIR}}`

## Steps

1. Understand the job: what kind of task the skill is for, when it should be used, what the result must look like, the user's rules and preferences. If something essential is missing, ask one short question; otherwise use sensible defaults.
2. Pick a short name: lowercase latin letters, digits and dashes (for example `landing-page`, `bug-report`, `ru-docs`).
3. Create `{{SKILLS_DIR}}\<name>\SKILL.md` with `write_file`. Format:

```markdown
---
name: <name>
description: <one sentence: what the skill does AND when to use it — the agent decides by this line>
---

# <Title>

<Instructions: goal, step-by-step process, rules, quality bar, output format, examples.>
```

4. If the skill needs helper files (templates, scripts, reference text), put them next to `SKILL.md` in the same folder and mention them by relative path in the instructions.
5. Read the file back to check it, then tell the user in one or two sentences: the skill name, what it does, and that they can call it with `/<name>` or just describe a matching task.

## Quality rules

- The description must say when to use the skill, concretely.
- Instructions are written for an AI agent: imperative, specific, no filler.
- Keep it focused on one kind of task. Several unrelated jobs → several skills.
- Write instructions in English unless the user wants another language; the agent answers in the user's language anyway.
