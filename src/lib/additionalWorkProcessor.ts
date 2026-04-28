import * as XLSX from "xlsx";
import JSZip from "jszip";

export interface AdditionalWorkEntry {
  name: string;
  trade: string;
  units: number;
  sourceLine?: string;
}

export interface AppliedAdditionalWork {
  sheetName: string;
  rowNumber: number;
  name: string;
  payrollJobTitle: string;
  trade: string;
  units: number;
  unitPrice: number;
  expense2Before: number;
  expense2After: number;
  salaryBefore: number;
  salaryAfter: number;
}

export interface UnmatchedAdditionalWork {
  name: string;
  trade: string;
  units: number;
  reason: string;
}

export interface AdditionalWorkPayrollResult {
  outputBuffer: ArrayBuffer;
  applied: AppliedAdditionalWork[];
  unmatched: UnmatchedAdditionalWork[];
}

interface PayrollLayout {
  nameCol: number;
  jobTitleCol: number;
  unitPriceCol: number;
  expense2Col: number;
  salaryCol: number;
  dataStartRow: number;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function getCellText(ws: XLSX.WorkSheet, row0: number, col0: number): string {
  const cell = ws[XLSX.utils.encode_cell({ r: row0, c: col0 })];
  return String(cell?.v ?? "").trim();
}

function getCellNumber(ws: XLSX.WorkSheet, row0: number, col0: number): number {
  const raw = ws[XLSX.utils.encode_cell({ r: row0, c: col0 })]?.v;
  const value = Number(String(raw ?? "0").replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function detectPayrollLayout(ws: XLSX.WorkSheet): PayrollLayout | null {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  let nameCol = -1;
  let nameRow = -1;
  let jobTitleCol = -1;
  let unitPriceCol = -1;
  let expense2Col = -1;
  let salaryCol = -1;

  for (let r = range.s.r; r <= Math.min(range.e.r, 10); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const text = getCellText(ws, r, c).replace(/\s+/g, "");
      if (text === "성명") {
        nameCol = c;
        nameRow = r;
      } else if (text === "직종") {
        jobTitleCol = c;
      } else if (text === "단가") {
        unitPriceCol = c;
      } else if (text === "경비(2)" || text === "추가공수x단가") {
        expense2Col = c;
      } else if (text === "급여액") {
        salaryCol = c;
      }
    }
  }

  if (nameCol < 0 || unitPriceCol < 0 || expense2Col < 0 || salaryCol < 0) return null;
  return {
    nameCol,
    jobTitleCol: jobTitleCol >= 0 ? jobTitleCol : Math.max(0, nameCol - 2),
    unitPriceCol,
    expense2Col,
    salaryCol,
    dataStartRow: nameRow + 1,
  };
}

function roundMoney(value: number): number {
  return Math.round(value);
}

function aggregateEntries(entries: AdditionalWorkEntry[]): AdditionalWorkEntry[] {
  const byName = new Map<string, AdditionalWorkEntry>();
  for (const entry of entries) {
    const name = normalizeName(entry.name);
    if (!name || !Number.isFinite(entry.units) || entry.units <= 0) continue;
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, {
        name: entry.name.trim(),
        trade: entry.trade.trim(),
        units: entry.units,
        sourceLine: entry.sourceLine,
      });
      continue;
    }

    existing.units += entry.units;
    const trades = new Set(existing.trade.split(",").map((v) => v.trim()).filter(Boolean));
    if (entry.trade.trim()) trades.add(entry.trade.trim());
    existing.trade = Array.from(trades).join(", ");
  }
  return Array.from(byName.values());
}

export function parseAdditionalWorkText(text: string): AdditionalWorkEntry[] {
  const rows: AdditionalWorkEntry[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[|:;]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    const compact = line.replace(/\s+/g, "");
    if (/^(이름|성명|공종|추가|NO|No|no)/.test(compact)) continue;

    const unitsMatch = line.match(/(\d+(?:[.,]\d+)?)\s*$/);
    if (!unitsMatch || unitsMatch.index == null) continue;

    const units = Number(unitsMatch[1].replace(",", "."));
    if (!Number.isFinite(units) || units <= 0) continue;

    const beforeUnits = line.slice(0, unitsMatch.index).trim();
    const tokens = beforeUnits.split(/\s+/).filter(Boolean);
    const nameIndex = tokens.findIndex((token) => /^[가-힣]{2,4}$/.test(token));
    if (nameIndex < 0) continue;

    const name = tokens[nameIndex];
    const trade = tokens.slice(nameIndex + 1).join(" ").trim();
    if (!trade) continue;

    rows.push({ name, trade, units, sourceLine: line });
  }

  return rows;
}

async function getSheetXmlPaths(zip: JSZip): Promise<Map<string, string>> {
  const wbXml = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const relsXml = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const nameToRid = new Map<string, string>();
  const ridToPath = new Map<string, string>();

  for (const m of wbXml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"/g)) {
    nameToRid.set(m[1], m[2]);
  }
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\br:id="([^"]*)"[^>]*\bname="([^"]*)"/g)) {
    nameToRid.set(m[2], m[1]);
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

function makeNumericCellXml(addr: string, newValue: number, rowBlock: string): string {
  const target = XLSX.utils.decode_cell(addr);
  let nearestStyle = "";
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const m of rowBlock.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>/g)) {
    const cell = XLSX.utils.decode_cell(m[1]);
    const distance = Math.abs(cell.c - target.c);
    if (distance >= nearestDistance) continue;
    const style = m[0].match(/\bs="([^"]*)"/)?.[1];
    if (!style) continue;
    nearestStyle = ` s="${style}"`;
    nearestDistance = distance;
  }

  return `<c r="${addr}"${nearestStyle}><v>${newValue}</v></c>`;
}

