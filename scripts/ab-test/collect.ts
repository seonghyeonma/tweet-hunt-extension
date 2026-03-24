import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";

// Load .env file if present
if (existsSync(".env")) {
  const envContent = readFileSync(".env", "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface KolEntry {
  handle: string;
  actual_price_usd: number;
  category: string;
  notes?: string;
}

interface SoulIndexData {
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

interface ClaudeCredibility {
  authenticity: number;
  content_quality: number;
  engagement_legitimacy: number;
  influence_credibility: number;
  composite: number;
  reasoning: string;
}

interface TwitterProfile {
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
  profile: TwitterProfile | null;
  optionA: {
    raw_score: number | null;
    mapped_score: number;
    sub_dimensions: Record<string, number> | null;
    reason_en: string | null;
  };
  optionB: {
    composite: number | null;
    sub_dimensions: Record<string, number> | null;
    reasoning: string | null;
  };
  collected_at: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const XCLAW_API_BASE = "https://pro.xclaw.info";
const XCLAW_TIMEOUT_MS = 30_000;

// ─── XHunt Score Mapping (same as KOL-Pricer) ───────────────────────────────

function mapXHuntScore(soulScore: number | null): number {
  if (soulScore == null) return 50;
  if (soulScore >= 80) return 100;
  if (soulScore >= 60) return 80;
  if (soulScore >= 40) return 60;
  if (soulScore >= 20) return 40;
  return 20;
}

// ─── XClaw API helper ────────────────────────────────────────────────────────

function getXClawHeaders(): Record<string, string> {
  const apiKey = process.env.XCLAW_API_KEY;
  if (!apiKey) throw new Error("XCLAW_API_KEY not set");
  return {
    "X-API-KEY": apiKey,
    "Content-Type": "application/json",
  };
}

// ─── Step 1: Fetch Twitter profile via XClaw API ─────────────────────────────

async function fetchProfile(handle: string): Promise<TwitterProfile | null> {
  try {
    const resp = await axios.post(
      `${XCLAW_API_BASE}/user/profile_by_handle`,
      { handle: handle.toLowerCase() },
      { headers: getXClawHeaders(), timeout: XCLAW_TIMEOUT_MS }
    );
    const data = resp.data;
    if (!data) return null;

    // Extract profile data (adapt to actual response structure)
    const profile = data.data || data.result || data;
    return {
      username: profile.username || profile.screen_name || handle,
      name: profile.name || "",
      description: profile.description || profile.bio || "",
      followers_count: profile.followers_count ?? profile.public_metrics?.followers_count ?? 0,
      following_count: profile.following_count ?? profile.public_metrics?.following_count ?? 0,
      tweet_count: profile.tweet_count ?? profile.statuses_count ?? profile.public_metrics?.tweet_count ?? 0,
      created_at: profile.created_at || "",
      is_blue_verified: profile.is_blue_verified ?? profile.verified ?? false,
      classification: profile.classification || profile.ai?.classification || "",
      isKol: profile.isKol ?? profile.is_kol ?? false,
    };
  } catch (err) {
    console.warn(`  [Profile] Failed for @${handle}:`, (err as Error).message);
    return null;
  }
}

// ─── Step 2: Option A — XClaw Soul Index ─────────────────────────────────────

async function fetchOptionA(handle: string): Promise<SoulIndexData | null> {
  try {
    const resp = await axios.post(
      `${XCLAW_API_BASE}/ai/soul_index`,
      { handle: handle.toLowerCase() },
      { headers: getXClawHeaders(), timeout: XCLAW_TIMEOUT_MS }
    );
    const data = resp.data;
    // Handle nested response structures
    const result = data?.data || data?.result || data;
    if (result && result.score != null) return result as SoulIndexData;
    return null;
  } catch (err) {
    console.warn(`  [Option A] Failed for @${handle}:`, (err as Error).message);
    return null;
  }
}

// ─── Step 3: Option B — Claude Credibility Score ─────────────────────────────

function buildClaudePrompt(handle: string, profile: TwitterProfile): string {
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
  profile: TwitterProfile,
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
    // Extract JSON even if wrapped in markdown code fences
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as ClaudeCredibility;

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
    process.exit(1);
  }

  console.log(`\n🔍 A/B Test: Collecting scores for ${valid.length} KOLs\n`);

  // Check XClaw API key
  const xclawKey = process.env.XCLAW_API_KEY;
  if (!xclawKey) {
    console.error("❌ XCLAW_API_KEY not found in .env");
    console.error("   Add XCLAW_API_KEY=your_key to .env file");
    process.exit(1);
  }
  console.log("✅ XClaw API key found — Option A enabled");

  // Init Claude client (only if API key exists)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  let anthropic: Anthropic | null = null;
  if (anthropicKey) {
    anthropic = new Anthropic({ apiKey: anthropicKey });
    console.log("✅ Claude API key found — Option B enabled");
  } else {
    console.log(
      "⚠️  No ANTHROPIC_API_KEY — Option B (Claude) will be skipped"
    );
  }

  // Estimate credits: 1.1 per KOL (soul_index=1 + profile=0.1)
  const estimatedCredits = valid.length * 1.1;
  console.log(`\n📊 Estimated XClaw credits: ~${estimatedCredits.toFixed(1)} credits for ${valid.length} KOLs`);

  const results: CollectResult[] = [];

  for (let i = 0; i < valid.length; i++) {
    const kol = valid[i];
    console.log(
      `\n[${i + 1}/${valid.length}] @${kol.handle} (actual: $${kol.actual_price_usd})`
    );

    // Fetch profile via XClaw (0.1 credit)
    console.log("  📋 Fetching profile...");
    const profile = await fetchProfile(kol.handle);
    if (profile) {
      console.log(
        `  ✅ ${profile.name} — ${profile.followers_count.toLocaleString()} followers`
      );
    } else {
      console.log("  ⚠️  Profile not found, continuing with limited data");
    }

    // Option A: XClaw Soul Index (1 credit)
    console.log("  🅰️  Fetching XClaw Soul Index...");
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
      console.log("  ⚠️  Soul Index unavailable (using neutral: 50)");
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

    // Rate limit pause (10 req/min for profile endpoint = 6s between requests)
    if (i < valid.length - 1) {
      console.log("  ⏳ Waiting 6s (rate limit)...");
      await new Promise((r) => setTimeout(r, 6000));
    }
  }

  // Save results
  writeFileSync("results.json", JSON.stringify(results, null, 2));
  console.log(`\n✅ Results saved to results.json (${results.length} KOLs)`);
  console.log("   Run: npx tsx analyze.ts to compare Option A vs Option B\n");
}

main().catch(console.error);
