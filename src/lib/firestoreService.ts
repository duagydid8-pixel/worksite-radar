/**
 * Firestore 서비스 레이어
 * 컬렉션: "worksite_data"
 *   - doc "org"                 : { teams, members, siteManager }
 *   - doc "new_employees_ph4"   : { rows }
 *   - doc "new_employees_ph2"   : { rows }
 *   - doc "xerp_pmis"           : { dateMap }
 *   - doc "work_schedule"       : ScheduleData
 *
 * Firestore 보안 규칙 (Firebase Console → Firestore → 규칙):
 *   rules_version = '2';
 *   service cloud.firestore {
 *     match /databases/{database}/documents {
 *       match /{document=**} { allow read, write: if true; }
 *     }
 *   }
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { ScheduleData } from "./geminiService";

const COL = "worksite_data";

async function fsGet<T>(docId: string): Promise<T | null> {
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, COL, docId));
    return snap.exists() ? (snap.data() as T) : null;
  } catch {
    return null;
  }
}

async function fsSet(docId: string, data: object): Promise<boolean> {
  if (!db) return false;
  try {
    await setDoc(doc(db, COL, docId), data);
    return true;
  } catch {
    return false;
  }
}

// ── 조직도 ──────────────────────────────────────────
export async function loadOrgFS() {
  return fsGet<{ teams: unknown[]; members: unknown[]; siteManager?: unknown }>("org");
}
export async function saveOrgFS(data: object) {
  return fsSet("org", data);
}

// ── 기술인 및 관리자 명단 — P4-PH4 초순수 ───────────
export async function loadEmployeesPH4FS() {
  const ph4Data = await fsGet<{ rows: unknown[] }>("new_employees_ph4");
  if (ph4Data?.rows && ph4Data.rows.length > 0) return ph4Data.rows;
  // 마이그레이션: 기존 new_employees → new_employees_ph4
  const legacy = await fsGet<{ rows: unknown[] }>("new_employees");
  if (legacy?.rows && legacy.rows.length > 0) {
    await fsSet("new_employees_ph4", { rows: legacy.rows });
    return legacy.rows;
  }
  return null;
}
export async function saveEmployeesPH4FS(rows: unknown[]) {
  return fsSet("new_employees_ph4", { rows });
}

// ── 기술인 및 관리자 명단 — P4-PH2 초순수 ───────────
export async function loadEmployeesPH2FS() {
  const data = await fsGet<{ rows: unknown[] }>("new_employees_ph2");
  return data?.rows ?? null;
}
export async function saveEmployeesPH2FS(rows: unknown[]) {
  return fsSet("new_employees_ph2", { rows });
}

// ── XERP & PMIS ──────────────────────────────────────
export async function loadXerpFS() {
  const data = await fsGet<{ dateMap: Record<string, unknown[]> }>("xerp_pmis");
  return data?.dateMap ?? null;
}
export async function saveXerpFS(dateMap: Record<string, unknown[]>) {
  return fsSet("xerp_pmis", { dateMap });
}
export async function loadXerpPH2FS() {
  const data = await fsGet<{ dateMap: Record<string, unknown[]> }>("xerp_pmis_ph2");
  return data?.dateMap ?? null;
}
export async function saveXerpPH2FS(dateMap: Record<string, unknown[]>) {
  return fsSet("xerp_pmis_ph2", { dateMap });
}

// ── XERP 공수 반영 저장 (날짜별) ─────────────────────
interface XerpWorkEntry { fileName: string; savedAt: string; rows: unknown[]; rawExcelRows?: unknown[] }
type XerpWorkDateMap = Record<string, XerpWorkEntry>;

export async function loadXerpWorkDateMapFS(): Promise<XerpWorkDateMap | null> {
  const data = await fsGet<{ dateMap: XerpWorkDateMap }>("xerp_work_dates");
  return data?.dateMap ?? null;
}
export async function saveXerpWorkDateFS(
  date: string, fileName: string, rows: unknown[], rawExcelRows?: unknown[]
): Promise<boolean> {
  const current = (await loadXerpWorkDateMapFS()) ?? {};
  const updated: XerpWorkDateMap = {
    ...current,
    [date]: { fileName, savedAt: new Date().toISOString(), rows, rawExcelRows: rawExcelRows ?? [] },
  };
  return fsSet("xerp_work_dates", { dateMap: updated });
}
export async function deleteXerpWorkDateFS(date: string): Promise<boolean> {
  const current = (await loadXerpWorkDateMapFS()) ?? {};
  const updated = { ...current };
  delete updated[date];
  return fsSet("xerp_work_dates", { dateMap: updated });
}
// 레거시 단일 저장 (하위 호환)
export async function loadXerpWorkFS() {
  return fsGet<{ fileName: string; savedAt: string; rows: unknown[] }>("xerp_work");
}
export async function saveXerpWorkFS(fileName: string, rows: unknown[]) {
  return fsSet("xerp_work", { fileName, savedAt: new Date().toISOString(), rows });
}

// ── 신규자 명단 (날짜별) ───────────────────────────────
interface NewEmpEntry { fileName: string; savedAt: string; data: Record<string, { 생년월일: string; 단가: string }> }
type NewEmpDateMap = Record<string, NewEmpEntry>;

export async function loadNewEmpDateMapFS(): Promise<NewEmpDateMap | null> {
  const result = await fsGet<{ dateMap: NewEmpDateMap }>("xerp_newemp_dates");
  return result?.dateMap ?? null;
}
export async function saveNewEmpDateFS(
  date: string,
  fileName: string,
  data: Record<string, { 생년월일: string; 단가: string }>
): Promise<boolean> {
  const current = (await loadNewEmpDateMapFS()) ?? {};
  const updated: NewEmpDateMap = {
    ...current,
    [date]: { fileName, savedAt: new Date().toISOString(), data },
  };
  return fsSet("xerp_newemp_dates", { dateMap: updated });
}

// ── 작업 일정 ──────────────────────────────────────────
export async function loadScheduleFS() {
  return fsGet<ScheduleData>("work_schedule");
}
export async function saveScheduleFS(data: ScheduleData): Promise<void> {
  if (!db) throw new Error("Firebase가 설정되지 않았습니다. 환경변수를 확인하세요.");
  await setDoc(doc(db, COL, "work_schedule"), data as unknown as object);
}
