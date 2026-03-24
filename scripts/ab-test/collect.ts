import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "fs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface KolEntry {
  handle: string;
  actual_price_usd: number;
  category: string;
  notes?: string;
}

interface SoulDensityData {
  content_analysis: number;
  engagement_analysis: number;
  handle: string;
  kol_interaction: number;
  name: string;
  profile_analysis: number;
  reason: string;
  reason_en: string;
  score: number;
  xhunt_analysis: number;
}

interface ClaudeCredibility {
  authenticity: number;
  content_quality: number;
  engagement_legitimacy: number;
  influence_credibility: number;
  composite: number;
  reasoning: string;
}

interface TwitterUserData {
  username: string;
  name: string;
  description: string;
  followers_count: number;
  following_count: number;
  tweet_count: number;
  created_at: string;
  is_blue_verified: boolean;
  classification?: string;
  isKol?: boolean;
}

interface CollectResult {
  handle: string;
  actual_price_usd: number;
  category: string;
  profile: TwitterUserData | null;
  optionA: {
    raw_score: number | null;
    mapped_score: number;
    sub_dimensions: Partial<SoulDensityData> | null;
    reason_en: string | null;
  };
  optionB: {
    composite: number | null;
    sub_dimensions: Partial<ClaudeCredibility> | null;
    reasoning: string | null;
  };
  collected_at: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const XHUNT_API_BASE = "https://kb.cryptohunt.ai/api/xhunt/proxy/public";
const XHUNT_TIMEOUT_MS = 10_000;

// ─── XHunt Score Mapping (same as KOL-Pricer) ───────────────────────────────

function mapXHuntScore(soulScore: number | null): number {
  if (soulScore == null) return 50;
  if (soulScore >= 80) return 100;
  if (soulScore >= 60) return 80;
  if (soulScore >= 40) return 60;
  if (soulScore >= 20) return 40;
  return 20;
}

// ─── Step 1: Fetch Twitter profile via XHunt public API ──────────────────────

async function fetchProfile(handle: string): Promise<TwitterUserData | null> {
  try {
    const resp = await axios.get(
      `${XHUNT_API_BASE}/fetch/twitter/user?username=${handle.toLowerCase()}&target=k8s_kota`,
      { timeout: XHUNT_TIMEOUT_MS }
    );
    const data = resp.data?.data?.data;
    if (!data) return null;
    return {
      username: data.username || handle,
      name: data.name || "",
      description: data.description || "",
      followers_count: data.public_metrics?.followers_count ?? data.followers_count ?? 0,
      following_count: data.public_metrics?.following_count ?? data.following_count ?? 0,
      tweet_count: data.public_metrics?.tweet_count ?? data.tweet_count ?? 0,
      created_at: data.created_at || "",
      is_blue_verified: data.is_blue_verified ?? false,
      classification: data.ai?.classification ?? data.classification ?? "",
      isKol: data.isKol ?? false,
    };
  } catch (err) {
    console.warn(`  [Profile] Failed for @${handle}:`, (err as Error).message);
    return null;
  }
}

// ─── Step 2: Option A — XHunt Soul Score ─────────────────────────────────────

async function fetchOptionA(
  handle: string
): Promise<SoulDensityData | null> {
  try {
    const resp = await axios.post(
      `${XHUNT_API_BASE}/pro/api/soul?target=k8s_kota`,
      { handle: handle.toLowerCase() },
      {
        headers: { "Content-Type": "application/json" },
        timeout: XHUNT_TIMEOUT_MS,
      }
    );
    const data = resp.data;
    if (data && data.score != null) return data as SoulDensityData;
    return null;
  } catch (err) {
    console.warn(`  [Option A] Failed for @${handle}:`, (err as Error).message);
    return null;
  }
}

// ─── Step 3: Option B — Claude Credibility Score ─────────────────────────────

function buildClaudePrompt(handle: string, profile: TwitterUserData): string {
  return `You are an expert crypto KOL credibility analyst. Given the following Twitter account data, assess the KOL's credibility for paid promotions.

Account: @${handle}
Name: ${profile.name}
Followers: ${profile.followers_count.toLocaleString()} | Following: ${profile.following_count.toLocaleString()}
Tweets: ${profile.tweet_count.toLocaleString()} | Account created: ${profile.created_at}
Bio: ${profile.description}
Classification: ${profile.classification || "unknown"}
Verified: ${profile.is_blue_verified}
Is KOL (XHunt): ${profile.isKol}

Evaluate these dimensions and respond ONLY in this exact JSON format, no other text:
{
  "authenticity": <number 0-100>,
  "content_quality": <number 0-100>,
  "engagement_legitimacy": <number 0-100>,
  "influence_credibility": <number 0-100>,
  "composite": <number 0-100, weighted average>,
  "reasoning": "<1-2 sentence explanation>"
}`;
}

async function fetchOptionB(
  handle: string,
  profile: TwitterUserData,
  anthropic: Anthropic
): Promise<ClaudeCredibility | null> {
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      messages: [
        { role: "user", content: buildClaudePrompt(handle, profile) },
      ],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const parsed = JSON.parse(text) as ClaudeCredibility;

    if (parsed.composite == null) return null;
    return parsed;
  } catch (err) {
    console.warn(`  [Option B] Failed for @${handle}:`, (err as Error).message);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Load KOL list
  const kols: KolEntry[] = JSON.parse(
    readFileSync("kol-handles.json", "utf-8")
  );

  // Validate
  const valid = kols.filter(
    (k) => k.handle && !k.handle.startsWith("REPLACE")
  );
  if (valid.length === 0) {
    console.error(
      "❌ No valid KOL handles found. Edit kol-handles.json first!"
    );
    console.error(
      '   Replace "REPLACE_WITH_REAL_HANDLE_X" with actual Twitter handles.'
    );
    process.exit(1);
  }

  console.log(`\n🔍 A/B Test: Collecting scores for ${valid.length} KOLs\n`);

  // Init Claude client (only if API key exists)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let anthropic: Anthropic | null = null;
  if (apiKey) {
    anthropic = new Anthropic({ apiKey });
    console.log("✅ Claude API key found — Option B enabled");
  } else {
    console.log(
      "⚠️  No ANTHROPIC_API_KEY — Option B (Claude) will be skipped"
    );
    console.log(
      "   Set it with: ANTHROPIC_API_KEY=sk-... npx tsx collect.ts\n"
    );
  }

  const results: CollectResult[] = [];

  for (let i = 0; i < valid.length; i++) {
    const kol = valid[i];
    console.log(
      `\n[${i + 1}/${valid.length}] @${kol.handle} (actual: $${kol.actual_price_usd})`
    );

    // Fetch profile
    console.log("  📋 Fetching profile...");
    const profile = await fetchProfile(kol.handle);
    if (profile) {
      console.log(
        `  ✅ ${profile.name} — ${profile.followers_count.toLocaleString()} followers`
      );
    } else {
      console.log("  ⚠️  Profile not found, continuing with limited data");
    }

    // Option A: XHunt Soul Score
    console.log("  🅰️  Fetching XHunt Soul Score...");
    const soulData = await fetchOptionA(kol.handle);
    const optionA = {
      raw_score: soulData?.score ?? null,
      mapped_score: mapXHuntScore(soulData?.score ?? null),
      sub_dimensions: soulData
        ? {
            content_analysis: soulData.content_analysis,
            engagement_analysis: soulData.engagement_analysis,
            kol_interaction: soulData.kol_interaction,
            profile_analysis: soulData.profile_analysis,
            xhunt_analysis: soulData.xhunt_analysis,
          }
        : null,
      reason_en: soulData?.reason_en ?? null,
    };
    if (soulData) {
      console.log(`  ✅ Soul Score: ${soulData.score}/100`);
    } else {
      console.log("  ⚠️  XHunt data unavailable (using neutral: 50)");
    }

    // Option B: Claude Credibility Score
    let optionB: CollectResult["optionB"] = {
      composite: null,
      sub_dimensions: null,
      reasoning: null,
    };

    if (anthropic && profile) {
      console.log("  🅱️  Fetching Claude Credibility Score...");
      const claudeData = await fetchOptionB(kol.handle, profile, anthropic);
      if (claudeData) {
        optionB = {
          composite: claudeData.composite,
          sub_dimensions: {
            authenticity: claudeData.authenticity,
            content_quality: claudeData.content_quality,
            engagement_legitimacy: claudeData.engagement_legitimacy,
            influence_credibility: claudeData.influence_credibility,
          },
          reasoning: claudeData.reasoning,
        };
        console.log(
          `  ✅ Claude Score: ${claudeData.composite}/100 — ${claudeData.reasoning}`
        );
      } else {
        console.log("  ⚠️  Claude scoring failed");
      }
    }

    results.push({
      handle: kol.handle,
      actual_price_usd: kol.actual_price_usd,
      category: kol.category,
      profile,
      optionA,
      optionB,
      collected_at: new Date().toISOString(),
    });

    // Rate limit pause between requests
    if (i < valid.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // Save results
  writeFileSync("results.json", JSON.stringify(results, null, 2));
  console.log(`\n✅ Results saved to results.json (${results.length} KOLs)`);
  console.log("   Run: npx tsx analyze.ts to compare Option A vs Option B\n");
}

main().catch(console.error);
