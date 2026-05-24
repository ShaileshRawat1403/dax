import re

with open("/Users/Shailesh/MYAIAGENTS/dax/packages/provider/src/provider.ts", "r") as f:
    content = f.read()

content = content.replace("LanguageModelV2", "LanguageModel")
content = content.replace("Object.entries(database)", "Object.entries(database as any)")
content = content.replace("Object.entries(provider.models)", "Object.entries(provider.models as any)")
content = content.replace("Object.entries(providers)", "Object.entries(providers as any)")
content = content.replace("Object.entries(configProviders)", "Object.entries(configProviders as any)")
content = content.replace("Object.entries(config.provider ?? {})", "Object.entries(config.provider ?? {} as any)")
content = content.replace("Object.entries(await (injectedAuth?.all() ?? Promise.resolve({})))", "Object.entries(await (injectedAuth?.all() ?? Promise.resolve({})) as any)")

with open("/Users/Shailesh/MYAIAGENTS/dax/packages/provider/src/provider.ts", "w") as f:
    f.write(content)
