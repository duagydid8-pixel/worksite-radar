import type { ReactNode } from "react";
import { MessageSquare, NotebookText } from "lucide-react";

export type InquiryMenu = "kakao" | "manual";

export const INQUIRY_MENU_OPTIONS: { value: InquiryMenu; label: string; icon: ReactNode }[] = [
  { value: "kakao", label: "카카오톡", icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { value: "manual", label: "메뉴얼", icon: <NotebookText className="h-3.5 w-3.5" /> },
];
