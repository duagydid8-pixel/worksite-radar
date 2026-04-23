import { useState, useEffect, useMemo, useRef } from "react";
import { Search, X, Download, Upload, FolderOpen, CalendarDays, Trash2, ChevronLeft, ChevronRight, AlertTriangle, Clock, CheckCircle2, XCircle, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { loadXerpFS, saveXerpFS, loadXerpPH2FS, saveXerpPH2FS, loadEmployeesPH4FS, loadEmployeesPH2FS, loadSafetyEduDatesFS, saveSafetyEduDatesFS } from "@/lib/firestoreService";

// ── 타입 ──────────────────────────────────────────────
interface XerpPmisRow {
  id: string;
  팀명: string; 직종: string; 사번: string; 성명: string; 생년월일: string;
  xerp출근: string; xerp퇴근: string;
  pmis출근: string; pmis퇴근: string;
  조출: string; 오전: string; 오후: string; 연장: string;
  야간: string; 철야: string; 점심: string; 공수합계A: string;
  초과당일: string; 초과합계: string;
  가산신청: string; 가산승인: string;
  공수합계AB: string; 월누계: string;
}

type DateMap = Record<string, XerpPmisRow[]>; // key = "YYYY-MM-DD"

// ── 열 위치(0-based) 매핑 ────────────────────────────
const COL_MAP: Record<number, keyof XerpPmisRow> = {
  0:"팀명", 1:"직종", 2:"사번", 3:"성명", 4:"생년월일",
  5:"xerp출근", 6:"xerp퇴근", 7:"pmis출근", 8:"pmis퇴근",
  9:"조출", 10:"오전", 11:"오후", 12:"연장", 13:"야간", 14:"철야", 15:"점심", 16:"공수합계A",
  17:"초과당일", 18:"초과합계", 19:"가산신청", 20:"가산승인",
  21:"공수합계AB", 22:"월누계",
};

const HEADER_KEYWORDS = new Set(["팀명","팀","직종","사번","성명","이름","생년월일"]);
function isHeaderRow(row: unknown[]): boolean {
  return row.some((c) => HEADER_KEYWORDS.has(String(c).trim()));
}

function emptyRow(): XerpPmisRow {
  return {
    id: crypto.randomUUID(),
    팀명:"", 직종:"", 사번:"", 성명:"", 생년월일:"",
    xerp출근:"", xerp퇴근:"", pmis출근:"", pmis퇴근:"",
    조출:"", 오전:"", 오후:"", 연장:"", 야간:"", 철야:"", 점심:"", 공수합계A:"",
    초과당일:"", 초과합계:"", 가산신청:"", 가산승인:"",
    공수합계AB:"", 월누계:"",
  };
}

function parseSheet(wb: XLSX.WorkBook): XerpPmisRow[] {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (raw.length === 0) return [];
  let dataStart = 0;
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    if (isHeaderRow(raw[i])) dataStart = i + 1;
  }
  const results: XerpPmisRow[] = [];
  for (let i = dataStart; i < raw.length; i++) {
    const row = raw[i];
    if (row.every((c) => String(c).trim() === "")) continue;
    const emp = emptyRow();
    for (const [colStr, field] of Object.entries(COL_MAP)) {
      emp[field] = String(row[Number(colStr)] ?? "").trim();
    }
    results.push(emp);
  }
  return results;
}

// ── 날짜 유틸 ─────────────────────────────────────────
function toDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatLabel(dateStr: string): string {
  const [y, m, dd] = dateStr.split("-");
  return `${y}년 ${Number(m)}월 ${Number(dd)}일`;
}

// 달력용: 해당 월의 날짜 배열 (null = 빈 칸 패딩)
function buildCalendarDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=일
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

// 특정 날짜에서 직원 레코드 검색
function getEmpRecord(
  dateMap: DateMap,
  year: number, month: number, day: number,
  emp: XerpPmisRow
): XerpPmisRow | null {
  const key = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  const rows = dateMap[key];
  if (!rows?.length) return null;
  if (emp.사번) {
    const found = rows.find((r) => r.사번 === emp.사번);
    if (found) return found;
  }
  return rows.find((r) => r.성명 === emp.성명) ?? null;
}

// ── 연속 결근 감지 ────────────────────────────────────
// 평일(월~금) 기준으로 dateMap의 업로드 날짜들을 순서대로 확인하여
// 3일 이상 연속으로 출근 기록이 없는 직원 목록을 반환한다.
function detectConsecutiveAbsences(dateMap: DateMap): XerpPmisRow[] {
  // 평일 업로드 날짜만 정렬
  const weekdayDates = Object.keys(dateMap)
    .filter((d) => {
      const dow = new Date(d + "T00:00:00").getDay();
      return dow >= 1 && dow <= 5;
    })
    .sort();

  if (weekdayDates.length < 3) return [];

  // 전체 직원 수집 (사번 우선, 없으면 성명 키)
  const empMap = new Map<string, XerpPmisRow>();
  for (const rows of Object.values(dateMap)) {
    for (const row of rows) {
      const key = row.사번 || row.성명;
      if (key && !empMap.has(key)) empMap.set(key, row);
    }
  }

  const result: XerpPmisRow[] = [];

  for (const [, emp] of empMap) {
    // 이 직원이 처음 등장한 날짜부터 체크
    let firstDate: string | null = null;
    for (const d of weekdayDates) {
      const rows = dateMap[d];
      const rec = emp.사번
        ? rows?.find((r) => r.사번 === emp.사번)
        : rows?.find((r) => r.성명 === emp.성명);
      if (rec) { firstDate = d; break; }
    }
    if (!firstDate) continue;

    let consecutive = 0;
    for (const d of weekdayDates) {
      if (d < firstDate) continue;
      const rows = dateMap[d];
      const rec = emp.사번
        ? rows?.find((r) => r.사번 === emp.사번)
        : rows?.find((r) => r.성명 === emp.성명);
      const hasCheckIn = rec && (rec.xerp출근 || rec.pmis출근);

      if (!hasCheckIn) {
        consecutive++;
      } else {
        consecutive = 0;
      }
    }
    if (consecutive >= 3) result.push(emp);
  }

  return result;
}

