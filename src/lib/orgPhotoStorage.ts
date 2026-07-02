const SUPPORTED_ORG_PHOTO_TYPES = new Set(["jpeg", "jpg", "png", "gif", "webp"]);

function sanitizePathSegment(value: string) {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "photo";
}

export function getOrgPhotoContentType(dataUrl: string) {
  const subtype = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/)?.[1]?.toLowerCase();
  if (!subtype || !SUPPORTED_ORG_PHOTO_TYPES.has(subtype)) return "image/jpeg";
  return subtype === "jpg" ? "image/jpeg" : `image/${subtype}`;
}

export function getOrgPhotoExtension(dataUrl: string) {
  return getOrgPhotoContentType(dataUrl).replace("image/", "").replace("jpg", "jpeg");
}

export function getOrgPhotoStoragePath(docId: string, ownerId: string, timestamp = Date.now(), extension = "jpeg") {
  return `org-photos/${sanitizePathSegment(docId)}/${sanitizePathSegment(ownerId)}_${timestamp}.${extension}`;
}

export function isInlineOrgPhoto(photoUrl: string) {
  return photoUrl.startsWith("data:image/");
}
