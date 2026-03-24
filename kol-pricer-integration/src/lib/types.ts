export interface XUserPublicMetrics {
  followers_count: number;
  following_count: number;
  tweet_count: number;
  listed_count: number;
}

export interface XUser {
  id: string;
  name: string;
  username: string;
  description: string;
  profile_image_url: string;
  created_at: string;
  public_metrics: XUserPublicMetrics;
}

export interface TweetPublicMetrics {
  like_count: number;
  reply_count: number;
  retweet_count: number;
  quote_count: number;
  impression_count: number;
}

export interface Tweet {
  id: string;
  text: string;
  created_at: string;
  public_metrics: TweetPublicMetrics;
}

export type Domain =
  | "crypto"
  | "tech"
  | "finance"
  | "business"
  | "entertainment"
  | "other";

export interface ScoreBreakdown {
  followerScale: number;
  followerQuality: number;
  updateStability: number;
  impressionStability: number;
  engagementRate: number;
  xhuntScore: number;
  overall: number;
}

export interface PricingResult {
  cpm: number;
  price: number;
  priceMin: number;
  priceMax: number;
  avgImpressions: number;
  avgEngagement: number;
  engagementRate: number;
  domainMultiplier: number;
}

export interface AnalysisResult {
  user: XUser;
  tweets: Tweet[];
  domain: Domain;
  scores: ScoreBreakdown;
  pricing: PricingResult;
  analyzedAt: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: "info" | "success" | "error";
}

export interface HistoryItem {
  handle: string;
  result: AnalysisResult;
  timestamp: string;
}
