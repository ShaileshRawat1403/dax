import re

with open("/Users/Shailesh/MYAIAGENTS/dax/packages/provider/src/provider.ts", "r") as f:
    content = f.read()

# Replace variables in loops with `as any`
content = content.replace("for (const [providerID, provider] of Object.entries(database as any)) {", "for (const [providerID, p] of Object.entries(database as any)) { const provider = p as any;")
content = content.replace("for (const [providerID, provider] of Object.entries(configProviders as any)) {", "for (const [providerID, p] of Object.entries(configProviders as any)) { const provider = p as any;")
content = content.replace("for (const [providerID, provider] of Object.entries(providers as any)) {", "for (const [providerID, p] of Object.entries(providers as any)) { const provider = p as any;")
content = content.replace("for (const [providerID, provider] of Object.entries(await (injectedAuth?.all() ?? Promise.resolve({})) as any)) {", "for (const [providerID, p] of Object.entries(await (injectedAuth?.all() ?? Promise.resolve({})) as any)) { const provider = p as any;")

content = content.replace("for (const [modelID, model] of Object.entries(provider.models)) {", "for (const [modelID, m] of Object.entries(provider.models as any)) { const model = m as any;")
content = content.replace("for (const [modelID, model] of Object.entries(provider.models ?? {})) {", "for (const [modelID, m] of Object.entries(provider.models ?? {} as any)) { const model = m as any;")

with open("/Users/Shailesh/MYAIAGENTS/dax/packages/provider/src/provider.ts", "w") as f:
    f.write(content)

file_search = "/Users/Shailesh/MYAIAGENTS/dax/packages/provider/src/sdk/copilot/responses/tool/file-search.ts"
with open(file_search, "r") as f:
    content2 = f.read()

content2 = content2.replace("export const fileSearchToolSchema: any = z.object({ // @ts-ignore", "export const fileSearchToolSchema = z.object({")
content2 = content2.replace("export const fileSearchToolSchema = z.object({", "export const fileSearchToolSchema: any = z.object({")
with open(file_search, "w") as f:
    f.write(content2)

