import { readFileSync } from "fs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CollectResult {
  handle: string;
  actual_price_usd: number;
  category: string;
  profile: {
    followers_count: number;
    [key: string]: unknown;
  } | null;
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
}

// ─── KOL-Pricer Pricing Formula ──────────────────────────────────────────────
// Replicated from kol-pricer-integration/src/lib/scoring.ts & constants.ts

const SCORE_WEIGHTS = {
  followerScale: 0.17,
  followerQuality: 0.22,
  updateStability: 0.13,
  impressionStability: 0.17,
  engagementRate: 0.16,
  xhuntScore: 0.15,
};

const DOMAIN_MULTIPLIERS: Record<string, number> = {
  crypto: 1.4,
  tech: 1.3,
  finance: 1.4,
  business: 1.2,
  entertainment: 1.0,
  other: 1.0,
};

const BASE_CPM = 10;
const MAX_CPM_BONUS = 90;

/**
 * Simplified price estimation.
 * Since we don't have tweet-level data in this test, we estimate using:
 * - The credibility score (Option A or B) as the 6th dimension
 * - A baseline score of 60 for the other 5 dimensions (reasonable average)
 * - Follower count to estimate average impressions (~2% of followers)
 */
function estimatePrice(
  credibilityScore: number,
  followers: number,
  domain: string
): { price: number; priceMin: number; priceMax: number } {
  const baselineOtherDimensions = 60; // reasonable average for other 5 dims

  const overall =
    baselineOtherDimensions *
      (SCORE_WEIGHTS.followerScale +
        SCORE_WEIGHTS.followerQuality +
        SCORE_WEIGHTS.updateStability +
        SCORE_WEIGHTS.impressionStability +
        SCORE_WEIGHTS.engagementRate) +
    credibilityScore * SCORE_WEIGHTS.xhuntScore;

  const cpm = BASE_CPM + (overall / 100) * MAX_CPM_BONUS;
  const avgImpressions = followers * 0.02; // ~2% impression rate estimate
  const domainMultiplier = DOMAIN_MULTIPLIERS[domain] ?? 1.0;
  const price = (cpm * avgImpressions * domainMultiplier) / 1000;

  return {
    price: Math.round(price * 100) / 100,
    priceMin: Math.round(price * 0.8 * 100) / 100,
    priceMax: Math.round(price * 1.2 * 100) / 100,
  };
}

// ─── Statistical Functions ───────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const diffX = x[i] - mx;
    const diffY = y[i] - my;
    num += diffX * diffY;
    dx += diffX * diffX;
    dy += diffY * diffY;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

function mae(predicted: number[], actual: number[]): number {
  let sum = 0;
  for (let i = 0; i < predicted.length; i++) {
    sum += Math.abs(predicted[i] - actual[i]);
  }
  return sum / predicted.length;
}

function mape(predicted: number[], actual: number[]): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < predicted.length; i++) {
    if (actual[i] !== 0) {
      sum += Math.abs((predicted[i] - actual[i]) / actual[i]);
      count++;
    }
  }
  return count > 0 ? (sum / count) * 100 : 0;
}

// ─── Main Analysis ───────────────────────────────────────────────────────────

