import * as XLSX from "xlsx";
import JSZip from "jszip";

export interface AdditionalWorkEntry {
  name: string;
  trade: string;
  units: number;
  sourceLine?: string;
  payrollRowKey?: string;
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

export interface PayrollEmployeeOption {
  name: string;
  jobTitle: string;
  residentNo: string;
  rowKey: string;
}

export interface AdditionalWorkParseOptions {
  knownNames?: string[];
}

interface PayrollLayout {
  nameCol: number;
  jobTitleCol: number;
  residentNoCol: number;
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
  let residentNoCol = -1;
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
      } else if (text === "주민번호" || text === "주민등록번호") {
        residentNoCol = c;
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
    residentNoCol,
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
    const key = `${name}|${entry.payrollRowKey ?? ""}`;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, {
        name: entry.name.trim(),
        trade: entry.trade.trim(),
        units: entry.units,
        sourceLine: entry.sourceLine,
        payrollRowKey: entry.payrollRowKey,
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

function cleanOcrCell(value: string): string {
  return value
    .replace(/[\[\]{}()]/g, " ")
    .replace(/[ㆍ_~」=.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseOcrUnit(text: string): number | null {
  const normalized = text
    .toLowerCase()
    .replace(/[,\]]/g, ".")
    .replace(/\s+/g, " ");

  if (/(^|[^0-9])2(?:\.00)?([^0-9]|$)/.test(normalized) || /200/.test(normalized)) return 2;
  if (
    /(^|[^0-9])1(?:\.00)?([^0-9]|$)/.test(normalized) ||
    /100/.test(normalized) ||
    /\b(?:roo|too|oof|roof|oo)\b/.test(normalized)
  ) {
    return 1;
  }

  return null;
}

function parsePlainUnit(text: string): number | null {
  const normalized = text.replace(",", ".").replace(/\s+/g, "").trim();
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value === 100) return 1;
  if (value === 200) return 2;
  return value;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function knownNamesByLength(names: string[] | undefined): string[] {
  const unique = new Map<string, string>();
  for (const rawName of names ?? []) {
    const name = compactText(rawName);
    if (name.length < 2) continue;
    unique.set(name, name);
  }
  return Array.from(unique.values()).sort((a, b) => b.length - a.length);
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;

  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function correctKnownName(name: string, knownNames: string[]): string {
  const compact = compactText(name);
  if (!compact || knownNames.length === 0) return compact;
  if (knownNames.includes(compact)) return compact;
  if (compact.length < 3) return compact;

  const candidates = knownNames.filter((knownName) =>
    knownName.length === compact.length && editDistance(compact, knownName) === 1
  );

  return candidates.length === 1 ? candidates[0] : compact;
}

function parseSplitCellUnit(raw: string, clean: string): number | null {
  return parsePlainUnit(raw) ?? parsePlainUnit(clean) ?? parseOcrUnit(raw) ?? parseOcrUnit(clean);
}

function isOcrHeaderCell(value: string): boolean {
  const compact = value.replace(/\s+/g, "").toLowerCase();
  return /^(no|번호|순번|이름|성명|성함|공종|직종|추가|추가공수|추가요청공수|요청공수)$/.test(compact);
}

function isOcrRowNumber(value: string): boolean {
  return /^\d{1,3}$/.test(value.replace(/\s+/g, ""));
}

function isLikelySplitName(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  return /^[가-힣]{2,4}$/.test(compact) || /^[A-Za-z]{2,20}$/.test(compact);
}

function isLikelySplitTrade(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (!compact || isOcrHeaderCell(compact) || isOcrRowNumber(compact)) return false;
  if (parseSplitCellUnit(value, compact) !== null) return false;
  return compact.length <= 20;
}

function isDateCell(value: string): boolean {
  return /20\d{2}[-./]\d{1,2}[-./]\d{1,2}/.test(value.replace(/\s+/g, ""));
}

function isLikelyIndexedTrade(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (!compact || isOcrHeaderCell(compact) || isOcrRowNumber(compact)) return false;
  if (isDateCell(compact)) return false;
  if (parseSplitCellUnit(value, compact) !== null) return false;
  return compact.length <= 20;
}

function parseIndexedPdfRows(lines: string[], knownNames: string[]): AdditionalWorkEntry[] {
  const cells = lines
    .map((raw) => ({ raw, clean: cleanOcrCell(raw) }))
    .filter((cell) => cell.clean && !isOcrHeaderCell(cell.clean));

  const rows: AdditionalWorkEntry[] = [];

  for (let i = 0; i < cells.length - 4; i++) {
    const rowNoCell = cells[i];
    if (!isOcrRowNumber(rowNoCell.clean)) continue;

    const rowNo = Number(rowNoCell.clean.replace(/\s+/g, ""));
    if (!Number.isInteger(rowNo) || rowNo <= 0 || rowNo > 300) continue;

    const nameCell = cells[i + 1];
    const tradeCell = cells[i + 2];
    const dateCell = cells[i + 3];
    const unitCell = cells[i + 4];
    if (!nameCell || !tradeCell || !dateCell || !unitCell) continue;

    const units = parseSplitCellUnit(unitCell.raw, unitCell.clean);
    if (
      !isLikelySplitName(nameCell.clean) ||
      !isLikelyIndexedTrade(tradeCell.clean) ||
      !isDateCell(dateCell.clean) ||
      units === null
    ) {
      continue;
    }

    rows.push({
      name: correctKnownName(nameCell.clean, knownNames),
      trade: compactText(tradeCell.clean),
      units,
      sourceLine: [rowNoCell.raw, nameCell.raw, tradeCell.raw, dateCell.raw, unitCell.raw].join(" "),
    });
    i += 4;
  }

  return rows;
}

function parseSplitCellRows(lines: string[]): AdditionalWorkEntry[] {
  const cells = lines
    .map((raw) => ({ raw, clean: cleanOcrCell(raw) }))
    .filter((cell) => cell.clean && !isOcrHeaderCell(cell.clean));

  const rows: AdditionalWorkEntry[] = [];

  for (let i = 0; i < cells.length - 2; i++) {
    const start = isOcrRowNumber(cells[i].clean) ? i + 1 : i;
    const nameCell = cells[start];
    const tradeCell = cells[start + 1];
    const unitCell = cells[start + 2];
    if (!nameCell || !tradeCell || !unitCell) continue;

    const units = parseSplitCellUnit(unitCell.raw, unitCell.clean);
    if (!isLikelySplitName(nameCell.clean) || !isLikelySplitTrade(tradeCell.clean) || units === null) continue;

    rows.push({
      name: nameCell.clean.replace(/\s+/g, ""),
      trade: compactText(tradeCell.clean),
      units,
      sourceLine: [nameCell.raw, tradeCell.raw, unitCell.raw].join(" "),
    });
    i = start + 2;
  }

  return rows;
}

function parseKnownNameLine(line: string, unitsIndex: number, units: number, knownNames: string[]): AdditionalWorkEntry | null {
  if (knownNames.length === 0) return null;

  const beforeUnits = line.slice(0, unitsIndex).trim();
  const compactBeforeUnits = compactText(beforeUnits);
  for (const knownName of knownNames) {
    const nameIndex = compactBeforeUnits.indexOf(knownName);
    if (nameIndex < 0) continue;

    const trade = compactBeforeUnits.slice(nameIndex + knownName.length);
    if (!trade || /^\d+$/.test(trade) || isOcrHeaderCell(trade)) continue;

    return {
      name: knownName,
      trade: compactText(trade),
      units,
      sourceLine: line,
    };
  }

  return null;
}

function parseTableOcrLine(line: string): AdditionalWorkEntry | null {
  if (!/[|ㅣ]/.test(line)) return null;

  const parts = line
    .split(/[|ㅣ]/)
    .map(cleanOcrCell)
    .filter(Boolean);

  let rowIndex = parts.findIndex((part) => /^\d{1,3}$/.test(part));
  let name: string | undefined;
  let trade: string | undefined;
  let rest = "";

  if (rowIndex >= 0) {
    name = parts[rowIndex + 1];
    trade = parts[rowIndex + 2];
    rest = parts.slice(rowIndex + 3).join(" ");
  } else {
    const first = parts[0]?.match(/^(\d{1,3})\s+(.+)$/);
    if (!first) return null;
    rowIndex = 0;
    name = first[2]?.trim();
    trade = parts[1];
    rest = parts.slice(2).join(" ");
  }

  if (!name || !trade) return null;
  if (/^(이름|성명|공종|추가|no)$/i.test(name.replace(/\s+/g, ""))) return null;

  const units = parseOcrUnit(rest || line);
  if (!units) return null;

  return {
    name: compactText(name),
    trade: compactText(trade),
    units,
    sourceLine: line.trim(),
  };
}

export function parseAdditionalWorkText(text: string, options: AdditionalWorkParseOptions = {}): AdditionalWorkEntry[] {
  const rows: AdditionalWorkEntry[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const knownNames = knownNamesByLength(options.knownNames);
  const indexedRows = parseIndexedPdfRows(lines, knownNames);

  if (indexedRows.length > 0) {
    return indexedRows;
  }

  for (const rawLine of lines) {
    const tableRow = parseTableOcrLine(rawLine);
    if (tableRow) {
      rows.push(tableRow);
      continue;
    }

    const line = rawLine.replace(/[|:;]/g, " ").replace(/\s+/g, " ").trim();
    const compact = line.replace(/\s+/g, "");
    if (/^(이름|성명|공종|추가|NO|No|no)/.test(compact)) continue;

    const unitsMatch = line.match(/(\d+(?:[.,]\d+)?)\s*$/);
    if (!unitsMatch || unitsMatch.index == null) continue;

    const units = parsePlainUnit(unitsMatch[1]);
    if (units === null) continue;

    const knownNameRow = parseKnownNameLine(line, unitsMatch.index, units, knownNames);
    if (knownNameRow) {
      rows.push(knownNameRow);
      continue;
    }

    const beforeUnits = line.slice(0, unitsMatch.index).trim();
    const tokens = beforeUnits.split(/\s+/).filter(Boolean);
    const nameIndex = tokens.findIndex((token) => /^[가-힣]{2,4}$/.test(token));
    if (nameIndex < 0) continue;

    const name = tokens[nameIndex];
    const trade = compactText(tokens.slice(nameIndex + 1).join(""));
    if (!trade) continue;

    rows.push({ name, trade, units, sourceLine: line });
  }

  if (rows.length === 0) {
    rows.push(...parseSplitCellRows(lines));
  }

  return rows;
}

export function readPayrollEmployeeOptions(buffer: ArrayBuffer): PayrollEmployeeOption[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const rows: PayrollEmployeeOption[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const layout = detectPayrollLayout(ws);
    if (!layout) continue;

    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    for (let r = layout.dataStartRow; r <= range.e.r; r++) {
      const name = getCellText(ws, r, layout.nameCol);
      if (!normalizeName(name)) continue;
      rows.push({
        name,
        jobTitle: getCellText(ws, r, layout.jobTitleCol),
        residentNo: layout.residentNoCol >= 0 ? getCellText(ws, r, layout.residentNoCol) : "",
        rowKey: `${sheetName}!${r + 1}`,
      });
    }
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
    const selectedMatch = entry.payrollRowKey
      ? matches.find((match) => `${match.sheetName}!${match.row + 1}` === entry.payrollRowKey)
      : null;

    if (matches.length === 0) {
      unmatched.push({ name: entry.name, trade: entry.trade, units: entry.units, reason: "급여대장에서 이름을 찾지 못했습니다." });
      continue;
    }

    if (entry.payrollRowKey && !selectedMatch) {
      unmatched.push({ name: entry.name, trade: entry.trade, units: entry.units, reason: "선택한 급여대장 행을 찾지 못했습니다." });
      continue;
    }

    if (matches.length > 1 && !selectedMatch) {
      unmatched.push({ name: entry.name, trade: entry.trade, units: entry.units, reason: "급여대장에 같은 이름이 2명 이상 있습니다." });
      continue;
    }

    const match = selectedMatch ?? matches[0];
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
