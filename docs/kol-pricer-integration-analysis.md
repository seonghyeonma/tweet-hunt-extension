# KOL-Pricer x XHunt Integration Analysis

## 1. KOL-Pricer Scoring System (Current)

### 5-Dimension Scoring (0-100 each)

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Follower Scale | 0.20 | Tiered by follower count (5k/10k/20k/50k/100k+) |
| Follower Quality | 0.25 | Based on engagement rate (%) |
| Update Stability | 0.15 | Coefficient of variation of posting intervals |
| Impression Stability | 0.20 | CV of impression counts |
| Engagement Rate | 0.20 | (likes+replies+retweets+quotes) / followers |

**Overall Score** = weighted sum (0-100)

### Pricing Formula

```
CPM = 10 + (overallScore / 100) * 90    // $10 ~ $100
price = (CPM * avgImpressions * domainMultiplier) / 1000
priceMin = price * 0.8
priceMax = price * 1.2
```

**Domain Multipliers:** crypto: 1.4, finance: 1.4, tech: 1.3, business: 1.2, entertainment: 1.0, other: 1.0

---

## 2. XHunt Available API Data

### Soul Density API
- **Endpoint:** `POST /api/xhunt/proxy/public/pro/api/soul`
- **Request:** `{ "handle": "<twitter_username>" }`
- **Response:** `SoulDensityData`

```typescript
interface SoulDensityData {
  content_analysis: number;      // Content quality (0-100)
  engagement_analysis: number;   // Engagement authenticity (0-100)
  kol_interaction: number;       // KOL social graph (0-100)
  profile_analysis: number;      // Profile authenticity (0-100)
  xhunt_analysis: number;        // XHunt rank/influence (0-100)
  handle: string;
  name: string;
  reason: string;                // Chinese analysis explanation
  reason_en: string;             // English analysis explanation
  score: number;                 // Overall composite score (0-100)
}
```

### Twitter User Info API
- **Endpoint:** `GET /api/xhunt/proxy/public/fetch/twitter/user?username=<handle>`
- **Response:** `NewTwitterUserData` (includes rank, classification, features)

---

## 3. Integration Plan: Option A (6th Scoring Dimension, 15% Weight)

### Weight Redistribution

| Dimension | Current Weight | New Weight | Change |
|-----------|---------------|------------|--------|
| Follower Scale | 0.20 | 0.17 | -0.03 |
| Follower Quality | 0.25 | 0.22 | -0.03 |
| Update Stability | 0.15 | 0.13 | -0.02 |
| Impression Stability | 0.20 | 0.17 | -0.03 |
| Engagement Rate | 0.20 | 0.16 | -0.04 |
| **XHunt Score (NEW)** | - | **0.15** | +0.15 |
| **Total** | 1.00 | 1.00 | 0.00 |

### XHunt Score Mapping (0-100)

The `SoulDensityData.score` maps directly to 0-100 scale:
- score >= 80 → 100 (Excellent authenticity & influence)
- score >= 60 → 80 (Good)
- score >= 40 → 60 (Average)
- score >= 20 → 40 (Below average)
- score < 20 → 20 (Low)

### Fallback Strategy

If XHunt API is unavailable or returns no data:
- Use neutral score of 50 (no impact on pricing)
- Log warning but don't block the analysis flow

---

## 4. Required Code Changes in KOL-Pricer

### 4.1 `src/lib/types.ts` - Add XHunt fields

```typescript
// Add to ScoreBreakdown interface
export interface ScoreBreakdown {
  followerScale: number;
  followerQuality: number;
  updateStability: number;
  impressionStability: number;
  engagementRate: number;
  xhuntScore: number;       // NEW
  overall: number;
}

// Add XHunt data type
export interface XHuntSoulData {
  score: number;
  content_analysis: number;
  engagement_analysis: number;
  kol_interaction: number;
  profile_analysis: number;
  xhunt_analysis: number;
  reason_en: string;
}
```

### 4.2 `src/lib/constants.ts` - Update weights

