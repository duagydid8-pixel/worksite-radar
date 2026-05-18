import XerpWorkReflection from "@/components/XerpWorkReflection";
import { useUI } from "@/hooks/useUI";

export default function XerpReflectionPage() {
  const { isAdmin } = useUI();
  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <XerpWorkReflection isAdmin={isAdmin} />
    </div>
  );
}
