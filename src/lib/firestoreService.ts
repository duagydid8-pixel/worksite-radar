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
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "./firebase";
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
  } catch (e) {
    console.error(`[Firestore] fsSet(${docId}) 실패:`, e);
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
// 날짜별 서브컬렉션으로 저장 (1MB 문서 한계 우회)
// 컬렉션: worksite_data/xerp_pmis_dates/{YYYY-MM-DD} → { rows }
// 컬렉션: worksite_data/xerp_pmis_ph2_dates/{YYYY-MM-DD} → { rows }

const XERP_INDEX_DOC = "xerp_pmis_index";
const XERP_PH2_INDEX_DOC = "xerp_pmis_ph2_index";

async function loadXerpByDates(indexDocId: string, datePrefix: string): Promise<Record<string, unknown[]> | null> {
  if (!db) return null;
  try {
    // 인덱스 문서에서 날짜 목록 조회
    const index = await fsGet<{ dates: string[] }>(indexDocId);
    const dates = index?.dates ?? [];
    if (dates.length === 0) return null;
    // 각 날짜별 문서 병렬 로드
    const entries = await Promise.all(
      dates.map(async (d) => {
        const data = await fsGet<{ rows: unknown[] }>(`${datePrefix}_${d}`);
        return [d, data?.rows ?? []] as [string, unknown[]];
      })
    );
    return Object.fromEntries(entries.filter(([, rows]) => rows.length > 0));
  } catch {
    return null;
  }
}

async function saveXerpByDates(
  indexDocId: string,
  datePrefix: string,
  dateMap: Record<string, unknown[]>
): Promise<boolean> {
  if (!db) return false;
  try {
    const dates = Object.keys(dateMap);
    // 각 날짜별 문서 저장
    const results = await Promise.all(
      dates.map((d) => fsSet(`${datePrefix}_${d}`, { rows: dateMap[d] }))
    );
    // 인덱스 문서 갱신
    await fsSet(indexDocId, { dates });
    return results.every(Boolean);
  } catch {
    return false;
  }
}

export async function loadXerpFS(): Promise<Record<string, unknown[]> | null> {
  const byDates = await loadXerpByDates(XERP_INDEX_DOC, "xerp_pmis_date");
  if (byDates) return byDates;
  // 레거시 단일 문서 마이그레이션
  const legacy = await fsGet<{ dateMap: Record<string, unknown[]> }>("xerp_pmis");
  if (legacy?.dateMap && Object.keys(legacy.dateMap).length > 0) {
    await saveXerpByDates(XERP_INDEX_DOC, "xerp_pmis_date", legacy.dateMap);
    return legacy.dateMap;
  }
  return null;
}
export async function saveXerpFS(dateMap: Record<string, unknown[]>): Promise<boolean> {
  return saveXerpByDates(XERP_INDEX_DOC, "xerp_pmis_date", dateMap);
}

export async function loadXerpPH2FS(): Promise<Record<string, unknown[]> | null> {
  const byDates = await loadXerpByDates(XERP_PH2_INDEX_DOC, "xerp_pmis_ph2_date");
  if (byDates) return byDates;
  const legacy = await fsGet<{ dateMap: Record<string, unknown[]> }>("xerp_pmis_ph2");
  if (legacy?.dateMap && Object.keys(legacy.dateMap).length > 0) {
    await saveXerpByDates(XERP_PH2_INDEX_DOC, "xerp_pmis_ph2_date", legacy.dateMap);
    return legacy.dateMap;
  }
  return null;
}
export async function saveXerpPH2FS(dateMap: Record<string, unknown[]>): Promise<boolean> {
  return saveXerpByDates(XERP_PH2_INDEX_DOC, "xerp_pmis_ph2_date", dateMap);
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

// ── 근로계약서 ─────────────────────────────────────────
export interface ContractMeta {
  name: string;
  storagePath: string;
  downloadUrl: string;
  uploadedAt: string;
  pageCount: number;
}

export async function loadContractsFS(): Promise<ContractMeta[]> {
  const data = await fsGet<{ contracts: ContractMeta[] }>("contracts");
  return data?.contracts ?? [];
}

export async function uploadContractFS(
  name: string,
  pdfBytes: Uint8Array,
  pageCount: number
): Promise<ContractMeta | null> {
  if (!storage) return null;
  try {
    const path = `contracts/${name}_${Date.now()}.pdf`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, pdfBytes, { contentType: "application/pdf" });
    const downloadUrl = await getDownloadURL(storageRef);
    const meta: ContractMeta = { name, storagePath: path, downloadUrl, uploadedAt: new Date().toISOString(), pageCount };
    const current = await loadContractsFS();
    const filtered = current.filter((c) => c.name !== name);
    await fsSet("contracts", { contracts: [...filtered, meta] });
    return meta;
  } catch (e) {
    console.error("[Storage] uploadContractFS 실패:", e);
    return null;
  }
}

// 여러 계약서를 한 번에 업로드 — Storage 병렬 + Firestore 1회 쓰기
export async function uploadContractsBatchFS(
  items: { name: string; pdfBytes: Uint8Array; pageCount: number }[]
): Promise<{ success: ContractMeta[]; failed: string[] }> {
  if (!storage) return { success: [], failed: items.map(i => i.name) };

  const now = new Date().toISOString();

  // 1. Storage 업로드 전부 병렬
  const results = await Promise.allSettled(
    items.map(async ({ name, pdfBytes, pageCount }) => {
      const path = `contracts/${name}_${Date.now()}.pdf`;
      const storageRef = ref(storage!, path);
      await uploadBytes(storageRef, pdfBytes, { contentType: "application/pdf" });
      const downloadUrl = await getDownloadURL(storageRef);
      return { name, storagePath: path, downloadUrl, uploadedAt: now, pageCount } as ContractMeta;
    })
  );

  const success: ContractMeta[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") success.push(r.value);
    else { failed.push(items[i].name); console.error("[Storage] 업로드 실패:", items[i].name, r.reason); }
  });

  // 2. Firestore 1회 쓰기
  if (success.length > 0) {
    const current = await loadContractsFS();
    const successNames = new Set(success.map(s => s.name));
    const filtered = current.filter(c => !successNames.has(c.name));
    await fsSet("contracts", { contracts: [...filtered, ...success] });
  }

  return { success, failed };
}