function insertMissingCell(xml: string, addr: string, newValue: number): string {
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

  const newRowBlock = rowBlock.slice(0, insertAt) + makeNumericCellXml(addr, newValue, rowBlock) + rowBlock.slice(insertAt);
  return xml.substring(0, rowStart) + newRowBlock + xml.substring(rowClose + 6);
}

function replaceNumericCellBlock(cellBlock: string, newValue: number): string {
  const openEnd = cellBlock.indexOf(">");
  if (openEnd === -1) return cellBlock;
  const openTag = cellBlock.slice(0, openEnd + 1).replace(/\s+t="[^"]*"/g, "");
  return `${openTag}<v>${newValue}</v></c>`;
}

function modifySheetXml(xml: string, cellChanges: Map<string, number>): string {
  for (const [addr, newValue] of cellChanges) {
    const attrStr = `r="${addr}"`;
    const rPos = xml.indexOf(attrStr);
    if (rPos === -1) {
      xml = insertMissingCell(xml, addr, newValue);
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
      const newBlock = cellBlock.replace(/\s+t="[^"]*"/g, "").replace(/\s*\/>$/, `><v>${newValue}</v></c>`);
      xml = xml.substring(0, cOpen) + newBlock + xml.substring(selfClose + 2);
      continue;
    }

    const cellBlock = xml.substring(cOpen, cClose + 4);
    if (cellBlock.includes("<f>") || cellBlock.includes("<f ")) continue;

    xml = xml.substring(0, cOpen) + replaceNumericCellBlock(cellBlock, newValue) + xml.substring(cClose + 4);
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

export async function applyAdditionalWorkToPayroll(
  buffer: ArrayBuffer,
  entries: AdditionalWorkEntry[]
): Promise<AdditionalWorkPayrollResult> {
  const wb = XLSX.read(buffer, { type: "array" });
  const aggregated = aggregateEntries(entries);
  const applied: AppliedAdditionalWork[] = [];
  const unmatched: UnmatchedAdditionalWork[] = [];
  const allCellChanges = new Map<string, Map<string, number>>();

  const rowsByName = new Map<string, Array<{ sheetName: string; row: number; layout: PayrollLayout }>>();

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const layout = detectPayrollLayout(ws);
    if (!layout) continue;

    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let r = layout.dataStartRow; r <= range.e.r; r++) {
      const name = getCellText(ws, r, layout.nameCol);
      if (!name) continue;
      const key = normalizeName(name);
      if (!key) continue;
      const list = rowsByName.get(key) ?? [];
      list.push({ sheetName, row: r, layout });
      rowsByName.set(key, list);
    }
  }

  for (const entry of aggregated) {
    const key = normalizeName(entry.name);
    const matches = rowsByName.get(key) ?? [];

    if (matches.length === 0) {
      unmatched.push({ name: entry.name, trade: entry.trade, units: entry.units, reason: "급여대장에서 이름을 찾지 못했습니다." });
      continue;
    }

    if (matches.length > 1) {
      unmatched.push({ name: entry.name, trade: entry.trade, units: entry.units, reason: "급여대장에 같은 이름이 2명 이상 있습니다." });
      continue;
    }

    const match = matches[0];
    const ws = wb.Sheets[match.sheetName];
    const unitPrice = getCellNumber(ws, match.row, match.layout.unitPriceCol);
    if (unitPrice <= 0) {
      unmatched.push({ name: entry.name, trade: entry.trade, units: entry.units, reason: "단가가 비어있거나 0입니다." });
      continue;
    }

    const expense2Before = getCellNumber(ws, match.row, match.layout.expense2Col);
    const salaryBefore = getCellNumber(ws, match.row, match.layout.salaryCol);
    const expense2After = roundMoney(entry.units * unitPrice);
    const salaryAfter = roundMoney(salaryBefore + (expense2After - expense2Before));
    const expense2Addr = XLSX.utils.encode_cell({ r: match.row, c: match.layout.expense2Col });
    const salaryAddr = XLSX.utils.encode_cell({ r: match.row, c: match.layout.salaryCol });
    const sheetChanges = allCellChanges.get(match.sheetName) ?? new Map<string, number>();

    sheetChanges.set(expense2Addr, expense2After);
    sheetChanges.set(salaryAddr, salaryAfter);
    allCellChanges.set(match.sheetName, sheetChanges);

    applied.push({
      sheetName: match.sheetName,
      rowNumber: match.row + 1,
      name: entry.name,
      payrollJobTitle: getCellText(ws, match.row, match.layout.jobTitleCol),
      trade: entry.trade,
      units: entry.units,
      unitPrice,
      expense2Before,
      expense2After,
      salaryBefore,
      salaryAfter,
    });
  }

  const zip = await JSZip.loadAsync(buffer);
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

  return { outputBuffer, applied, unmatched };
}
