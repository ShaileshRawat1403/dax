import re

with open("provider.ts", "r") as f:
    content = f.read()

# Replace Env.get with injectedEnv?.get
content = re.sub(r'Env\.get\((.*?)\)', r'(injectedEnv?.get(\1) ?? process.env[\1])', content)

# Replace Env.all() with injectedEnv?.all()
content = re.sub(r'Env\.all\(\)', r'(injectedEnv?.all() ?? process.env)', content)

# Replace Auth.get with injectedAuth?.get
content = re.sub(r'Auth\.get\((.*?)\)', r'injectedAuth?.get(\1)', content)
content = re.sub(r'Auth\.all\(\)', r'(injectedAuth?.all() ?? Promise.resolve({}))', content)

# Replace Config.get with injectedConfig?.get
content = re.sub(r'Config\.get\(\)', r'(injectedConfig?.get() ?? Promise.resolve({}))', content)

# Replace Plugin.list() with injectedPlugins
content = re.sub(r'await Plugin\.list\(\)', r'injectedPlugins', content)

# Replace Installation.VERSION
content = re.sub(r'Installation\.VERSION', r'"1.0.0"', content)

# Replace Bun.hash.xxHash32
def replace_bun_hash(match):
    return "String(" + match.group(1) + ")" # Just stringifying it is a terrible hash but valid as a Map key.
    # Actually wait, a proper hash is better.
content = re.sub(r'Bun\.hash\.xxHash32\((.*?)\)', r'hashString(\1)', content)

# Add hashString function
hash_func = """
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
"""

if "function hashString" not in content:
    content = content.replace("export namespace Provider {", "export namespace Provider {\n" + hash_func)

with open("provider.ts", "w") as f:
    f.write(content)