export async function deleteContractFS(name: string): Promise<boolean> {
  if (!storage) return false;
  try {
    const current = await loadContractsFS();
    const target = current.find((c) => c.name === name);
    if (target) await deleteObject(ref(storage, target.storagePath));
    const filtered = current.filter((c) => c.name !== name);
    await fsSet("contracts", { contracts: filtered });
    return true;
  } catch (e) {
    console.error("[Storage] deleteContractFS 실패:", e);
    return false;
  }
}

// ── 작업 일정 ──────────────────────────────────────────
export async function loadScheduleFS() {
  return fsGet<ScheduleData>("work_schedule");
}
export async function saveScheduleFS(data: ScheduleData): Promise<void> {
  if (!db) throw new Error("Firebase가 설정되지 않았습니다. 환경변수를 확인하세요.");
  await setDoc(doc(db, COL, "work_schedule"), data as unknown as object);
}

// ── 정기안전교육 날짜 ────────────────────────────────────
export async function loadSafetyEduDatesFS(): Promise<string[]> {
  const data = await fsGet<{ dates: string[] }>("safety_edu_dates");
  return data?.dates ?? [];
}
export async function saveSafetyEduDatesFS(dates: string[]): Promise<boolean> {
  return fsSet("safety_edu_dates", { dates });
}

export function subscribeScheduleFS(
  callback: (data: ScheduleData | null) => void,
): () => void {
  if (!db) { callback(null); return () => {}; }
  return onSnapshot(
    doc(db, COL, "work_schedule"),
    (snap) => callback(snap.exists() ? (snap.data() as ScheduleData) : null),
    () => callback(null),
  );
}
