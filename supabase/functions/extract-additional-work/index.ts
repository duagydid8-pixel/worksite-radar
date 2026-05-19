import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const firebaseJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

const defaultAllowedOrigins = [
  "https://worksite-radar.vercel.app",
  "http://localhost:8080",
  "http://localhost:8081",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:8081",
];

function allowedOrigins(): Set<string> {
  const extra = (Deno.env.get("WORKSITE_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...defaultAllowedOrigins, ...extra]);
}

function corsHeadersFor(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (origin && allowedOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("Origin");
  return !origin || allowedOrigins().has(origin);
}

interface RequestImage {
  dataUrl?: unknown;
  label?: unknown;
}

interface VisionRow {
  name?: unknown;
  date?: unknown;
  units?: unknown;
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

async function requireFirebaseAdmin(req: Request): Promise<void> {
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  const adminUids = new Set(
    (Deno.env.get("FIREBASE_ADMIN_UIDS") ?? "")
      .split(",")
      .map((uid) => uid.trim())
      .filter(Boolean),
  );

  if (!projectId || adminUids.size === 0) {
    throw new Error("admin_auth_not_configured");
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    throw new Error("missing_token");
  }

  const { payload } = await jwtVerify(token, firebaseJwks, {
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  });

  if (typeof payload.sub !== "string" || !adminUids.has(payload.sub)) {
    throw new Error("admin_required");
  }

  if (payload.email_verified !== true) {
    throw new Error("verified_email_required");
  }
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compactText(value: unknown): string {
  return cleanText(value).replace(/\s+/g, "");
}

function normalizeDate(value: unknown): string {
  const text = cleanText(value);
  const match = text.match(/(20\d{2})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (!match) return text;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function normalizeUnits(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const match = cleanText(value).replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed === 100) return 1;
  if (parsed === 200) return 2;
  return parsed;
}

function normalizeRows(rows: unknown): Array<{ name: string; date: string; units: number }> {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as VisionRow;
    const name = compactText(record.name);
    const units = normalizeUnits(record.units);
    const date = normalizeDate(record.date);

    if (!name || units === null) return [];
    return [{ name, date, units }];
  });
}

function extractOutputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") return response.output_text;

  const output = response.output;
  if (!Array.isArray(output)) return "";

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function parseRowsFromOutput(outputText: string): Array<{ name: string; date: string; units: number }> {
  try {
    const parsed = JSON.parse(outputText);
    return normalizeRows((parsed as Record<string, unknown>).rows);
  } catch {
    const match = outputText.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return normalizeRows((parsed as Record<string, unknown>).rows);
    } catch {
      return [];
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeadersFor(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  if (!isAllowedOrigin(req)) {
    return jsonResponse(req, { error: "Origin not allowed" }, 403);
  }

  try {
    await requireFirebaseAdmin(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unauthorized";
    const status = message === "admin_auth_not_configured" ? 500 : 401;
    return jsonResponse(req, { error: message }, status);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return jsonResponse(req, { error: "OPENAI_API_KEY is not configured" }, 500);
  }

  const body = await req.json().catch(() => null) as {
    images?: RequestImage[];
    prompt?: unknown;
  } | null;

  const images = (body?.images ?? [])
    .filter((image) => typeof image?.dataUrl === "string" && image.dataUrl.startsWith("data:image/"))
    .slice(0, 8);
  const prompt = cleanText(body?.prompt);

  if (images.length === 0) {
    return jsonResponse(req, { error: "No valid images were provided" }, 400);
  }

  if (images.some((image) => String(image.dataUrl).length > 5_000_000)) {
    return jsonResponse(req, { error: "Image payload is too large" }, 413);
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_MODEL") || "gpt-5-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...images.map((image) => ({
              type: "input_image",
              image_url: image.dataUrl,
              detail: "high",
            })),
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "additional_work_rows",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              rows: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    date: { type: "string" },
                    units: { type: "number" },
                  },
                  required: ["name", "date", "units"],
                },
              },
            },
            required: ["rows"],
          },
        },
      },
    }),
  });

  const openAiPayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return jsonResponse(req, {
      error: "OpenAI extraction failed",
      detail: openAiPayload,
    }, response.status);
  }

  const rawText = extractOutputText(openAiPayload as Record<string, unknown>);
  return jsonResponse(req, {
    rows: parseRowsFromOutput(rawText),
    rawText,
  });
});
