---
name: plugin-creator
description: Create a plugin for XroMax Code when the user asks for a plugin — a bundle of several skills and/or connectors (MCP servers) installed together.
---

# Creating a plugin

A plugin is a folder in `{{PLUGINS_DIR}}` with a `plugin.json` manifest. XroMax Code loads it automatically from the next message and shows it on the Plugins page.

## Layout

```
{{PLUGINS_DIR}}\<plugin-name>\
  plugin.json
  skills\<skill-name>\SKILL.md      (any number of skills)
  .mcp.json                          (optional connectors)
```

`plugin.json`:

```json
{ "name": "<plugin-name>", "version": "1.0.0", "description": "<what the plugin gives the user>" }
```

Each `SKILL.md` starts with:

```markdown
---
name: <skill-name>
description: <what it does and when to use it>
---
```

`.mcp.json` (only if the user wants connectors):

```json
{ "mcpServers": { "<id>": { "command": "npx", "args": ["-y", "<package>"] } } }
```

or a remote server: `{ "type": "http", "url": "https://…/mcp", "headers": { "Authorization": "Bearer …" } }`.
Never put real secret keys into these files unless the user gives them for this purpose.

## Steps

1. Clarify the plugin's purpose; ask one short question only if essential.
2. Create the folder and files with `write_file` (names: lowercase latin letters, digits, dashes).
3. Write each skill following the same rules as a single skill: concrete description, imperative instructions for an AI agent.
4. Read `plugin.json` back to check it is valid JSON.
5. Tell the user briefly what the plugin contains and that it is now listed on the Plugins page.
