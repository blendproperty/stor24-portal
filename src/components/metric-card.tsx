import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "default" | "orange" | "green" | "warning";
}) {
  return (
    <article className={`metric-card metric-card-${tone}`}>
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <span className={`metric-icon metric-icon-${tone}`}>
          <Icon size={18} />
        </span>
      </div>
      <p className="metric-value">{value}</p>
      <span className="metric-detail">{detail}</span>
    </article>
  );
}
