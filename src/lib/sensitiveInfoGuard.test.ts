import { describe, expect, it } from "vitest";
import { detectSensitiveInfo, redactSensitiveInfo, summarizeSensitiveInfoFindings } from "./sensitiveInfoGuard";

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

describe("redactSensitiveInfo (외부 전송 전 가리기)", () => {
  it("주민번호·전화번호를 대체 문구로 바꾼다", () => {
    const result = redactSensitiveInfo("홍길동 900101-1234567 / 010-1234-5678 조퇴합니다");

    expect(result.text).toBe("홍길동 [주민번호] / [전화번호] 조퇴합니다");
    expect(result.redactedCount).toBe(2);
    expect(result.findings.map((f) => f.type)).toEqual(["resident-number", "phone-number"]);
  });

  it("은행 문구 옆 계좌번호를 가린다", () => {
    const result = redactSensitiveInfo("예금주 홍길동 국민은행 123456-78-901234");

    expect(result.text).toBe("예금주 홍길동 국민은행 [계좌번호]");
    expect(result.redactedCount).toBe(1);
  });

  it("날짜·이름·근태 문구는 건드리지 않는다", () => {
    const text = "김철수 10월 25일 연차입니다. 내일 안전교육으로 출근타각 못 했습니다";

    expect(redactSensitiveInfo(text).text).toBe(text);
    expect(redactSensitiveInfo(text).redactedCount).toBe(0);
  });

  it("사업자등록번호는 그대로 둔다", () => {
    const text = "사업자등록번호 462-85-01276";

    expect(redactSensitiveInfo(text).text).toBe(text);
  });

  it("한 문장에 여러 건이 있어도 모두 가린다", () => {
    const result = redactSensitiveInfo("010-1111-2222 / 010-3333-4444");

    expect(result.text).toBe("[전화번호] / [전화번호]");
    expect(result.redactedCount).toBe(2);
    expect(result.findings).toHaveLength(1);
  });
});
