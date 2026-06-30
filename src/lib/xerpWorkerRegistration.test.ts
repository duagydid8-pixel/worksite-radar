import { describe, expect, it } from "vitest";
import {
  XERP_WORKER_REGISTRATION_SITES,
  getXerpWorkerRegistrationSite,
  summarizeXerpWorkerRegistrationRows,
} from "./xerpWorkerRegistration";

describe("xerpWorkerRegistration", () => {
  it("defines the supported XERP worker-registration sites", () => {
    expect(XERP_WORKER_REGISTRATION_SITES.PH4.xerpSiteName).toBe("평택 P4-PH4 초순수");
    expect(XERP_WORKER_REGISTRATION_SITES.PH2.xerpSiteName).toBe("평택 P4-PH2 초순수");
    expect(Object.keys(XERP_WORKER_REGISTRATION_SITES)).toEqual(["PH4", "PH2"]);
  });

  it("returns a site definition by key", () => {
    expect(getXerpWorkerRegistrationSite("PH4").label).toBe("P4-PH4");
    expect(getXerpWorkerRegistrationSite("PH2").label).toBe("P4-PH2");
  });

  it("summarizes imported rows", () => {
    const summary = summarizeXerpWorkerRegistrationRows([
      { 이름: "홍길동", 입사일: "2026-01-01", 퇴사일: "" },
      { 이름: "홍길동", 입사일: "2026-02-01", 퇴사일: "" },
      { 이름: "김철수", 입사일: "2025-01-01", 퇴사일: "2026-01-31" },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.active).toBe(2);
    expect(summary.resigned).toBe(1);
    expect(summary.unknown).toBe(0);
    expect(summary.duplicateNameGroups).toBe(1);
    expect(summary.duplicateNameRows).toBe(2);
  });
});