function main() {
  let results: CollectResult[];
  try {
    results = JSON.parse(readFileSync("results.json", "utf-8"));
  } catch {
    console.error("❌ results.json not found. Run collect.ts first!");
    process.exit(1);
  }

  if (results.length === 0) {
    console.error("❌ No results to analyze.");
    process.exit(1);
  }

  console.log("\n" + "═".repeat(60));
  console.log("  A/B TEST RESULTS: XHunt Soul Score vs Claude Credibility");
  console.log("═".repeat(60));
  console.log(`\n  Sample size: ${results.length} KOLs\n`);

  // ── Per-KOL breakdown ──────────────────────────────────────────────────

  console.log("─".repeat(60));
  console.log(
    "  Handle".padEnd(22) +
      "Actual$".padEnd(10) +
      "A-Score".padEnd(10) +
      "A-Price".padEnd(10) +
      "B-Score".padEnd(10) +
      "B-Price"
  );
  console.log("─".repeat(60));

  const actualPrices: number[] = [];
  const optionAPrices: number[] = [];
  const optionBPrices: number[] = [];
  const optionAScores: number[] = [];
  const optionBScores: number[] = [];
  const optionAHits: boolean[] = [];
  const optionBHits: boolean[] = [];

  let hasOptionB = false;

  for (const r of results) {
    const followers = r.profile?.followers_count ?? 10000;
    const actual = r.actual_price_usd;

    // Option A
    const aScore = r.optionA.mapped_score;
    const aPricing = estimatePrice(aScore, followers, r.category);

    // Option B
    const bScore = r.optionB.composite;
    const bMapped = bScore != null ? bScore : 50; // neutral fallback
    const bPricing = estimatePrice(bMapped, followers, r.category);

    actualPrices.push(actual);
    optionAPrices.push(aPricing.price);
    optionAScores.push(aScore);
    optionAHits.push(actual >= aPricing.priceMin && actual <= aPricing.priceMax);

    if (bScore != null) {
      hasOptionB = true;
      optionBPrices.push(bPricing.price);
      optionBScores.push(bMapped);
      optionBHits.push(
        actual >= bPricing.priceMin && actual <= bPricing.priceMax
      );
    }

    const bScoreStr = bScore != null ? String(bScore) : "N/A";
    const bPriceStr =
      bScore != null ? `$${bPricing.price.toFixed(0)}` : "N/A";

    console.log(
      `  @${r.handle}`.padEnd(22) +
        `$${actual}`.padEnd(10) +
        `${aScore}`.padEnd(10) +
        `$${aPricing.price.toFixed(0)}`.padEnd(10) +
        `${bScoreStr}`.padEnd(10) +
        bPriceStr
    );
  }

  // ── Summary Statistics ─────────────────────────────────────────────────

  console.log("\n" + "═".repeat(60));
  console.log("  COMPARISON SUMMARY");
  console.log("═".repeat(60));

  // Option A stats
  const aMae = mae(optionAPrices, actualPrices);
  const aMape = mape(optionAPrices, actualPrices);
  const aCorr = pearsonCorrelation(optionAScores, actualPrices);
  const aHitRate =
    (optionAHits.filter(Boolean).length / optionAHits.length) * 100;

  console.log("\n  🅰️  Option A (XHunt Soul Score):");
  console.log(`     MAE (Mean Absolute Error):  $${aMae.toFixed(2)}`);
  console.log(`     MAPE (Mean Abs % Error):    ${aMape.toFixed(1)}%`);
  console.log(`     Correlation (score↔price):  ${aCorr.toFixed(3)}`);
  console.log(`     Price Range Hit Rate:       ${aHitRate.toFixed(1)}%`);

  if (hasOptionB && optionBPrices.length > 0) {
    const bActual = actualPrices.slice(0, optionBPrices.length);
    const bMae = mae(optionBPrices, bActual);
    const bMape = mape(optionBPrices, bActual);
    const bCorr = pearsonCorrelation(optionBScores, bActual);
    const bHitRate =
      (optionBHits.filter(Boolean).length / optionBHits.length) * 100;

    console.log("\n  🅱️  Option B (Claude Credibility Score):");
    console.log(`     MAE (Mean Absolute Error):  $${bMae.toFixed(2)}`);
    console.log(`     MAPE (Mean Abs % Error):    ${bMape.toFixed(1)}%`);
    console.log(`     Correlation (score↔price):  ${bCorr.toFixed(3)}`);
    console.log(`     Price Range Hit Rate:       ${bHitRate.toFixed(1)}%`);

    // ── Winner ─────────────────────────────────────────────────────────

    console.log("\n" + "═".repeat(60));
    console.log("  🏆 WINNER");
    console.log("═".repeat(60));

    const aWins =
      (aMae < bMae ? 1 : 0) +
      (aCorr > bCorr ? 1 : 0) +
      (aHitRate > bHitRate ? 1 : 0);
    const bWins = 3 - aWins;

    if (aWins > bWins) {
      console.log(
        `\n  Option A (XHunt) wins ${aWins}-${bWins}`
      );
      console.log("  → XHunt Soul Score is more accurate for pricing.\n");
    } else if (bWins > aWins) {
      console.log(
        `\n  Option B (Claude) wins ${bWins}-${aWins}`
      );
      console.log(
        "  → Claude Credibility Score is more accurate for pricing.\n"
      );
    } else {
      console.log("\n  It's a tie! Consider combining both (ensemble).\n");
    }

    // Delta summary
    console.log("  Delta:");
    console.log(
      `     MAE difference:    $${Math.abs(aMae - bMae).toFixed(2)} (${aMae < bMae ? "A" : "B"} better)`
    );
    console.log(
      `     Correlation diff:  ${Math.abs(aCorr - bCorr).toFixed(3)} (${aCorr > bCorr ? "A" : "B"} better)`
    );
    console.log(
      `     Hit Rate diff:     ${Math.abs(aHitRate - bHitRate).toFixed(1)}% (${aHitRate > bHitRate ? "A" : "B"} better)`
    );
  } else {
    console.log(
      "\n  ⚠️  Option B data not available. Set ANTHROPIC_API_KEY and re-run collect.ts."
    );
  }

  console.log("\n" + "═".repeat(60) + "\n");
}

main();
