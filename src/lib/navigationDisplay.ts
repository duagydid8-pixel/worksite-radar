export function getAdminMenuButtonLabel(isAdminSectionActive: boolean, activeAdminLabel?: string): string {
  return isAdminSectionActive && activeAdminLabel ? `관리자: ${activeAdminLabel}` : "관리자";
}

export function shouldShowAdminMenuPanel({
  isAdmin,
  isOpen,
}: {
  isAdmin: boolean;
  isOpen: boolean;
}): boolean {
  return isAdmin && isOpen;
}
