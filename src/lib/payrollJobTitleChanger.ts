import * as XLSX from "xlsx";
import JSZip from "jszip";

export interface PayrollJobTitleChange {
  sheetName: string;
  rowNumber: number;
  name: string;
  before: string;
  after: string;
  reason: "manager" | "not-in-job-list";
}

export interface PayrollJobTitleChangeResult {
  outputBuffer: ArrayBuffer;
  changes: PayrollJobTitleChange[];
  summary: {
    total: number;
    manager: number;
    fallback: number;
  };
}

interface PayrollJobTitleLayout {
  headerRow: number;
  dataStartRow: number;
  jobTitleCol: number;
  nameCol: number;
}

function normalizeJobTitle(jobTitle: string): string {
  return jobTitle.replace(/\s+/g, "").trim();
}

function getCellText(ws: XLSX.WorkSheet, row0: number, col0: number): string {
  const cell = ws[XLSX.utils.encode_cell({ r: row0, c: col0 })];
  return String(cell?.v ?? "").trim();
}

function detectPayrollJobTitleLayout(ws: XLSX.WorkSheet): PayrollJobTitleLayout | null {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");

  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 15); r++) {
    let jobTitleCol = -1;
    let nameCol = -1;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const text = normalizeJobTitle(getCellText(ws, r, c));
      if (text === "직종") jobTitleCol = c;
      if (text === "성명") nameCol = c;
    }

    if (jobTitleCol >= 0 && nameCol >= 0) {
      return { headerRow: r, dataStartRow: r + 1, jobTitleCol, nameCol };
    }
  }

  return null;
}

export function readJobTitleSet(buffer: ArrayBuffer): Set<string> {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return new Set();

  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const values = new Set<string>();

  for (let r = range.s.r; r <= range.e.r; r++) {
    const value = normalizeJobTitle(getCellText(ws, r, 0));
    if (!value || value === "직종표") continue;
    values.add(value);
  }

  return values;
}

export function resolvePayrollJobTitle(jobTitle: string, allowedJobTitles: Set<string>): string {
  const normalized = normalizeJobTitle(jobTitle);
  if (!normalized) return jobTitle;
  if (normalized.includes("관리자")) return "관리자";
  if (normalized === "차량운행") return "관리자";
  if (allowedJobTitles.has(normalized)) return jobTitle.trim();
  return "보통인부";
}

async function getSheetXmlPaths(zip: JSZip): Promise<Map<string, string>> {
  const wbXml = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const relsXml = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const nameToRid = new Map<string, string>();
  const ridToPath = new Map<string, string>();

  for (const m of wbXml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"/g)) {
    nameToRid.set(unescapeXml(m[1]), m[2]);
  }
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\br:id="([^"]*)"[^>]*\bname="([^"]*)"/g)) {
    nameToRid.set(unescapeXml(m[2]), m[1]);
  }
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\bId="([^"]*)"[^>]*\bTarget="([^"]*)"/g)) {
    const target = m[2];
    ridToPath.set(m[1], target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const result = new Map<string, string>();
  for (const [name, rid] of nameToRid) {
    const path = ridToPath.get(rid);
    if (path) result.set(name, path);
  }

  return result;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function extractStyleAttribute(cellOpenTag: string): string {
  return cellOpenTag.match(/\bs="([^"]*)"/)?.[1] ?? "";
}

function makeInlineStringCellXml(addr: string, value: string, style = ""): string {
  const styleAttr = style ? ` s="${style}"` : "";
  return `<c r="${addr}" t="inlineStr"${styleAttr}><is><t>${escapeXml(value)}</t></is></c>`;
}

function makeInlineStringCellFromBlock(cellBlock: string, addr: string, value: string): string {
  const openEnd = cellBlock.indexOf(">");
  if (openEnd === -1) return makeInlineStringCellXml(addr, value);
  const style = extractStyleAttribute(cellBlock.slice(0, openEnd + 1));
  return makeInlineStringCellXml(addr, value, style);
}

function makeMissingInlineStringCellXml(addr: string, value: string, rowBlock: string): string {
  const target = XLSX.utils.decode_cell(addr);
  let nearestStyle = "";
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const m of rowBlock.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>/g)) {
    const cell = XLSX.utils.decode_cell(m[1]);
    const distance = Math.abs(cell.c - target.c);
    if (distance >= nearestDistance) continue;
    const style = extractStyleAttribute(m[0]);
    if (!style) continue;
    nearestStyle = style;
    nearestDistance = distance;
  }

  return makeInlineStringCellXml(addr, value, nearestStyle);
}

