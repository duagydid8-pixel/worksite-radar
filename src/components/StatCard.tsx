interface StatCardProps {
  label: string;
  value: number;
  variant?: "default" | "warning" | "danger";
}

export default function StatCard({ label, value, variant = "default" }: StatCardProps) {
  const valueClass = variant === "warning"
    ? "text-warning"
    : variant === "danger"
    ? "text-destructive"
    : "text-foreground";

  return (
    <div className="rounded-lg bg-card px-4 py-3 min-w-[100px]">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}
