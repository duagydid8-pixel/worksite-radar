import { describe, expect, it } from "vitest";
import { canCopyResidentNumber, displayResidentNumber } from "./elcdResidentNumber";

describe("elcdResidentNumber", () => {
  it("shows the full resident number to admins when full value exists", () => {
    expect(displayResidentNumber("900101-1234567", true)).toBe("900101-1234567");
  });

  it("masks resident numbers for non-admin users", () => {
    expect(displayResidentNumber("900101-1234567", false)).toBe("900101-******");
  });

  it("does not invent missing back digits", () => {
    expect(displayResidentNumber("900101", true)).toBe("900101");
  });

  it("allows copy only for admins with full resident numbers", () => {
    expect(canCopyResidentNumber("900101-1234567", true)).toBe(true);
    expect(canCopyResidentNumber("900101-1234567", false)).toBe(false);
    expect(canCopyResidentNumber("900101", true)).toBe(false);
  });
});