// ── 파일명에서 날짜 추출 ──────────────────────────────
// YYYYMMDD, YYYY-MM-DD, YYYY.MM.DD, YY.MM.DD 등 패턴을 찾아 "YYYY-MM-DD" 반환
function extractDateFromFilename(filename: string): string | null {
  const name = filename.replace(/\.[^.]+$/, "");

  // YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD (4자리 연도 우선)
  const sep = name.match(/(\d{4})[-./](\d{2})[-./](\d{2})/);
  if (sep) {
    const [, y, m, d] = sep;
    const date = new Date(`${y}-${m}-${d}T00:00:00`);
    if (!isNaN(date.getTime())) return `${y}-${m}-${d}`;
  }

  // YYYYMMDD (8자리 연속)
  const compact = name.match(/(\d{4})(\d{2})(\d{2})/);
  if (compact) {
    const [, y, m, d] = compact;
    const mo = Number(m), dy = Number(d);
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
      const date = new Date(`${y}-${m}-${d}T00:00:00`);
      if (!isNaN(date.getTime())) return `${y}-${m}-${d}`;
    }
  }

  // YY.MM.DD (2자리 연도, 예: 26.04.01 → 2026-04-01)
  const yy = name.match(/(?<!\d)(\d{2})\.(\d{2})\.(\d{2})(?!\d)/);
  if (yy) {
    const [, y2, m, d] = yy;
    const y = `20${y2}`;
    const mo = Number(m), dy = Number(d);
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
      const date = new Date(`${y}-${m}-${d}T00:00:00`);
      if (!isNaN(date.getTime())) return `${y}-${m}-${d}`;
    }
  }

  return null;
}

// ── 주민번호 뒷자리 마스킹 ────────────────────────────
function maskResidentNum(value: string, isAdmin: boolean): string {
  if (isAdmin || !value || value === "—") return value;
  const dashIdx = value.indexOf("-");
  if (dashIdx !== -1) {
    return value.slice(0, dashIdx + 1) + "*".repeat(value.length - dashIdx - 1);
  }
  // 대시 없이 13자리인 경우
  if (value.replace(/\D/g, "").length >= 13) {
    return value.slice(0, 6) + "-*******";
  }
  return value;
}

// ── 상수 ─────────────────────────────────────────────
const TODAY = toDateStr();
const DOW = ["일","월","화","수","목","금","토"];

const cell = "px-2 py-1.5 text-xs text-center whitespace-nowrap border-r border-border/40 last:border-r-0";
const cellNum = `${cell} tabular-nums`;

// ── 행 상세 검증 모달 ─────────────────────────────────
interface RowDetailModalProps {
  row: XerpPmisRow;
  date: string;
  onClose: () => void;
}

