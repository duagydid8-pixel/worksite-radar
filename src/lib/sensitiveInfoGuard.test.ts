import { describe, expect, it } from "vitest";
import { detectSensitiveInfo, summarizeSensitiveInfoFindings } from "./sensitiveInfoGuard";

describe("sensitiveInfoGuard", () => {
  it("detects resident registration numbers and phone numbers", () => {
    const findings = detectSensitiveInfo("홍길동 900101-1234567 / 010-1234-5678");

    expect(findings.map((finding) => finding.type)).toEqual(["resident-number", "phone-number"]);
  });

  it("detects likely bank account numbers near bank words", () => {
    const findings = detectSensitiveInfo("예금주 홍길동 국민은행 123456-78-901234");

    expect(findings.map((finding) => finding.type)).toEqual(["bank-account"]);
  });

  it("does not warn for business registration numbers", () => {
    const findings = detectSensitiveInfo("사업자등록번호 462-85-01276");

    expect(findings).toEqual([]);
  });

  it("summarizes warning labels for user-facing copy", () => {
    const summary = summarizeSensitiveInfoFindings([
      { type: "resident-number", label: "주민번호", sample: "900101-1..." },
      { type: "phone-number", label: "전화번호", sample: "010-123..." },
      { type: "phone-number", label: "전화번호", sample: "031-123..." },
    ]);

    expect(summary).toBe("주민번호, 전화번호");
  });
});
