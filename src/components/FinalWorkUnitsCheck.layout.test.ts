import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("FinalWorkUnitsCheck layout guards", () => {
  it("keeps long review text cells from being clipped", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).not.toContain('className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"');
    expect(source).toContain('className="min-w-[320px] max-w-[520px] whitespace-pre-wrap break-words px-2 py-2"');
    expect(source).toContain('className="min-w-[320px] max-w-[520px] whitespace-pre-wrap break-words px-2 py-2 font-bold leading-5 text-slate-900"');
    expect(source).toContain('className="min-w-0 whitespace-pre-wrap break-words font-semibold text-slate-700"');
  });

  it("uses stronger colors for reason and judgment review text", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).toContain("ReviewTextLine");
    expect(source).toContain('tone === "reason"');
    expect(source).toContain("border-violet-200 bg-violet-50 text-violet-950");
    expect(source).toContain("border-amber-200 bg-amber-50 text-amber-950");
    expect(source).toContain("text-violet-900 ring-1 ring-violet-200");
    expect(source).toContain("text-amber-900 ring-1 ring-amber-200");
  });

  it("keeps the final work units table horizontally scrollable", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).toContain('className="max-w-full rounded-lg border border-slate-200 bg-white shadow-sm"');
    expect(source).toContain('className="max-w-full overflow-x-scroll overscroll-x-contain pb-2 [scrollbar-gutter:stable]"');
    expect(source).toContain('className="w-max min-w-[2800px] border-collapse text-xs"');
  });

  it("keeps a synced horizontal scrollbar visible above the table", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).toContain("topHorizontalScrollRef");
    expect(source).toContain("tableHorizontalScrollRef");
    expect(source).toContain("syncHorizontalScroll");
    expect(source).toContain('className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur"');
    expect(source).toContain('aria-label="최종공수 표 가로 스크롤"');
    expect(source).toContain('onScroll={() => syncHorizontalScroll("top")}');
    expect(source).toContain('onScroll={() => syncHorizontalScroll("table")}');
  });

  it("offers a quick review card list before the wide detail table", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).toContain("quickReviewRows");
    expect(source).toContain("WorkUnitQuickReviewCard");
    expect(source).toContain("빠른 검토 목록");
    expect(source).toContain("표에서 보기");
    expect(source).toContain("검토완료 숨김");
  });

  it("lets users return to the quick review list after opening a table row", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).toContain("quickReviewSectionRef");
    expect(source).toContain("handleReturnToQuickReview");
    expect(source).toContain("quickReviewSectionRef.current?.scrollIntoView");
    expect(source).toContain("onReturnToQuickReview={() => handleReturnToQuickReview()}");
    expect(source).toContain("onReturnToQuickReview");
  });

  it("defaults the heavy final work list to anomaly rows instead of all workers", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).toContain('type StatusFilter = "issues" | "all" | FinalWorkUnitsStatus;');
    expect(source).toContain('useState<StatusFilter>("issues")');
    expect(source).toContain('setStatusFilter("issues")');
    expect(source).toContain('} else if (statusFilter === "issues") {');
    expect(source).toContain('if (row.status === "normal") return false;');
    expect(source).toContain('if (row.status === "pmis-not-uploaded") return false;');
    expect(source).toContain('analysis.summary.needsReview');
  });

  it("loads a saved final work month so the excel file is not required every time", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).toContain("listFinalWorkUnitsMonthsFS");
    expect(source).toContain("loadFinalWorkUnitsMonthFS");
    expect(source).toContain("buildFinalWorkUnitsAnalysisFromSnapshot");
    expect(source).toContain("handleLoadSavedMonth");
    expect(source).toContain("setRestoredSnapshot(snapshot)");
    expect(source).toContain("저장본 불러오는 중");
    expect(source).toContain("저장본 선택");
    expect(source).toContain("저장본");
  });

  it("keeps expanded detail rows compact and wrapping", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/FinalWorkUnitsCheck.tsx"), "utf8");

    expect(source).not.toContain('className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"');
    expect(source).toContain('className="inline-grid w-max max-w-[1240px] grid-cols-[repeat(3,minmax(300px,380px))] items-start gap-3 align-top"');
    expect(source).toContain('className="min-w-0 rounded-lg border border-slate-200 bg-white p-3"');
    expect(source).toContain('className="grid grid-cols-[76px_minmax(0,1fr)] gap-2"');
  });
});