function insertMissingStringCell(xml: string, addr: string, value: string): string {
  const rowNum = addr.match(/\d+$/)?.[0];
  if (!rowNum) return xml;

  const rowOpenRe = new RegExp(`<row\\b[^>]*\\br="${rowNum}"[^>]*>`);
  const rowMatch = rowOpenRe.exec(xml);
  if (!rowMatch) return xml;

  const rowStart = rowMatch.index;
  const rowOpenEnd = rowStart + rowMatch[0].length;
  const rowClose = xml.indexOf("</row>", rowOpenEnd);
  if (rowClose === -1) return xml;

  const rowBlock = xml.substring(rowStart, rowClose + 6);
  const targetCol = XLSX.utils.decode_cell(addr).c;
  let insertAt = rowBlock.indexOf("</row>");

  for (const m of rowBlock.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>)/g)) {
    const cell = XLSX.utils.decode_cell(m[1]);
    if (cell.c > targetCol) {
      insertAt = m.index ?? insertAt;
      break;
    }
  }

  const newRowBlock = rowBlock.slice(0, insertAt)
    + makeMissingInlineStringCellXml(addr, value, rowBlock)
    + rowBlock.slice(insertAt);

  return xml.substring(0, rowStart) + newRowBlock + xml.substring(rowClose + 6);
}

function modifySheetXml(xml: string, cellChanges: Map<string, string>): string {
  for (const [addr, newValue] of cellChanges) {
    const attrStr = `r="${addr}"`;
    const rPos = xml.indexOf(attrStr);
    if (rPos === -1) {
      xml = insertMissingStringCell(xml, addr, newValue);
      continue;
    }

    const cOpen = xml.lastIndexOf("<c ", rPos);
    if (cOpen === -1) continue;

    const cClose = xml.indexOf("</c>", rPos);
    if (cClose === -1) {
      const selfClose = xml.indexOf("/>", rPos);
      if (selfClose === -1) continue;
      const cellBlock = xml.substring(cOpen, selfClose + 2);
      if (cellBlock.includes("<f>") || cellBlock.includes("<f ")) continue;
      xml = xml.substring(0, cOpen)
        + makeInlineStringCellFromBlock(cellBlock, addr, newValue)
        + xml.substring(selfClose + 2);
      continue;
    }

    const cellBlock = xml.substring(cOpen, cClose + 4);
    if (cellBlock.includes("<f>") || cellBlock.includes("<f ")) continue;

    xml = xml.substring(0, cOpen)
      + makeInlineStringCellFromBlock(cellBlock, addr, newValue)
      + xml.substring(cClose + 4);
  }

  return xml;
}

function setWorkbookRecalculation(zip: JSZip, workbookXml: string): void {
  let patched = workbookXml;
  if (/<calcPr\b/.test(patched)) {
    patched = patched
      .replace(/<calcPr([^/>]*)\/>/, (_, attrs) => `<calcPr${attrs} fullCalcOnLoad="1"/>`)
      .replace(/<calcPr([^/>]*)>/, (_, attrs) => `<calcPr${attrs} fullCalcOnLoad="1">`);
  } else {
    patched = patched.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
  }
  zip.file("xl/workbook.xml", patched);
}

export async function changePayrollJobTitles(
  payrollBuffer: ArrayBuffer,
  jobListBuffer: ArrayBuffer
): Promise<PayrollJobTitleChangeResult> {
  const allowedJobTitles = readJobTitleSet(jobListBuffer);
  const wb = XLSX.read(payrollBuffer, { type: "array" });
  const changes: PayrollJobTitleChange[] = [];
  const allCellChanges = new Map<string, Map<string, string>>();

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const layout = detectPayrollJobTitleLayout(ws);
    if (!layout) continue;

    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    const sheetCellChanges = new Map<string, string>();

    for (let r = layout.dataStartRow; r <= range.e.r; r++) {
      const name = getCellText(ws, r, layout.nameCol);
      const before = getCellText(ws, r, layout.jobTitleCol);
      if (!name || normalizeJobTitle(name) === "성명" || !before || normalizeJobTitle(before) === "직종") continue;

      const after = resolvePayrollJobTitle(before, allowedJobTitles);
      if (after === before.trim()) continue;

      const reason: PayrollJobTitleChange["reason"] = after === "관리자" ? "manager" : "not-in-job-list";
      changes.push({ sheetName, rowNumber: r + 1, name, before, after, reason });
      sheetCellChanges.set(XLSX.utils.encode_cell({ r, c: layout.jobTitleCol }), after);
    }

    if (sheetCellChanges.size > 0) allCellChanges.set(sheetName, sheetCellChanges);
  }

  const zip = await JSZip.loadAsync(payrollBuffer);
  const sheetPaths = await getSheetXmlPaths(zip);

  for (const [sheetName, cellChanges] of allCellChanges) {
    const xmlPath = sheetPaths.get(sheetName);
    if (!xmlPath) continue;
    const xmlContent = await zip.file(xmlPath)?.async("string");
    if (!xmlContent) continue;
    zip.file(xmlPath, modifySheetXml(xmlContent, cellChanges));
  }

  zip.remove("xl/calcChain.xml");
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (workbookXml) setWorkbookRecalculation(zip, workbookXml);

  const outputBuffer = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    outputBuffer,
    changes,
    summary: {
      total: changes.length,
      manager: changes.filter((row) => row.reason === "manager").length,
      fallback: changes.filter((row) => row.reason === "not-in-job-list").length,
    },
  };
}
