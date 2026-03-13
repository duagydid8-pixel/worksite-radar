interface StatCardProps {
  label: string;
  value: number;
  variant?: "default" | "yellow" | "teal";
  icon?: string;
}

export default function StatCard({ label, value, variant = "default", icon }: StatCardProps) {
  const valueClass =
    variant === "yellow" ? "text-yellow-400"
    : variant === "teal" ? "text-secondary"
    : "text-foreground";

  return (
    <div className="flex-1 min-w-[100px] rounded-lg bg-card border border-border px-4 py-2.5 flex items-center gap-2.5">
      {icon && <span className="text-base">{icon}</span>}
      <div>
        <p className={`text-lg font-bold tabular-nums leading-none ${valueClass}`}>{value}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}
