import { describe, expect, it } from "vitest";
import { parseAdditionalWorkGeminiJson } from "./geminiService";

describe("parseAdditionalWorkGeminiJson", () => {
  it("extracts only name, trade, and units from Gemini JSON", () => {
    const rows = parseAdditionalWorkGeminiJson(`\`\`\`json
      {
        "rows": [
          { "name": "송승석", "trade": "공구장", "units": 1.0, "reason": "3월만근추가공수" },
          { "name": "유진환", "trade": "신호수", "units": "2.00" }
        ]
      }
    \`\`\``);

    expect(rows).toEqual([
      { name: "송승석", trade: "공구장", units: 1 },
      { name: "유진환", trade: "신호수", units: 2 },
    ]);
  });
});
