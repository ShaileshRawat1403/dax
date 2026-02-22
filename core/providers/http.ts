export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const timeoutMs = Number(process.env.DAX_PROVIDER_TIMEOUT_MS || 30000);
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}
