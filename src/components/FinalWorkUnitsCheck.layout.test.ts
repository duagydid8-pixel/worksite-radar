import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("FinalWorkUnitsCheck layout guards", () => {
  it("keeps long review text cells from being clipped", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).not.toContain('className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"');
    expect(source).toContain('className="min-w-[320px] max-w-[520px] whitespace-pre-wrap break-words px-2 py-2"');
    expect(source).toContain('className="min-w-[320px] max-w-[520px] whitespace-pre-wrap break-words px-2 py-2 font-semibold leading-5 text-slate-600"');
    expect(source).toContain('className="min-w-0 whitespace-pre-wrap break-words font-semibold text-slate-700"');
  });

  it("keeps the final work units table horizontally scrollable", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).toContain('className="max-w-full rounded-lg border border-slate-200 bg-white shadow-sm"');
    expect(source).toContain('className="max-w-full overflow-x-scroll overscroll-x-contain pb-2 [scrollbar-gutter:stable]"');
    expect(source).toContain('className="w-max min-w-[2800px] border-collapse text-xs"');
  });
});
