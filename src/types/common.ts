export type TeamFilter = "전체" | "한성" | "태화";

export type ActiveTab =
  | "홈"
  | "신규자명단"
  | "근태보고"
  | "연차관리"
  | "조직도"
  | "XERP&PMIS"
  | "주간일정"
  | "XERP공수반영"
  | "PDF분리";

export interface NavItem {
  key: ActiveTab;
  label: string;
  icon: React.ReactNode;
  adminOnly: boolean;
  path: string;
}
