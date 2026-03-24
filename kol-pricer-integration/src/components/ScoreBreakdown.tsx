import { ScoreBreakdown as ScoreBreakdownType } from "@/lib/types";
import ScoreBar from "./ScoreBar";
import Card from "./Card";

interface Props {
  scores: ScoreBreakdownType;
}

const LABELS: { key: keyof Omit<ScoreBreakdownType, "overall">; label: string; weight: string }[] = [
  { key: "followerScale", label: "Follower Scale", weight: "17%" },
  { key: "followerQuality", label: "Follower Quality (ER)", weight: "22%" },
  { key: "updateStability", label: "Update Stability", weight: "13%" },
  { key: "impressionStability", label: "Impression Stability", weight: "17%" },
  { key: "engagementRate", label: "Engagement Rate", weight: "16%" },
  { key: "xhuntScore", label: "XHunt Soul Score", weight: "15%" },
];

export default function ScoreBreakdown({ scores }: Props) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-outfit text-lg font-semibold text-white">
          Score Breakdown
        </h3>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-3xl font-bold text-brand">
            {scores.overall.toFixed(1)}
          </span>
          <span className="text-sm text-gray-500">/100</span>
        </div>
      </div>
      <div className="space-y-3">
        {LABELS.map(({ key, label, weight }) => (
          <ScoreBar
            key={key}
            label={`${label} (${weight})`}
            score={scores[key]}
          />
        ))}
      </div>
    </Card>
  );
}
