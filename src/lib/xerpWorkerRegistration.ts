import { getDuplicateNameCounts, getEmployeeStatusCounts } from "@/components/NewEmployeeList";

export type XerpWorkerRegistrationSite = "PH4" | "PH2" | "P5PH1";

export type XerpWorkerRegistrationSiteDefinition = {
  key: XerpWorkerRegistrationSite;
  label: string;
  xerpSiteName: string;
};

export const XERP_WORKER_REGISTRATION_SITES: Record<
  XerpWorkerRegistrationSite,
  XerpWorkerRegistrationSiteDefinition
> = {
  PH4: { key: "PH4", label: "P4-PH4", xerpSiteName: "평택 P4-PH4 초순수" },
  PH2: { key: "PH2", label: "P4-PH2", xerpSiteName: "평택 P4-PH2 초순수" },
  P5PH1: { key: "P5PH1", label: "P5-PH1", xerpSiteName: "평택 P5-PH1 초순수" },
};

type EmployeeStatusInput = {
  이름?: string;
  입사일?: string;
  퇴사일?: string;
};

export function getXerpWorkerRegistrationSite(site: XerpWorkerRegistrationSite) {
  return XERP_WORKER_REGISTRATION_SITES[site];
}

export function summarizeXerpWorkerRegistrationRows(rows: EmployeeStatusInput[]) {
  const statusCounts = getEmployeeStatusCounts(rows);
  const duplicateCounts = getDuplicateNameCounts(rows);
  const duplicateValues = Array.from(duplicateCounts.values());

  return {
    total: rows.length,
    active: statusCounts.active,
    resigned: statusCounts.resigned,
    unknown: statusCounts.unknown,
    duplicateNameGroups: duplicateValues.length,
    duplicateNameRows: duplicateValues.reduce((sum, count) => sum + count, 0),
  };
}
