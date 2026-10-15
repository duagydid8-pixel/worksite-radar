import { describe, expect, it } from "vitest";
import { getOrgPhotoContentType, getOrgPhotoExtension, getOrgPhotoStoragePath } from "./orgPhotoStorage";

describe("org photo storage", () => {
  it("builds a stable org photo storage path with a safe owner id", () => {
    expect(getOrgPhotoStoragePath("org_p4_ph4", "member/id 1", 1700000000000, "jpeg")).toBe(
      "org-photos/org_p4_ph4/member-id-1_1700000000000.jpeg",
    );
  });

  it("detects the content type and extension from an inline image", () => {
    const dataUrl = "data:image/png;base64,abc123";

    expect(getOrgPhotoContentType(dataUrl)).toBe("image/png");
    expect(getOrgPhotoExtension(dataUrl)).toBe("png");
  });

  it("normalizes jpg image content types to jpeg extension", () => {
    const dataUrl = "data:image/jpg;base64,abc123";

    expect(getOrgPhotoContentType(dataUrl)).toBe("image/jpeg");
    expect(getOrgPhotoExtension(dataUrl)).toBe("jpeg");
  });
});
