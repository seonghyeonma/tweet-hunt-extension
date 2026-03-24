const XHUNT_API_BASE = "https://kb.cryptohunt.ai/api/xhunt/proxy/public";
const XHUNT_TIMEOUT_MS = 15000; // Increased from 5s — XHunt API can be slow
const XHUNT_MAX_RETRIES = 2;

export interface XHuntSoulResponse {
  score: number;
  content_analysis: number;
  engagement_analysis: number;
  kol_interaction: number;
  profile_analysis: number;
  xhunt_analysis: number;
  handle: string;
  name: string;
  reason: string;
  reason_en: string;
}

function extractSoulData(data: unknown): XHuntSoulResponse | null {
  if (!data || typeof data !== "object") return null;

  // Direct response: { score, handle, ... }
  const obj = data as Record<string, unknown>;
  if (obj.score != null) return obj as unknown as XHuntSoulResponse;

  // Nested response: { data: { score, handle, ... } }
  if (obj.data && typeof obj.data === "object") {
    const nested = obj.data as Record<string, unknown>;
    if (nested.score != null) return nested as unknown as XHuntSoulResponse;
  }

  // Nested response: { result: { score, handle, ... } }
  if (obj.result && typeof obj.result === "object") {
    const nested = obj.result as Record<string, unknown>;
    if (nested.score != null) return nested as unknown as XHuntSoulResponse;
  }

  return null;
}

async function fetchWithRetry(
  handle: string,
  attempt: number = 0
): Promise<XHuntSoulResponse | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), XHUNT_TIMEOUT_MS);

    const response = await fetch(
      `${XHUNT_API_BASE}/pro/api/soul?target=k8s_kota`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: handle.toLowerCase() }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[XHunt] HTTP ${response.status} for ${handle}`);
      if (attempt < XHUNT_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        return fetchWithRetry(handle, attempt + 1);
      }
      return null;
    }

    const data = await response.json();
    const result = extractSoulData(data);
    if (result) return result;

    console.warn(`[XHunt] Unexpected response structure for ${handle}:`, JSON.stringify(data).slice(0, 200));
    return null;
  } catch (error) {
    console.warn(`[XHunt] Attempt ${attempt + 1} failed for ${handle}:`, error);
    if (attempt < XHUNT_MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      return fetchWithRetry(handle, attempt + 1);
    }
    return null;
  }
}

export async function fetchXHuntSoulScore(
  handle: string
): Promise<XHuntSoulResponse | null> {
  return fetchWithRetry(handle);
}