```typescript
// Updated weights
export const SCORE_WEIGHTS = {
  followerScale: 0.17,
  followerQuality: 0.22,
  updateStability: 0.13,
  impressionStability: 0.17,
  engagementRate: 0.16,
  xhuntScore: 0.15,          // NEW
} as const;
```

### 4.3 `src/lib/xhunt-api.ts` - New file for XHunt API calls

```typescript
const XHUNT_API_BASE = 'https://kb.cryptohunt.ai/api/xhunt/proxy/public';

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
    const response = await fetch(`${XHUNT_API_BASE}/pro/api/soul?target=k8s_kota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: handle.toLowerCase() }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data && data.score != null) {
      return data;
    }
    return null;
  } catch (error) {
    console.warn(`Failed to fetch XHunt soul score for ${handle}:`, error);
    return null;
  }
}
```

### 4.4 `src/lib/scoring.ts` - Integrate XHunt score

```typescript
// Add new scoring function
function calculateXHuntScore(soulScore: number | null): number {
  if (soulScore == null) return 50; // Neutral fallback

  if (soulScore >= 80) return 100;
  if (soulScore >= 60) return 80;
  if (soulScore >= 40) return 60;
  if (soulScore >= 20) return 40;
  return 20;
}

// Update calculateScores function
export function calculateScores(
  user: TwitterUser,
  tweets: Tweet[],
  xhuntSoulScore: number | null = null
): ScoreBreakdown {
  const followerScale = calculateFollowerScale(user.followers_count);
  const followerQuality = calculateFollowerQuality(tweets, user.followers_count);
  const updateStability = calculateUpdateStability(tweets);
  const impressionStability = calculateImpressionStability(tweets);
  const engagementRate = calculateEngagementRate(tweets, user.followers_count);
  const xhuntScore = calculateXHuntScore(xhuntSoulScore);

  const overall =
    followerScale * SCORE_WEIGHTS.followerScale +
    followerQuality * SCORE_WEIGHTS.followerQuality +
    updateStability * SCORE_WEIGHTS.updateStability +
    impressionStability * SCORE_WEIGHTS.impressionStability +
    engagementRate * SCORE_WEIGHTS.engagementRate +
    xhuntScore * SCORE_WEIGHTS.xhuntScore;

  return {
    followerScale,
    followerQuality,
    updateStability,
    impressionStability,
    engagementRate,
    xhuntScore,
    overall: Math.round(overall),
  };
}
```

### 4.5 `src/app/api/analyze/route.ts` - Add XHunt API call to pipeline

```typescript
import { fetchXHuntSoulScore } from '@/lib/xhunt-api';

// In the SSE streaming handler, add after tweet fetching:
// Step 4: Fetch XHunt soul score (parallel with domain detection)
const [domainResult, xhuntResult] = await Promise.all([
  detectDomain(user.description, tweetTexts),
  fetchXHuntSoulScore(username),
]);

// Step 5: Calculate scores with XHunt data
const scores = calculateScores(
  user,
  trimmedTweets,
  xhuntResult?.score ?? null
);
```

---

## 5. Impact Analysis

### Price Impact Examples

For a user with:
- 50k followers, 1.5% engagement, moderate stability
- avgImpressions: 10,000
- domain: crypto (1.4x multiplier)

| Scenario | XHunt Score | Overall Score | CPM | Price Range |
|----------|-------------|--------------|-----|-------------|
| Without XHunt | - | 68 | $71.2 | $79.7 - $119.6 |
| High XHunt (90) | 100 → 15pts | 72.8 | $75.5 | $84.6 - $126.9 |
| Medium XHunt (50) | 60 → 9pts | 68.2 | $71.4 | $79.9 - $119.9 |
| Low XHunt (15) | 20 → 3pts | 62.2 | $66.0 | $73.9 - $110.9 |

**Max price swing from XHunt:** ~15% impact on final price (matching the 15% weight).

---

## 6. API Availability & Rate Limiting

- XHunt Soul API is public (no auth required)
- Endpoint: `POST /api/xhunt/proxy/public/pro/api/soul?target=k8s_kota`
- Should implement timeout (3-5 seconds) to not block the main flow
- Graceful degradation: neutral score (50) if API fails
