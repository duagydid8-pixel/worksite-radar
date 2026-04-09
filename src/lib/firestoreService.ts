/**
 * Firestore 서비스 레이어
 * 컬렉션: "worksite_data"
 *   - doc "org"           : { teams, members }
 *   - doc "new_employees" : { rows }
 *   - doc "xerp_pmis"    : { dateMap }
 *
 * ※ Firestore 보안 규칙에서 읽기/쓰기를 허용해야 합니다.
 *    Firebase Console → Firestore → 규칙 탭에서 아래 규칙 적용:
 *    rules_version = '2';
 *    service cloud.firestore {
 *      match /databases/{database}/documents {
 *        match /{document=**} { allow read, write: if true; }
 *      }
 *    }
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

const COL = "worksite_data";

async function fsGet<T>(docId: string): Promise<T | null> {
  if (!db) {
    console.warn("[Firestore] Firebase 미설정 — 읽기 건너뜀");
    return null;
  }
  try {
    const snap = await getDoc(doc(db, COL, docId));
    return snap.exists() ? (snap.data() as T) : null;
  } catch (e) {
    console.warn(`[Firestore] getDoc(${docId}) failed:`, e);
    return null;
  }
}

async function fsSet(docId: string, data: object): Promise<boolean> {
  if (!db) {
    console.warn("[Firestore] Firebase 미설정 — 쓰기 건너뜀");
    return false;
  }
  try {
    await setDoc(doc(db, COL, docId), data);
    return true;
  } catch (e) {
    console.warn(`[Firestore] setDoc(${docId}) failed:`, e);
    return false;
  }
}

// ── 조직도 ──────────────────────────────────────────
export async function loadOrgFS() {
  return fsGet<{ teams: unknown[]; members: unknown[] }>("org");
}
export async function saveOrgFS(data: { teams: unknown[]; members: unknown[] }) {
  return fsSet("org", data);
}

// ── 신규자 명단 ──────────────────────────────────────
export async function loadEmployeesFS() {
  const data = await fsGet<{ rows: unknown[] }>("new_employees");
  return data?.rows ?? null;
}
export async function saveEmployeesFS(rows: unknown[]) {
  return fsSet("new_employees", { rows });
}

// ── XERP & PMIS ──────────────────────────────────────
export async function loadXerpFS() {
  const data = await fsGet<{ dateMap: Record<string, unknown[]> }>("xerp_pmis");
  return data?.dateMap ?? null;
}
export async function saveXerpFS(dateMap: Record<string, unknown[]>) {
  return fsSet("xerp_pmis", { dateMap });
}
