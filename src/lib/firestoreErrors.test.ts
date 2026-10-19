import { describe, expect, it } from "vitest";
import { describeFirestoreError } from "./firestoreErrors";

describe("describeFirestoreError", () => {
  it("explains known Firestore failures", () => {
    expect(describeFirestoreError({ code: "permission-denied" })).toContain("권한");
    expect(describeFirestoreError(new Error("Document exceeds the maximum allowed size of 1,048,576 bytes"))).toContain("1MB");
    expect(describeFirestoreError({ code: "unavailable" })).toContain("네트워크");
  });
  it("returns null for unknown errors", () => {
    expect(describeFirestoreError(new Error("boom"))).toBeNull();
  });
});
