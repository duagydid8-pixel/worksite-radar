interface StatCardProps {
  label: string;
  value: number | string;
  variant?: "default" | "late" | "uncheck" | "leave";
  unit?: string;
}

const variantStyles: Record<string, { card: string; value: string }> = {
  default: {
    card: "bg-card border-border",
    value: "text-foreground",
  },
  late: {
    card: "border-[#f5d9b8]",
    value: "text-[#854f0b]",
  },
  uncheck: {
    card: "border-[#f5c6c6]",
    value: "text-[#a32d2d]",
  },
  leave: {
    card: "border-[#c5d9f0]",
    value: "text-[#185fa5]",
  },
};

const variantBg: Record<string, string> = {
  default: "bg-card",
  late: "bg-[#faeeda]",
  uncheck: "bg-[#fcebeb]",
  leave: "bg-[#e6f1fb]",
};

export default function StatCard({ label, value, variant = "default", unit }: StatCardProps) {
  const style = variantStyles[variant];
  const bg = variantBg[variant];

  return (
    <div className={`rounded-xl border px-3 py-3 ${bg} ${style.card}`}>
      <p className="text-[10px] text-muted-foreground font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums leading-none ${style.value}`}>
        {value}
        {unit && <span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}
