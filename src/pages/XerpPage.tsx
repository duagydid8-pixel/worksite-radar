import { useState } from "react";
import XerpPmisTable from "@/components/XerpPmisTable";
import { useUI } from "@/hooks/useUI";

export default function XerpPage() {
  const { isAdmin } = useUI();
  const [xerpSite, setXerpSite] = useState<"PH4" | "PH2">("PH4");
  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-3">
      <div className="flex gap-2">
        {(["PH4", "PH2"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setXerpSite(s)}
            className={`px-5 py-2 rounded-xl text-sm font-bold transition-all border ${
              xerpSite === s
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-white text-muted-foreground border-border hover:bg-muted/50"
            }`}
          >
            P4-{s}
          </button>
        ))}
      </div>
      <XerpPmisTable isAdmin={isAdmin} site={xerpSite} key={xerpSite} />
    </div>
  );
}
