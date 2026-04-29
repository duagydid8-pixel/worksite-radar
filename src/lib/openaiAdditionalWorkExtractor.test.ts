import { describe, expect, it } from "vitest";
import {
  buildAdditionalWorkVisionPrompt,
  normalizeVisionRows,
  parseVisionFunctionResult,
} from "./openaiAdditionalWorkExtractor";

describe("openai additional work extractor", () => {
  it("normalizes strict vision rows into payroll entries", () => {
    expect(normalizeVisionRows([
      { name: " 송 승 석 ", date: "2026-03-30", units: "1.00" },
      { name: "정회옥", date: "2026.03.30", units: "2" },
      { name: "", date: "2026-03-30", units: 1 },
      { name: "금액행", date: "2026-03-30", units: 0 },
    ])).toEqual([
      { name: "송승석", trade: "", units: 1, sourceLine: "2026-03-30" },
      { name: "정회옥", trade: "", units: 2, sourceLine: "2026-03-30" },
    ]);
  });

  it("parses the Supabase function response shape", () => {
    const rows = parseVisionFunctionResult({
      rows: [
        { name: "송승석", date: "2026-03-30", units: 1 },
      ],
    });

    expect(rows).toEqual([
      { name: "송승석", trade: "", units: 1, sourceLine: "2026-03-30" },
    ]);
  });

  it("builds a prompt that requests only the needed table fields", () => {
    const prompt = buildAdditionalWorkVisionPrompt(["송승석", "정회옥"]);

    expect(prompt).toContain("name");
    expect(prompt).not.toContain("\"trade\"");
    expect(prompt).toContain("date");
    expect(prompt).toContain("units");
    expect(prompt).toContain("Do not extract trade/job type");
    expect(prompt).toContain("송승석");
    expect(prompt).not.toContain("resident");
  });
});
