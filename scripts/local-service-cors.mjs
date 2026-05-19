const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://worksite-radar.vercel.app",
]);

function parseExtraOrigins() {
  return (process.env.WORKSITE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function isAllowedLocalServiceOrigin(origin) {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, "");
  if (DEFAULT_ALLOWED_ORIGINS.has(normalized)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(normalized)) return true;
  return parseExtraOrigins().includes(normalized);
}

export function writeCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedLocalServiceOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Cache-Control", "no-store");
}

export function rejectDisallowedOrigin(req, res) {
  const origin = req.headers.origin;
  if (isAllowedLocalServiceOrigin(origin)) return false;
  res.writeHead(403, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify({ error: "Origin not allowed" }));
  return true;
}