function PunchBadge({ label, time, color }: { label: string; time: string; color: string }) {
  const has = time && time !== "—" && time !== "0" && time !== "";
  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl border p-3 gap-1 ${has ? color : "border-gray-100 bg-gray-50"}`}>
      <span className={`text-[10px] font-semibold ${has ? "" : "text-gray-300"}`}>{label}</span>
      <span className={`text-lg font-bold tabular-nums tracking-tight ${has ? "" : "text-gray-300"}`}>
        {has ? time : "—"}
      </span>
    </div>
  );
}

function GongsuChip({ label, value }: { label: string; value: string }) {
  const active = value && value !== "N" && value !== "0" && value !== "" && value !== "—";
  return (
    <div className={`flex flex-col items-center rounded-xl border px-2.5 py-2 gap-0.5 min-w-[44px]
      ${active ? "border-primary/30 bg-primary/5" : "border-gray-100 bg-gray-50"}`}>
      <span className="text-[10px] text-gray-400 font-semibold">{label}</span>
      {active
        ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
        : <XCircle className="h-3.5 w-3.5 text-gray-200" />}
      {active && value !== "Y" && value !== "N" && (
        <span className="text-[11px] font-bold text-primary tabular-nums">{value}</span>
      )}
    </div>
  );
}

function RowDetailModal({ row, date, onClose }: RowDetailModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const [y, m, d] = date.split("-");
  const dateLabel = `${y}년 ${Number(m)}월 ${Number(d)}일`;

  const gongsuA   = parseFloat(row.공수합계A)  || 0;
  const gaasan    = parseFloat(row.가산신청)   || 0;
  const gaasanOK  = parseFloat(row.가산승인)   || 0;
  const gongsuAB  = parseFloat(row.공수합계AB) || 0;
  const wolNuGye  = parseFloat(row.월누계)     || 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">

        {/* 헤더 */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-gray-900">{row.성명}</span>
              {row.팀명 && <span className="text-xs text-gray-400 font-medium">{row.팀명}</span>}
              {row.직종 && <span className="text-xs text-gray-400">· {row.직종}</span>}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Clock className="h-3 w-3 text-gray-400" />
              <span className="text-xs text-gray-400">{dateLabel}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors mt-0.5">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">

          {/* 타각 시간 */}
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">타각 시간</p>
            <div className="grid grid-cols-2 gap-2">
              <PunchBadge label="XERP 출근" time={row.xerp출근} color="border-blue-200 bg-blue-50 text-blue-700" />
              <PunchBadge label="XERP 퇴근" time={row.xerp퇴근} color="border-red-200 bg-red-50 text-red-700" />
              <PunchBadge label="PMIS 출근" time={row.pmis출근} color="border-blue-100 bg-blue-50/60 text-blue-500" />
              <PunchBadge label="PMIS 퇴근" time={row.pmis퇴근} color="border-red-100 bg-red-50/60 text-red-400" />
            </div>
          </div>

          {/* 공수 체크 A */}
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">공수 체크 (A)</p>
            <div className="flex flex-wrap gap-1.5">
              <GongsuChip label="조출" value={row.조출} />
              <GongsuChip label="오전" value={row.오전} />
              <GongsuChip label="오후" value={row.오후} />
              <GongsuChip label="연장" value={row.연장} />
              <GongsuChip label="야간" value={row.야간} />
              <GongsuChip label="철야" value={row.철야} />
              <GongsuChip label="점심" value={row.점심} />
            </div>
          </div>

          {/* 공수 수치 */}
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">공수 내역</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "공수합계 A",  value: row.공수합계A,  color: "text-gray-800" },
                { label: "초과 당일",   value: row.초과당일,   color: "text-gray-600" },
                { label: "초과 합계",   value: row.초과합계,   color: "text-gray-600" },
                { label: "가산 신청",   value: row.가산신청,   color: "text-amber-600" },
                { label: "가산 승인",   value: row.가산승인,   color: "text-emerald-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                  <span className="text-xs text-gray-500">{label}</span>
                  <span className={`text-sm font-bold tabular-nums ${color}`}>{value || "0"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 최종 공수합계 */}
          <div className="rounded-2xl border-2 border-primary/20 bg-primary/5 p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-primary/60">공수합계 (A+B)</p>
              <p className="text-3xl font-bold text-primary tabular-nums">{gongsuAB || "0"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-gray-400">월누계</p>
              <p className="text-2xl font-bold text-gray-700 tabular-nums">{wolNuGye || "0"}</p>
            </div>
          </div>

          {/* 검증 요약 */}
          {(() => {
            const calcAB = Math.round((gongsuA + gaasan) * 100) / 100;
            const match  = Math.abs(calcAB - gongsuAB) < 0.01;
            return (
              <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold
                ${match ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                        : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
                {match
                  ? <><CheckCircle2 className="h-4 w-4 shrink-0" /> 공수합계 일치 (A {gongsuA} + 가산 {gaasan} = {calcAB})</>
                  : <><AlertTriangle className="h-4 w-4 shrink-0" /> 공수합계 불일치 — A {gongsuA} + 가산 {gaasan} = {calcAB}, 기록값 {gongsuAB}</>}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ── 달력 모달 컴포넌트 ─────────────────────────────────
interface CalendarModalProps {
  emp: XerpPmisRow;
  year: number;
  month: number;
  dateMap: DateMap;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

function CalendarModal({ emp, year, month, dateMap, onPrev, onNext, onClose }: CalendarModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const days = buildCalendarDays(year, month);
  const todayStr = toDateStr();
  const [ty, tm, td] = todayStr.split("-").map(Number);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden">
        {/* 모달 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-primary" />
            <div>
              <span className="font-bold text-foreground text-base">{emp.성명}</span>
              {emp.팀명 && <span className="ml-2 text-xs text-muted-foreground">{emp.팀명}</span>}
              {emp.직종 && <span className="ml-1 text-xs text-muted-foreground">· {emp.직종}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* 월 네비게이션 */}
        <div className="flex items-center justify-center gap-6 px-5 py-3 border-b border-border/60">
          <button onClick={onPrev} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <ChevronLeft className="h-5 w-5 text-foreground" />
          </button>
          <span className="text-base font-bold text-foreground min-w-[110px] text-center">
            {year}년 {month}월
          </span>
          <button onClick={onNext} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <ChevronRight className="h-5 w-5 text-foreground" />
          </button>
        </div>

        {/* 달력 */}
        <div className="p-4 overflow-auto">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 mb-1">
            {DOW.map((d, i) => (
              <div
                key={d}
                className={`text-center text-xs font-bold py-1.5
                  ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-muted-foreground"}`}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day, idx) => {
              if (day === null) {
                return <div key={`pad-${idx}`} className="min-h-[72px] rounded-lg bg-muted/20" />;
              }

              const rec = getEmpRecord(dateMap, year, month, day, emp);
              const isToday = year === ty && month === tm && day === td;
              const dow = (idx % 7); // 0=일, 6=토
              const isSun = dow === 0;
              const isSat = dow === 6;

              // 표시할 시간 결정
              const hasXerp = rec && (rec.xerp출근 || rec.xerp퇴근);
              const inTime = hasXerp ? rec!.xerp출근 : (rec?.pmis출근 ?? "");
              const outTime = hasXerp ? rec!.xerp퇴근 : (rec?.pmis퇴근 ?? "");
              const isPmis = !hasXerp && rec && (inTime || outTime);

              return (
                <div
                  key={day}
                  className={`min-h-[72px] rounded-lg border p-1.5 flex flex-col gap-0.5
                    ${isToday ? "border-primary bg-primary/5" : "border-border/40 bg-white"}
                    ${rec ? "" : "opacity-60"}
                  `}
                >
                  {/* 날짜 숫자 */}
                  <div className={`text-xs font-bold leading-none mb-1
                    ${isToday ? "text-primary" : isSun ? "text-red-500" : isSat ? "text-blue-500" : "text-foreground"}
                  `}>
                    {day}
                  </div>

                  {/* 출근 시간 */}
                  {inTime ? (
                    <div className={`text-[10px] font-semibold leading-tight tabular-nums
                      ${isPmis ? "text-blue-400" : "text-blue-600"}`}
                    >
                      ▲ {inTime}
                    </div>
                  ) : rec ? (
                    <div className="text-[10px] text-muted-foreground/50 leading-tight">▲ —</div>
                  ) : null}

                  {/* 퇴근 시간 */}
                  {outTime ? (
                    <div className={`text-[10px] font-semibold leading-tight tabular-nums
                      ${isPmis ? "text-red-400" : "text-red-600"}`}
                    >
                      ▼ {outTime}
                    </div>
                  ) : rec ? (
                    <div className="text-[10px] text-muted-foreground/50 leading-tight">▼ —</div>
                  ) : null}

                  {/* 공수합계AB */}
                  {rec?.공수합계AB && rec.공수합계AB !== "0" && (
                    <div className="text-[10px] font-bold text-emerald-600 leading-tight tabular-nums mt-auto">
                      공 {rec.공수합계AB}
                    </div>
                  )}

                  {/* PMIS 표시 */}
                  {isPmis && !rec?.공수합계AB && (
                    <div className="text-[9px] text-muted-foreground/60 leading-tight mt-auto">PMIS</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 범례 */}
        <div className="flex items-center gap-4 px-5 py-3 border-t border-border/60 bg-muted/20 text-[11px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />
            X-ERP 출근
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" />
            X-ERP 퇴근
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" />
            PMIS 출근 (대체)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" />
            PMIS 퇴근 (대체)
          </span>
        </div>
      </div>
    </div>
  );
}

// ── 컴포넌트 ──────────────────────────────────────────
interface Props { isAdmin: boolean; site?: "PH4" | "PH2" }

export default function XerpPmisTable({ isAdmin, site = "PH4" }: Props) {
  const loadXerp = site === "PH2" ? loadXerpPH2FS : loadXerpFS;
  const saveXerp = site === "PH2" ? saveXerpPH2FS : saveXerpFS;
  const [dateMap, setDateMap] = useState<DateMap>({});
  const [selectedDate, setSelectedDate] = useState<string>(TODAY);
  const [resignedNames, setResignedNames] = useState<Set<string>>(new Set());
  const [uploadDate, setUploadDate] = useState<string>(TODAY);
  const [search, setSearch] = useState("");
  const [safetyEduDates, setSafetyEduDates] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 달력 모달 상태
  const [calendarEmp, setCalendarEmp] = useState<XerpPmisRow | null>(null);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1);

  // 행 상세 모달 상태
  const [detailRow, setDetailRow] = useState<XerpPmisRow | null>(null);

  // 정렬 상태
  type SortCol = "xerp출근" | "xerp퇴근" | "pmis출근" | "pmis퇴근";
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpDown className="h-3 w-3 opacity-30 ml-0.5 inline-block" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 ml-0.5 inline-block text-primary" />
      : <ArrowDown className="h-3 w-3 ml-0.5 inline-block text-primary" />;
  };

  const openCalendar = (emp: XerpPmisRow) => {
    const now = new Date();
    setCalendarYear(now.getFullYear());
    setCalendarMonth(now.getMonth() + 1);
    setCalendarEmp(emp);
  };

  const prevMonth = () => {
    if (calendarMonth === 1) { setCalendarYear((y) => y - 1); setCalendarMonth(12); }
    else setCalendarMonth((m) => m - 1);
  };

  const nextMonth = () => {
    if (calendarMonth === 12) { setCalendarYear((y) => y + 1); setCalendarMonth(1); }
    else setCalendarMonth((m) => m + 1);
  };

  // 연속 3일 이상 결근 감지 — 퇴사자 제외
  const absentEmployees = useMemo(() => {
    const allAbsent = detectConsecutiveAbsences(dateMap);
    return allAbsent.filter((emp) => !resignedNames.has(emp.성명));
  }, [dateMap, resignedNames]);

  const isSafetyEduDate = safetyEduDates.has(selectedDate);

  const toggleSafetyEdu = () => {
    if (!isAdmin) return;
    const next = new Set(safetyEduDates);
    if (next.has(selectedDate)) next.delete(selectedDate);
    else next.add(selectedDate);
    setSafetyEduDates(next);
    saveSafetyEduDatesFS([...next]).then((ok) => {
      if (!ok) toast.error("정기안전교육 설정 저장 실패");
    });
  };

  // 마운트 시 안내 알림
  useEffect(() => {
    toast.info("성명 옆 달력 아이콘을 클릭하면 상세한 출퇴근기록과 공수를 확인할 수 있습니다.", {
      duration: 4000,
    });
  }, []);

  // 마운트 시 Firestore에서 로드
  useEffect(() => {
    // 퇴사자 명단 로드 (PH4 + PH2)
    Promise.all([loadEmployeesPH4FS(), loadEmployeesPH2FS()]).then(([ph4, ph2]) => {
      const names = new Set<string>();
      for (const rows of [ph4, ph2]) {
        if (!Array.isArray(rows)) continue;
        for (const emp of rows as { 이름?: string; 퇴사일?: string }[]) {
          if (emp.퇴사일 && emp.이름) names.add(emp.이름);
        }
      }
      setResignedNames(names);
    });

    loadXerp().then((fsMap) => {
      if (fsMap && typeof fsMap === "object" && Object.keys(fsMap).length > 0) {
        const typed = fsMap as DateMap;
        setDateMap(typed);
        const dates = Object.keys(typed).sort().reverse();
        if (dates[0]) setSelectedDate(dates[0]);
      }
    });

    loadSafetyEduDatesFS().then((dates) => {
      setSafetyEduDates(new Set(dates));
    });
  }, []);

  // 날짜 변경 시 선택 초기화
  useEffect(() => { setSelectedIds(new Set()); }, [selectedDate]);

  // Firestore 저장 헬퍼
  const syncXerpFS = (map: DateMap) => {
    saveXerp(map).then((ok) => {
      if (!ok) toast.error("Firestore 저장 실패");
    });
  };

  // 날짜 목록 (최신순)
  const availableDates = useMemo(
    () => Object.keys(dateMap).sort().reverse(),
    [dateMap]
  );

  // 현재 선택 날짜의 행
  const currentRows = dateMap[selectedDate] ?? [];

  const displayRows = useMemo(() => {
    const q = search.trim();
    let rows = q
      ? currentRows.filter((r) => r.성명.includes(q) || r.사번.includes(q))
      : [...currentRows];

    if (sortCol) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortCol] || "9999";
        const bv = b[sortCol] || "9999";
        const cmp = av.localeCompare(bv);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [currentRows, search, sortCol, sortDir]);

  // ── 일괄 선택 ──
  const allSelected = displayRows.length > 0 && displayRows.every((r) => selectedIds.has(r.id));
  const someSelected = !allSelected && displayRows.some((r) => selectedIds.has(r.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        displayRows.forEach((r) => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        displayRows.forEach((r) => next.add(r.id));
        return next;
      });
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleExportSelected = () => {
    const rows = currentRows.filter((r) => selectedIds.has(r.id));
    if (rows.length === 0) return;
    const headers = [
      "팀명","직종","사번","성명","생년월일",
      "X-ERP 출근","X-ERP 퇴근","PMIS 출근","PMIS 퇴근",
      "조출","오전","오후","연장","야간","철야","점심","공수합계A",
      "초과당일","초과합계","가산신청","가산승인","공수합계(A+B)","월누계",
    ];
    const dataRows = rows.map((r) => [
      r.팀명,r.직종,r.사번,r.성명,r.생년월일,
      r.xerp출근,r.xerp퇴근,r.pmis출근,r.pmis퇴근,
      r.조출,r.오전,r.오후,r.연장,r.야간,r.철야,r.점심,r.공수합계A,
      r.초과당일,r.초과합계,r.가산신청,r.가산승인,r.공수합계AB,r.월누계,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = headers.map(() => ({ wch: 10 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "선택행");
    XLSX.writeFile(wb, `선택행_${selectedDate.replace(/-/g,"")}.xlsx`);
  };

  // ── 업로드 (다중 파일 지원) ──
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";

    let newMap = { ...dateMap };
    let successCount = 0;
    let lastSavedDate = uploadDate;

    for (const file of files) {
      // 파일명에서 날짜 추출, 없으면 선택된 uploadDate 사용
      const dateToUse = extractDateFromFilename(file.name) ?? uploadDate;
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
        const imported = parseSheet(wb);
        if (imported.length === 0) {
          toast.error(`${file.name}: 데이터를 찾을 수 없습니다.`);
          continue;
        }
        newMap = { ...newMap, [dateToUse]: imported };
        lastSavedDate = dateToUse;
        successCount++;
        toast.success(`${formatLabel(dateToUse)} — ${imported.length}건 저장 (${file.name})`);
      } catch {
        toast.error(`${file.name}: 파일을 읽는 중 오류가 발생했습니다.`);
      }
    }

    if (successCount > 0) {
      setDateMap(newMap);
      syncXerpFS(newMap);
      setSelectedDate(lastSavedDate);
      if (files.length > 1) {
        toast.success(`총 ${successCount}개 파일 업로드 완료`);
      }
    }
  };

  // ── 폴더 일괄 업로드 (File System Access API) ──
  const handleFolderUpload = async () => {
    if (!("showDirectoryPicker" in window)) {
      toast.error("이 브라우저는 폴더 선택을 지원하지 않습니다. Chrome/Edge를 사용해주세요.");
      return;
    }
    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    } catch {
      return; // 사용자가 취소
    }

    let newMap = { ...dateMap };
    let successCount = 0;
    let lastSavedDate = uploadDate;
    const errors: string[] = [];

    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind !== "file") continue;
      if (!/\.xlsx?$/i.test(name)) continue;

      const dateToUse = extractDateFromFilename(name);
      if (!dateToUse) continue; // 날짜 없는 파일은 건너뜀

      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
        const imported = parseSheet(wb);
        if (imported.length === 0) {
          errors.push(`${name}: 데이터 없음`);
          continue;
        }
        newMap = { ...newMap, [dateToUse]: imported };
        lastSavedDate = dateToUse;
        successCount++;
      } catch {
        errors.push(`${name}: 읽기 오류`);
      }
    }

    if (successCount > 0) {
      setDateMap(newMap);
      syncXerpFS(newMap);
      setSelectedDate(lastSavedDate);
      toast.success(`폴더에서 ${successCount}개 파일 업로드 완료`);
    } else {
      toast.error("날짜가 포함된 Excel 파일을 찾지 못했습니다.");
    }
    if (errors.length > 0) {
      toast.error(`오류: ${errors.slice(0, 3).join(", ")}${errors.length > 3 ? ` 외 ${errors.length - 3}건` : ""}`);
    }
  };

  // ── 날짜 삭제 ──
  const handleDeleteDate = (date: string) => {
    if (!window.confirm(`${formatLabel(date)} 데이터를 삭제하시겠습니까?`)) return;
    const next = { ...dateMap };
    delete next[date];
    setDateMap(next);
    syncXerpFS(next);
    const remaining = Object.keys(next).sort().reverse();
    setSelectedDate(remaining[0] ?? TODAY);
    toast.success(`${formatLabel(date)} 데이터를 삭제했습니다.`);
  };

  // ── 내보내기 (원본 XERP 양식과 동일한 구조) ──
  const handleExport = () => {
    if (currentRows.length === 0) { toast.error("내보낼 데이터가 없습니다."); return; }

    // Row 1: 그룹 헤더 (원본과 동일)
    const row1: (string | null)[] = [
      "팀명","직종","사번","성명","생년월일",
      "X-ERP 체크시간", null,
      "PMIS 체크시간",  null,
      "공수 체크(A)", null, null, null, null, null, null, null,
      "초과근무", null,
      "가산공수(B)", null,
      "공수합계", "월누계",
    ];

    // Row 2: 서브 헤더
    const row2: (string | null)[] = [
      null, null, null, null, null,
      "출 근", "퇴 근",
      "출 근", "퇴 근",
      "조출","오전","오후","연장","야간","철야","점심","합계",
      "당일","합계",
      "신청","승인",
      "(A+B)", null,
    ];

    // 데이터 행
    const dataRows = currentRows.map((r) => [
      r.팀명, r.직종, r.사번, r.성명, r.생년월일,
      r.xerp출근, r.xerp퇴근,
      r.pmis출근, r.pmis퇴근,
      r.조출, r.오전, r.오후, r.연장, r.야간, r.철야, r.점심, r.공수합계A,
      r.초과당일, r.초과합계,
      r.가산신청, r.가산승인,
      r.공수합계AB, r.월누계,
    ]);

    const ws = XLSX.utils.aoa_to_sheet([row1, row2, ...dataRows]);

    // 병합 (원본과 동일 구조)
    ws["!merges"] = [
      { s:{r:0,c:0},  e:{r:1,c:0}  }, // A1:A2  팀명
      { s:{r:0,c:1},  e:{r:1,c:1}  }, // B1:B2  직종
      { s:{r:0,c:2},  e:{r:1,c:2}  }, // C1:C2  사번
      { s:{r:0,c:3},  e:{r:1,c:3}  }, // D1:D2  성명
      { s:{r:0,c:4},  e:{r:1,c:4}  }, // E1:E2  생년월일
      { s:{r:0,c:5},  e:{r:0,c:6}  }, // F1:G1  X-ERP 체크시간
      { s:{r:0,c:7},  e:{r:0,c:8}  }, // H1:I1  PMIS 체크시간
      { s:{r:0,c:9},  e:{r:0,c:16} }, // J1:Q1  공수 체크(A)
      { s:{r:0,c:17}, e:{r:0,c:18} }, // R1:S1  초과근무
      { s:{r:0,c:19}, e:{r:0,c:20} }, // T1:U1  가산공수(B)
      { s:{r:0,c:22}, e:{r:1,c:22} }, // W1:W2  월누계
    ];

    // 열 너비 (원본 참고)
    ws["!cols"] = [
      {wch:12},{wch:9},{wch:9},{wch:9},{wch:16},
      {wch:8},{wch:8},{wch:8},{wch:8},
      {wch:6},{wch:6},{wch:6},{wch:6},{wch:6},{wch:6},{wch:6},{wch:7},
      {wch:6},{wch:7},
      {wch:7},{wch:7},
      {wch:10},{wch:10},
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "일일출역 집계");
    XLSX.writeFile(wb, `XERP_PMIS_${selectedDate.replace(/-/g,"")}.xlsx`);
  };

  // ── th 헬퍼 ──
  const th = (extra = "") =>
    `px-2 py-2 text-[11px] font-semibold text-muted-foreground whitespace-nowrap bg-muted/50 text-center border-r border-border/40 last:border-r-0 sticky top-0 z-20 ${extra}`;

  return (
    <div className="flex flex-col gap-3">
      {isAdmin && (
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={handleUpload} />
      )}

      {/* ── 제목 ── */}
      <h2 className="text-lg font-bold text-foreground shrink-0">XERP &amp; PMIS</h2>

      {/* ── 연속 결근 경고 배너 ── */}
      {absentEmployees.length > 0 && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-300 rounded-xl px-4 py-3 shrink-0">
          <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <div className="flex flex-col gap-2 min-w-0">
            <span className="text-sm font-bold text-red-700">
              연속 3일 이상 출근 기록 없는 직원 ({absentEmployees.length}명)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {absentEmployees.map((emp) => (
                <button
                  key={emp.사번 || emp.성명}
                  onClick={() => openCalendar(emp)}
                  className="px-2.5 py-1 rounded-full bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold border border-red-200 transition-colors"
                >
                  {emp.성명}
                  {emp.팀명 && <span className="ml-1 font-normal opacity-70">({emp.팀명})</span>}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-red-500/70">이름을 클릭하면 달력에서 상세 확인할 수 있습니다. 주말 제외 기준.</span>
          </div>
        </div>
      )}

      {/* ── 날짜 조회 바 ── */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-border rounded-xl px-4 py-2.5 shadow-sm shrink-0">
        <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-muted-foreground">날짜 조회</span>

        {availableDates.length === 0 ? (
          <span className="text-xs text-muted-foreground">저장된 날짜 없음</span>
        ) : (
          <select
            value={selectedDate}
            onChange={(e) => { setSelectedDate(e.target.value); setSearch(""); }}
            className="border border-border rounded-lg px-3 py-1.5 text-sm font-semibold text-foreground bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            {availableDates.map((d) => (
              <option key={d} value={d}>
                {formatLabel(d)} ({(dateMap[d]?.length ?? 0)}건)
              </option>
            ))}
          </select>
        )}

        {isAdmin && availableDates.length > 0 && (
          <button
            onClick={() => handleDeleteDate(selectedDate)}
            title="선택 날짜 데이터 삭제"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-50 border border-red-200 transition-colors ml-auto"
          >
            <Trash2 className="h-3.5 w-3.5" />
            삭제
          </button>
        )}
      </div>

      {/* ── 툴바 ── */}
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 / 사번 검색..."
            className="w-full pl-9 pr-9 py-2 text-sm border border-border rounded-lg bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* ── 정기안전교육 체크칸 ── */}
        <label
          title={isAdmin ? "클릭하여 이 날짜를 정기안전교육 날짜로 설정/해제" : "정기안전교육 날짜 여부"}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors select-none
            ${isSafetyEduDate
              ? "bg-amber-50 border-amber-400 text-amber-700"
              : "bg-white border-border text-muted-foreground"}
            ${isAdmin ? "cursor-pointer hover:border-amber-400 hover:bg-amber-50/60" : "cursor-default"}`}
        >
          <input
            type="checkbox"
            checked={isSafetyEduDate}
            onChange={toggleSafetyEdu}
            readOnly={!isAdmin}
            className="h-4 w-4 accent-amber-500"
          />
          <span className="text-xs font-semibold whitespace-nowrap">정기안전교육</span>
          {isSafetyEduDate && (
            <span className="text-[10px] font-normal opacity-70">· 16:20 퇴근 = 1공수</span>
          )}
        </label>

        {isAdmin && (
          <div className="flex items-center gap-2 bg-muted/40 border border-border rounded-lg px-3 py-1.5">
            <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">업로드 날짜</span>
            <input
              type="date"
              value={uploadDate}
              onChange={(e) => setUploadDate(e.target.value)}
              className="border-0 bg-transparent text-sm font-semibold text-foreground outline-none"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              업로드
            </button>
            <button
              onClick={handleFolderUpload}
              title="폴더를 선택하면 안에 있는 모든 Excel 파일을 날짜별로 자동 업로드"
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              폴더 일괄
            </button>
          </div>
        )}

        {/* ── 정렬 버튼 ── */}
        <div className="flex items-center gap-1.5 bg-white border border-border rounded-lg px-3 py-1.5">
          <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap mr-1">정렬</span>
          {([
            { col: "xerp출근" as const, label: "X출근" },
            { col: "xerp퇴근" as const, label: "X퇴근" },
            { col: "pmis출근" as const, label: "P출근" },
            { col: "pmis퇴근" as const, label: "P퇴근" },
          ]).map(({ col, label }) => (
            <button
              key={col}
              onClick={() => handleSort(col)}
              className={`flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors
                ${sortCol === col
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
            >
              {label}
              {sortCol === col
                ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                : <ArrowUpDown className="h-3 w-3 opacity-40" />}
            </button>
          ))}
          {sortCol && (
            <button
              onClick={() => { setSortCol(null); setSortDir("asc"); }}
              className="ml-1 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-muted transition-colors"
            >
              초기화
            </button>
          )}
        </div>

        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          엑셀 내보내기
        </button>
      </div>

      {/* ── 선택 행 액션바 ── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-2.5 shrink-0">
          <span className="text-xs font-semibold text-primary">{selectedIds.size}행 선택됨</span>
          <button
            onClick={handleExportSelected}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-primary/30 bg-white text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            선택 행 내보내기
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            선택 해제
          </button>
        </div>
      )}

      {/* ── 테이블 ── */}
      <div
        className="overflow-auto rounded-xl border border-border bg-white shadow-sm"
        style={{ maxHeight: "calc(100vh - 280px)" }}
      >
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th rowSpan={2} className={th("w-[36px]")}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 accent-primary cursor-pointer"
                  title="전체 선택"
                />
              </th>
              <th rowSpan={2} className={th("w-[72px]")}>팀명</th>
              <th rowSpan={2} className={th("w-[72px]")}>직종</th>
              <th rowSpan={2} className={th("w-[72px]")}>사번</th>
              <th rowSpan={2} className={th("w-[72px]")}>성명</th>
              <th rowSpan={2} className={th("w-[88px]")}>생년월일</th>
              <th colSpan={2} className={th()}>X-ERP 체크시간</th>
              <th colSpan={2} className={th()}>PMIS 체크시간</th>
              <th colSpan={8} className={th()}>공수 체크A</th>
              <th colSpan={2} className={th()}>초과근무</th>
              <th colSpan={3} className={th()}>가산공수B</th>
              <th rowSpan={2} className={th()}>공수합계<br />(A+B)</th>
              <th rowSpan={2} className={th()}>월누계</th>
            </tr>
            <tr className="border-b border-border bg-muted/40">
              {(["xerp출근","xerp퇴근","pmis출근","pmis퇴근"] as const).map((col, i) => (
                <th key={col} className={`${th()} cursor-pointer select-none hover:bg-muted/80 transition-colors`}
                  onClick={() => handleSort(col)}>
                  {["출근","퇴근","출근","퇴근"][i]}
                  <SortIcon col={col} />
                </th>
              ))}
              <th className={th()}>조출</th><th className={th()}>오전</th>
              <th className={th()}>오후</th><th className={th()}>연장</th>
              <th className={th()}>야간</th><th className={th()}>철야</th>
              <th className={th()}>점심</th><th className={th()}>합계</th>
              <th className={th()}>당일</th><th className={th()}>합계</th>
              <th className={th()}>신청</th><th className={th()}>승인</th>
              <th className={th("min-w-[90px]")}>가산사유</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={25} className="py-16 text-center text-muted-foreground text-sm">
                  {availableDates.length === 0
                    ? isAdmin ? "엑셀을 업로드하여 날짜별 데이터를 저장하세요." : "저장된 데이터가 없습니다."
                    : search
                      ? `"${search}"에 해당하는 데이터가 없습니다.`
                      : `${formatLabel(selectedDate)}에 저장된 데이터가 없습니다.`}
                </td>
              </tr>
            ) : (
              displayRows.map((row) => {
                const hasGaasan = row.가산신청 && row.가산신청 !== "0" && row.가산신청 !== "N" && row.가산신청 !== "—" && row.가산신청.trim() !== "";
                const isEarlyOut = isSafetyEduDate && (row.xerp퇴근 === "16:20" || row.xerp퇴근 === "16:20:00");
                const rowBg = isEarlyOut
                  ? "bg-amber-50/60 hover:bg-amber-50/80"
                  : hasGaasan ? "bg-amber-50/40 hover:bg-amber-50/70" : "hover:bg-muted/20";
                return (
                <tr key={row.id} className={`border-b border-border/60 last:border-0 transition-colors ${rowBg}`}>
                  <td className={`${cell} w-[36px]`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => toggleSelectRow(row.id)}
                      className="h-4 w-4 accent-primary cursor-pointer"
                    />
                  </td>
                  <td className={cell}>{row.팀명||"—"}</td>
                  <td className={cell}>{row.직종||"—"}</td>
                  <td className={cell}>{row.사번||"—"}</td>
                  <td className={`${cell} font-medium p-0`}>
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        onClick={() => setDetailRow(row)}
                        className="px-2 py-1.5 text-primary hover:text-primary/80 font-medium transition-colors hover:underline underline-offset-2"
                        title="공수 상세 검증"
                      >
                        {row.성명||"—"}
                      </button>
                      <button
                        onClick={() => openCalendar(row)}
                        className="p-1 text-muted-foreground hover:text-primary transition-colors"
                        title="달력으로 출퇴근 현황 보기"
                      >
                        <CalendarDays className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                  <td className={cell}>{maskResidentNum(row.생년월일 || "—", isAdmin)}</td>
                  <td className={`${cellNum} text-blue-600 font-semibold`}>{row.xerp출근||"—"}</td>
                  <td className={`${cellNum} font-semibold ${isEarlyOut ? "text-amber-600" : "text-red-600"}`}>{row.xerp퇴근||"—"}</td>
                  <td className={cellNum}>{row.pmis출근||"—"}</td>
                  <td className={cellNum}>{row.pmis퇴근||"—"}</td>
                  <td className={cellNum}>{row.조출||"—"}</td>
                  <td className={cellNum}>{row.오전||"—"}</td>
                  <td className={cellNum}>{row.오후||"—"}</td>
                  <td className={cellNum}>{row.연장||"—"}</td>
                  <td className={cellNum}>{row.야간||"—"}</td>
                  <td className={cellNum}>{row.철야||"—"}</td>
                  <td className={cellNum}>{row.점심||"—"}</td>
                  <td className={`${cellNum} font-semibold bg-blue-50/50`}>{row.공수합계A||"—"}</td>
                  <td className={cellNum}>{row.초과당일||"—"}</td>
                  <td className={`${cellNum} font-semibold`}>{row.초과합계||"—"}</td>
                  <td className={`${cellNum} ${hasGaasan ? "bg-amber-100 text-amber-800 font-bold" : ""}`}>
                    {hasGaasan ? row.가산신청 : (row.가산신청 || "—")}
                  </td>
                  <td className={cellNum}>{row.가산승인||"—"}</td>
                  <td
                    title={isEarlyOut ? "정기안전교육으로 빠른퇴근타각" : undefined}
                    className={`px-2 py-1.5 text-[10px] text-center border-r border-border/40 leading-tight
                      ${isEarlyOut ? "text-amber-700 bg-amber-100/60 font-semibold" : "text-muted-foreground whitespace-nowrap"}`}
                    style={{ minWidth: "90px" }}
                  >
                    {isEarlyOut ? "정기안전교육으로 빠른퇴근타각" : "—"}
                  </td>
                  <td className={`${cellNum} font-bold p-0 ${isEarlyOut ? "bg-amber-50 text-amber-700" : "bg-primary/5 text-primary"}`}>
                    <button
                      onClick={() => setDetailRow(row)}
                      className="w-full h-full px-2 py-1.5 hover:bg-black/5 transition-colors tabular-nums font-bold"
                      title="공수 상세 검증"
                    >
                      {isEarlyOut ? "1" : (row.공수합계AB||"—")}
                    </button>
                  </td>
                  <td className={`${cellNum} font-bold`}>{row.월누계||"—"}</td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground shrink-0">
        {availableDates.length > 0
          ? `${formatLabel(selectedDate)} — 총 ${currentRows.length}건 (검색 결과 ${displayRows.length}건) · 저장된 날짜 ${availableDates.length}개`
          : "저장된 날짜 없음"}
        {!isAdmin && <span className="ml-2 text-amber-600">· 업로드는 관리자만 가능합니다</span>}
      </p>

      {/* ── 달력 모달 ── */}
      {calendarEmp && (
        <CalendarModal
          emp={calendarEmp}
          year={calendarYear}
          month={calendarMonth}
          dateMap={dateMap}
          onPrev={prevMonth}
          onNext={nextMonth}
          onClose={() => setCalendarEmp(null)}
        />
      )}

      {/* ── 행 상세 검증 모달 ── */}
      {detailRow && (
        <RowDetailModal
          row={detailRow}
          date={selectedDate}
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  );
}
