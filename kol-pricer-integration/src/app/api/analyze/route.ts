import { NextRequest } from "next/server";
import { getUserByUsername, getUserTweets } from "@/lib/x-api";
import { detectDomain } from "@/lib/anthropic";
import { calculateScores, calculatePricing, trimOutliers } from "@/lib/scoring";
import { fetchXHuntSoulScore } from "@/lib/xhunt-api";
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "@/lib/constants";

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  rateLimitMap.forEach((entry, ip) => {
    if (now > entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  });
}, 5 * 60 * 1000);

function parseHandle(input: string): string {
  let handle = input.trim();
  // Handle x.com/username or twitter.com/username URLs
  const urlMatch = handle.match(
    /(?:x\.com|twitter\.com)\/(@?[\w]+)/i
  );
  if (urlMatch) {
    handle = urlMatch[1];
  }
  // Remove @ prefix
  handle = handle.replace(/^@/, "");
  return handle;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded. Please wait a minute and try again.",
      }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  let handle: string;
  try {
    const body = await req.json();
    handle = parseHandle(body.handle || "");
    if (!handle) {
      return new Response(
        JSON.stringify({ error: "Please provide a valid X handle" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendLog(message: string, type: "info" | "success" | "error" = "info") {
        const data = JSON.stringify({
          type: "log",
          log: { timestamp: new Date().toISOString(), message, type },
        });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      function sendResult(result: unknown) {
        const data = JSON.stringify({ type: "result", data: result });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      function sendError(error: string) {
        const data = JSON.stringify({ type: "error", error });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      try {
        // Step 1: Fetch user profile
        sendLog(`Fetching profile for @${handle}...`);
        const user = await getUserByUsername(handle);
        sendLog(
          `Found @${user.username} \u2014 ${user.public_metrics.followers_count.toLocaleString()} followers`,
          "success"
        );

        // Step 2: Fetch recent tweets
        sendLog("Fetching recent tweets...");
        const tweets = await getUserTweets(user.id, 30);
        if (tweets.length === 0) {
          sendError("No tweets found for this user");
          controller.close();
          return;
        }
        sendLog(`Loaded ${tweets.length} recent tweets`, "success");

        // Step 3: Trim outliers
        const trimmed = trimOutliers(tweets, 2);
        sendLog(
          `Trimmed ${tweets.length - trimmed.length} outlier tweets (top/bottom by impressions), using ${trimmed.length} for scoring`,
          "success"
        );

        // Step 4: Domain detection + XHunt score (parallel)
        sendLog("Analyzing domain with AI & fetching XHunt Soul Score...");
        const tweetTexts = tweets.map((t) => t.text);
        const [domain, xhuntResult] = await Promise.all([
          detectDomain(user.description || "", tweetTexts),
          fetchXHuntSoulScore(handle),
        ]);
        sendLog(`Domain identified: ${domain}`, "success");
        if (xhuntResult) {
          sendLog(
            `XHunt Soul Score: ${xhuntResult.score}/100 (${xhuntResult.reason_en?.slice(0, 80) || "N/A"})`,
            "success"
          );
        } else {
          sendLog(
            "XHunt data unavailable \u2014 using neutral score (50)",
            "info"
          );
        }

        // Step 5: Calculate scores (with XHunt)
        sendLog("Calculating scores...");
        const scores = calculateScores(
          user.public_metrics.followers_count,
          trimmed,
          xhuntResult?.score ?? null
        );
        sendLog(
          `Overall score: ${scores.overall.toFixed(1)}/100`,
          "success"
        );

        // Step 6: Calculate pricing
        sendLog("Computing pricing...");
        const pricing = calculatePricing(
          scores,
          trimmed,
          user.public_metrics.followers_count,
          domain
        );
        sendLog(
          `Estimated price: $${pricing.price.toLocaleString()}`,
          "success"
        );

        // Send final result
        sendResult({
          user,
          tweets,
          domain,
          scores,
          pricing,
          analyzedAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendError(message);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
