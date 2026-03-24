import { Domain } from "./types";

export const SCORE_WEIGHTS = {
  followerScale: 0.17,
  followerQuality: 0.22,
  updateStability: 0.13,
  impressionStability: 0.17,
  engagementRate: 0.16,
  xhuntScore: 0.15,
} as const;

export const DOMAIN_MULTIPLIERS: Record<Domain, number> = {
  crypto: 1.4,
  tech: 1.3,
  finance: 1.4,
  business: 1.2,
  entertainment: 1.0,
  other: 1.0,
};

export const DOMAIN_LABELS: Record<Domain, string> = {
  crypto: "Crypto / Web3",
  tech: "Technology",
  finance: "Finance",
  business: "Business",
  entertainment: "Entertainment",
  other: "Other",
};

export const BASE_CPM = 10;
export const MAX_CPM_BONUS = 90;

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 5;

export const X_API_TIMEOUT_MS = 30_000;
