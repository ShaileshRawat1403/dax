import re

files = [
    "src/sdk/copilot/chat/openai-compatible-chat-language-model.ts",
    "src/sdk/copilot/responses/openai-responses-language-model.ts"
]

for file in files:
    with open(file, "r") as f:
        content = f.read()
    content = content.replace("chunk.error", "(chunk as any).error")
    with open(file, "w") as f:
        f.write(content)

file3 = "src/sdk/copilot/responses/tool/file-search.ts"
with open(file3, "r") as f:
    content = f.read()
content = content.replace("export const fileSearchToolSchema: FlexibleSchema<{", "export const fileSearchToolSchema: any = z.object({ // @ts-ignore")
with open(file3, "w") as f:
    f.write(content)

