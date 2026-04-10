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

// ── 작업 일정 ──────────────────────────────────────────
export async function loadScheduleFS() {
  return fsGet<ScheduleData>("work_schedule");
}
export async function saveScheduleFS(data: ScheduleData) {
  return fsSet("work_schedule", data as unknown as object);
}
