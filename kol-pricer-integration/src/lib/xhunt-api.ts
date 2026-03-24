const XHUNT_API_BASE = "https://kb.cryptohunt.ai/api/xhunt/proxy/public";
const XHUNT_TIMEOUT_MS = 5000;

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

export async function fetchXHuntSoulScore(
  handle: string
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

    if (!response.ok) return null;

    const data = await response.json();
    if (data && data.score != null) {
      return data as XHuntSoulResponse;
    }
    return null;
  } catch (error) {
    console.warn(`[XHunt] Failed to fetch soul score for ${handle}:`, error);
    return null;
  }
}
