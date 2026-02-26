/**
 * Lightweight HTTP utility with retry and timeout support.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

export async function fetchJSON(url, options = {}) {
  const { timeout = DEFAULT_TIMEOUT_MS, retries = MAX_RETRIES, headers = {} } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json', ...headers },
      });
      clearTimeout(timer);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries && err.name !== 'AbortError') {
        await sleep(300 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
