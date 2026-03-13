# Project Memory

DAX stores lightweight project memory in `.dax/pm.json`.

Commands:
- `node cli/index.js memory list`
- `node cli/index.js memory add "note text" --tags=a,b --author=name --source=user`
- `node cli/index.js memory search "query"`
- `node cli/index.js memory tags tag1,tag2`
- `node cli/index.js memory remove <id>`
- `node cli/index.js memory export`
- `node cli/index.js memory import <file.json>`

Notes store:
- id
- ts
- text
- tags
- author
- source
