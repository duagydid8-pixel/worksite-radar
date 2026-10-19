/**
 * Firestore 서비스 레이어
 * 컬렉션: "worksite_data"
 *   - doc "org"                 : { teams, members, siteManager }
 *   - doc "new_employees_ph4"   : { rows }
 *   - doc "new_employees_ph2"   : { rows }
 *   - doc "xerp_pmis"           : { dateMap }
 *   - doc "work_schedule"       : ScheduleData
 *   - doc "tenure_workers"      : { rows } (근속 1년 도래 알림)
 *
 * Firestore 보안 규칙: 저장소 루트의 firestore.rules 참고 (firebase deploy --only firestore:rules)
 */
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, uploadString, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "./firebase";
import { notifyFirestoreError } from "./firestoreErrors";
import { getOrgPhotoContentType, getOrgPhotoExtension, getOrgPhotoStoragePath, isInlineOrgPhoto } from "./orgPhotoStorage";
import type { ScheduleData } from "./scheduleTypes";
import type { TenureWorker } from "./tenureAlert";
import type { ManualAbsence } from "./manualAbsences";
import { chunkFinalWorkUnitsRows, type FinalWorkUnitsMonthSnapshot } from "./finalWorkUnitsMonthlySave";
import {
  buildFinalWorkUnitsReviewMemoryEntries,
  mergeFinalWorkUnitsReviewMemory,
  type FinalWorkUnitsReviewMemoryEntry,
  type FinalWorkUnitsReviewMemoryRow,
} from "./finalWorkUnitsReviewMemory";

const COL = "worksite_data";

async function fsGet<T>(docId: string): Promise<T | null> {
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, COL, docId));
    return snap.exists() ? (snap.data() as T) : null;
  } catch (e) {
    console.error(`[Firestore] fsGet(${docId}) 실패:`, e);
    notifyFirestoreError(e, "클라우드 데이터 불러오기", "read");
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
    notifyFirestoreError(e, "클라우드 저장");
    return false;
  }
}

function removeUndefinedFields(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedFields(item))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [key, removeUndefinedFields(entry)] as const)
        .filter(([, entry]) => entry !== undefined)
    );
  }
  return value;
}

// ── 조직도 ──────────────────────────────────────────
export async function loadOrgFS(docId = "org") {
  return fsGet<{ teams: unknown[]; members: unknown[]; siteManager?: unknown }>(docId);
}
export async function saveOrgFS(data: object, docId = "org") {
  return fsSet(docId, data);
}

export async function uploadOrgPhotoFS(docId: string, ownerId: string, photoUrl: string): Promise<string | null> {
  if (!isInlineOrgPhoto(photoUrl)) return photoUrl;
  if (!storage) return null;
  try {
    const path = getOrgPhotoStoragePath(docId, ownerId, Date.now(), getOrgPhotoExtension(photoUrl));
    const storageRef = ref(storage, path);
    await uploadString(storageRef, photoUrl, "data_url", { contentType: getOrgPhotoContentType(photoUrl) });
    return getDownloadURL(storageRef);
  } catch (e) {
    console.error("[Storage] uploadOrgPhotoFS 실패:", e);
    return null;
  }
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

// ── 기술인 및 관리자 명단 — P5-PH1 초순수 ───────────
export async function loadEmployeesP5PH1FS() {
  const data = await fsGet<{ rows: unknown[] }>("new_employees_p5_ph1");
  return data?.rows ?? null;
}
export async function saveEmployeesP5PH1FS(rows: unknown[]) {
  return fsSet("new_employees_p5_ph1", { rows });
}

// ── 근속 1년 도래 알림 (이관자 최초입사일 추적) ───────
export async function loadTenureWorkersFS(): Promise<TenureWorker[] | null> {
  const data = await fsGet<{ rows: TenureWorker[] }>("tenure_workers");
  return data?.rows ?? null;
}
export async function saveTenureWorkersFS(rows: TenureWorker[]): Promise<boolean> {
  return fsSet("tenure_workers", { rows });
}

// ── 급여대장 수동 결근 입력 ───────────────────────────
export async function loadManualAbsencesFS(): Promise<ManualAbsence[]> {
  const data = await fsGet<{ rows: ManualAbsence[] }>("payroll_manual_absences");
  return data?.rows ?? [];
}
export async function saveManualAbsencesFS(rows: ManualAbsence[]): Promise<boolean> {
  return fsSet("payroll_manual_absences", { rows });
}

// ── XERP & PMIS ──────────────────────────────────────
// 날짜별 서브컬렉션으로 저장 (1MB 문서 한계 우회)
// 컬렉션: worksite_data/xerp_pmis_dates/{YYYY-MM-DD} → { rows }
// 컬렉션: worksite_data/xerp_pmis_ph2_dates/{YYYY-MM-DD} → { rows }

const XERP_INDEX_DOC = "xerp_pmis_index";
const XERP_PH2_INDEX_DOC = "xerp_pmis_ph2_index";
const XERP_P5_PH1_INDEX_DOC = "xerp_pmis_p5_ph1_index";

function getXerpDateDocIds(site: string): { indexDocId: string; datePrefix: string; legacyDocId: string } {
  if (site === "PH2") return { indexDocId: XERP_PH2_INDEX_DOC, datePrefix: "xerp_pmis_ph2_date", legacyDocId: "xerp_pmis_ph2" };
  if (site === "P5PH1") return { indexDocId: XERP_P5_PH1_INDEX_DOC, datePrefix: "xerp_pmis_p5_ph1_date", legacyDocId: "xerp_pmis_p5_ph1" };
  return { indexDocId: XERP_INDEX_DOC, datePrefix: "xerp_pmis_date", legacyDocId: "xerp_pmis" };
}

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

export async function loadXerpP5PH1FS(): Promise<Record<string, unknown[]> | null> {
  return loadXerpByDates(XERP_P5_PH1_INDEX_DOC, "xerp_pmis_p5_ph1_date");
}
export async function saveXerpP5PH1FS(dateMap: Record<string, unknown[]>): Promise<boolean> {
  return saveXerpByDates(XERP_P5_PH1_INDEX_DOC, "xerp_pmis_p5_ph1_date", dateMap);
}

export async function loadXerpDateFS(site: string, date: string): Promise<unknown[] | null> {
  const { datePrefix, legacyDocId } = getXerpDateDocIds(site);
  const data = await fsGet<{ rows: unknown[] }>(`${datePrefix}_${date}`);
  if (Array.isArray(data?.rows)) return data.rows;

  const legacy = await fsGet<{ dateMap: Record<string, unknown[]> }>(legacyDocId);
  return legacy?.dateMap?.[date] ?? null;
}

// ── XERP 공수 반영 저장 (사이트별 · 날짜별) ───────────
// 과거에는 모든 날짜를 문서 하나("xerp_work_dates"/dateMap)에 몰아 저장했는데,
// 날짜가 쌓이면서 Firestore 문서 크기 제한(1MB)을 넘어 이후 저장이 전부 조용히 실패했다.
// 또한 사이트 구분 없이 날짜 하나당 문서 하나였어서, 같은 날짜에 다른 사이트(PH4/PH2/P5PH1)
// 파일을 저장하면 서로 덮어쓰는 문제도 있었다.
// 이제는 사이트+날짜별로 별도 문서에 저장하고, 사이트별 인덱스 문서에는 파일명/저장시각만 가볍게 보관한다.
interface XerpWorkEntry { fileName: string; savedAt: string; rows: unknown[]; rawExcelRows?: unknown[] }
type XerpWorkDateMap = Record<string, XerpWorkEntry>;
type XerpWorkDateIndex = Record<string, { fileName: string; savedAt: string }>;

function xerpWorkDatesIndexDocId(site: string): string {
  return `xerp_work_dates_${site}`;
}
function xerpWorkDateDocId(site: string, date: string): string {
  return `xerp_work_date_${site}_${date}`;
}

export async function loadXerpWorkDateMapFS(site: string): Promise<XerpWorkDateMap | null> {
  const index = await fsGet<{ dates?: XerpWorkDateIndex }>(xerpWorkDatesIndexDocId(site));
  const dates = Object.keys(index?.dates ?? {});
  if (dates.length === 0) return null;

  const entries = await Promise.all(
    dates.map(async (date) => [date, await fsGet<XerpWorkEntry>(xerpWorkDateDocId(site, date))] as const),
  );
  const map: XerpWorkDateMap = {};
  for (const [date, entry] of entries) if (entry) map[date] = entry;
  return Object.keys(map).length > 0 ? map : null;
}
export async function saveXerpWorkDateFS(
  site: string, date: string, fileName: string, rows: unknown[], rawExcelRows?: unknown[]
): Promise<boolean> {
  const savedAt = new Date().toISOString();
  const entryOk = await fsSet(xerpWorkDateDocId(site, date), { fileName, savedAt, rows, rawExcelRows: rawExcelRows ?? [] });
  if (!entryOk) return false;

  const index = await fsGet<{ dates?: XerpWorkDateIndex }>(xerpWorkDatesIndexDocId(site));
  const updatedDates: XerpWorkDateIndex = { ...(index?.dates ?? {}), [date]: { fileName, savedAt } };
  return fsSet(xerpWorkDatesIndexDocId(site), { dates: updatedDates });
}
export async function deleteXerpWorkDateFS(site: string, date: string): Promise<boolean> {
  const index = await fsGet<{ dates?: XerpWorkDateIndex }>(xerpWorkDatesIndexDocId(site));
  const updatedDates = { ...(index?.dates ?? {}) };
  delete updatedDates[date];
  const indexOk = await fsSet(xerpWorkDatesIndexDocId(site), { dates: updatedDates });
  if (!indexOk) return false;
  return fsSet(xerpWorkDateDocId(site, date), { fileName: "", savedAt: new Date().toISOString(), rows: [], rawExcelRows: [] });
}

const XERP_WORK_DATE_SITES = ["PH4", "PH2", "P5PH1"];

/** 사이트 구분 없이 전체(모든 사이트) 날짜별 데이터를 합쳐서 조회 — 월별 현황 등 사이트 무관 집계용 */
export async function loadXerpWorkDateMapAllSitesFS(): Promise<XerpWorkDateMap | null> {
  const perSite = await Promise.all(XERP_WORK_DATE_SITES.map((site) => loadXerpWorkDateMapFS(site)));
  const merged: XerpWorkDateMap = {};
  for (const dm of perSite) {
    if (!dm) continue;
    for (const [date, entry] of Object.entries(dm)) {
      // 같은 날짜에 여러 사이트가 저장돼 있으면 rows를 합쳐서 반환
      if (merged[date]) merged[date] = { ...merged[date], rows: [...merged[date].rows, ...entry.rows] };
      else merged[date] = entry;
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}
// 레거시 단일 저장 (하위 호환)
export async function loadXerpWorkFS() {
  return fsGet<{ fileName: string; savedAt: string; rows: unknown[] }>("xerp_work");
}
export async function saveXerpWorkFS(fileName: string, rows: unknown[]) {
  return fsSet("xerp_work", { fileName, savedAt: new Date().toISOString(), rows });
}

const FINAL_WORK_UNITS_PREFIX: Record<string, string> = {
  PH4: "final_work_units_ph4",
  PH2: "final_work_units_ph2",
  P5PH1: "final_work_units_p5ph1",
};
const FINAL_WORK_UNITS_REVIEW_MEMORY_LIMIT = 1000;

function getFinalWorkUnitsPrefix(site: string): string {
  return FINAL_WORK_UNITS_PREFIX[site] ?? "final_work_units_ph4";
}

export async function loadFinalWorkUnitsReviewMemoryFS(site: string): Promise<FinalWorkUnitsReviewMemoryEntry[]> {
  const prefix = getFinalWorkUnitsPrefix(site);
  const data = await fsGet<{ entries?: FinalWorkUnitsReviewMemoryEntry[] }>(`${prefix}_review_memory`);
  return Array.isArray(data?.entries) ? data.entries : [];
}

export async function saveFinalWorkUnitsReviewMemoryFS(
  site: string,
  incomingEntries: FinalWorkUnitsReviewMemoryEntry[],
  savedAt = new Date().toISOString(),
): Promise<boolean> {
  if (incomingEntries.length === 0) return true;
  const prefix = getFinalWorkUnitsPrefix(site);
  const existing = await loadFinalWorkUnitsReviewMemoryFS(site);
  const entries = mergeFinalWorkUnitsReviewMemory(existing, incomingEntries, FINAL_WORK_UNITS_REVIEW_MEMORY_LIMIT);
  return fsSet(`${prefix}_review_memory`, { entries, updatedAt: savedAt });
}

export async function saveFinalWorkUnitsMonthFS(
  site: string,
  month: string,
  snapshot: FinalWorkUnitsMonthSnapshot,
): Promise<boolean> {
  const prefix = getFinalWorkUnitsPrefix(site);
  const docId = `${prefix}_${month}`;
  const chunks = chunkFinalWorkUnitsRows(snapshot.rows);
  const current = await fsGet<{ chunkCount?: number }>(docId);
  const previousChunkCount = Number(current?.chunkCount ?? 0);
  const savedAt = new Date().toISOString();

  const chunkResults = await Promise.all(
    chunks.map((rows, index) => fsSet(`${docId}_rows_${index}`, { rows, savedAt })),
  );
  if (chunkResults.some((ok) => !ok)) return false;

  const staleChunkResults = await Promise.all(
    Array.from({ length: Math.max(0, previousChunkCount - chunks.length) }, (_, index) =>
      fsSet(`${docId}_rows_${chunks.length + index}`, { rows: [], deleted: true, savedAt }),
    ),
  );
  if (staleChunkResults.some((ok) => !ok)) return false;

  const { rows: _rows, ...metadata } = snapshot;
  const ok = await fsSet(docId, {
    ...metadata,
    rowCount: snapshot.rows.length,
    reviewCount: Object.keys(snapshot.reviews ?? {}).length,
    chunkCount: chunks.length,
    savedAt,
  });
  if (!ok) return false;

  const reviewEntries = buildFinalWorkUnitsReviewMemoryEntries({
    site,
    month,
    savedAt,
    rows: snapshot.rows as FinalWorkUnitsReviewMemoryRow[],
    reviews: snapshot.reviews ?? {},
  });
  const memoryOk = await saveFinalWorkUnitsReviewMemoryFS(site, reviewEntries, savedAt);
  if (!memoryOk) return false;

  const indexDocId = `${prefix}_index`;
  const index = (await fsGet<{ months: string[] }>(indexDocId)) ?? { months: [] };
  const savedMonths = Array.isArray(index.months) ? index.months : [];
  const months = Array.from(new Set([...savedMonths, month])).sort().reverse();
  return fsSet(indexDocId, { months, lastSavedAt: savedAt });
}

export async function loadFinalWorkUnitsMonthFS(site: string, month: string): Promise<FinalWorkUnitsMonthSnapshot | null> {
  const prefix = getFinalWorkUnitsPrefix(site);
  const docId = `${prefix}_${month}`;
  const metadata = await fsGet<Omit<FinalWorkUnitsMonthSnapshot, "rows"> & { chunkCount?: number; savedAt?: string }>(docId);
  if (!metadata) return null;
  const chunkCount = Number(metadata.chunkCount ?? 0);
  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, async (_, index) => {
      const chunk = await fsGet<{ rows: unknown[] }>(`${docId}_rows_${index}`);
      return Array.isArray(chunk?.rows) ? chunk.rows : [];
    }),
  );
  const { chunkCount: _chunkCount, savedAt: _savedAt, ...snapshot } = metadata;
  return { ...snapshot, rows: chunks.flat() };
}

export async function listFinalWorkUnitsMonthsFS(site: string): Promise<string[]> {
  const prefix = getFinalWorkUnitsPrefix(site);
  const index = await fsGet<{ months: string[] }>(`${prefix}_index`);
  return Array.isArray(index?.months) ? index.months : [];
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

// ── 날짜별 메모 (site별) ──────────────────────────────────
export async function loadDateMemosFS(site: string): Promise<Record<string, string>> {
  const data = await fsGet<{ memos: Record<string, string> }>(`date_memos_${site}`);
  return data?.memos ?? {};
}
export async function saveDateMemosFS(site: string, memos: Record<string, string>): Promise<boolean> {
  return fsSet(`date_memos_${site}`, { memos });
}

// ── 만근 통계: 현장별 토요 현장근무일 ────────────────────────
export async function loadPerfectAttendanceSaturdaysFS(site: string): Promise<string[]> {
  const data = await fsGet<{ dates: string[] }>(`perfect_attendance_saturdays_${site}`);
  return data?.dates ?? [];
}

export async function savePerfectAttendanceSaturdaysFS(site: string, dates: string[]): Promise<boolean> {
  const normalized = [...new Set(dates)].sort();
  return fsSet(`perfect_attendance_saturdays_${site}`, { dates: normalized });
}

export async function loadPerfectAttendanceWeekdayHolidaysFS(site: string): Promise<string[]> {
  const data = await fsGet<{ dates: string[] }>(`perfect_attendance_weekday_holidays_${site}`);
  return data?.dates ?? [];
}

export async function savePerfectAttendanceWeekdayHolidaysFS(site: string, dates: string[]): Promise<boolean> {
  const normalized = [...new Set(dates)].sort();
  return fsSet(`perfect_attendance_weekday_holidays_${site}`, { dates: normalized });
}

// ── XERP 공수 반영 다운로드 이력 ──────────────────────────
export interface DownloadHistoryEntry {
  downloadedAt: string;
  workDate: string;
  fileName: string;
  rowCount: number;
}
export async function loadDownloadHistoryFS(): Promise<DownloadHistoryEntry[]> {
  const data = await fsGet<{ history: DownloadHistoryEntry[] }>("xerp_download_history");
  return data?.history ?? [];
}
export async function addDownloadHistoryFS(entry: DownloadHistoryEntry): Promise<boolean> {
  const current = await loadDownloadHistoryFS();
  const updated = [entry, ...current].slice(0, 100);
  return fsSet("xerp_download_history", { history: updated });
}

// ── 지출결의서 ───────────────────────────────────────
export interface ExpenseCatalogItem {
  id: string;
  name: string;       // 항목명
  unit: string;       // 단위
  defaultPrice: number; // 기본단가
  note: string;
}

export interface ExpenseLineItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  note: string;
}

export interface ExpenseReport {
  id: string;
  title: string;
  yearMonth: string;   // YYYY-MM
  writtenDate: string; // 작성일
  paymentDate: string; // 지급요청일
  department: string;
  items: ExpenseLineItem[];
  savedAt: string;
}

export async function loadExpenseCatalogFS(): Promise<ExpenseCatalogItem[]> {
  const data = await fsGet<{ items: ExpenseCatalogItem[] }>("expense_catalog");
  return data?.items ?? [];
}
export async function saveExpenseCatalogFS(items: ExpenseCatalogItem[]): Promise<boolean> {
  return fsSet("expense_catalog", { items });
}

// 월별 지급요청일: { "YYYY-MM": { date: "YYYY-MM-DD", note: "항목명" } }
export interface PaymentDateEntry { date: string; note: string; }
export async function loadPaymentDatesFS(): Promise<Record<string, PaymentDateEntry>> {
  const data = await fsGet<{ dates: Record<string, PaymentDateEntry | string> }>("expense_payment_dates");
  if (!data?.dates) return {};
  // 구버전(string) 마이그레이션
  return Object.fromEntries(
    Object.entries(data.dates).map(([ym, v]) =>
      [ym, typeof v === "string" ? { date: v, note: "" } : v]
    )
  );
}
export async function savePaymentDatesFS(dates: Record<string, PaymentDateEntry>): Promise<boolean> {
  return fsSet("expense_payment_dates", { dates });
}

export async function loadExpenseReportsFS(): Promise<ExpenseReport[]> {
  const data = await fsGet<{ reports: ExpenseReport[] }>("expense_reports");
  return data?.reports ?? [];
}
export async function saveExpenseReportsFS(reports: ExpenseReport[]): Promise<boolean> {
  return fsSet("expense_reports", { reports });
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

// ── PMIS IN/OUT 로그 (일별, 사이트별) ────────────────
const PMIS_LOG_PREFIX: Record<string, string> = {
  PH4: "pmis_log_ph4",
  PH2: "pmis_log_ph2",
  P5PH1: "pmis_log_p5ph1",
};

export async function savePmisLogFS(site: string, date: string, data: unknown): Promise<boolean> {
  const prefix = PMIS_LOG_PREFIX[site] ?? "pmis_log_ph4";
  const ok = await fsSet(`${prefix}_${date}`, { data, savedAt: new Date().toISOString() });
  if (!ok) return false;
  const index = (await fsGet<{ dates: string[] }>(`${prefix}_index`)) ?? { dates: [] };
  const dates = Array.from(new Set([...index.dates, date])).sort().reverse();
  return fsSet(`${prefix}_index`, { dates });
}

export async function loadPmisLogFS(site: string, date: string): Promise<unknown | null> {
  const prefix = PMIS_LOG_PREFIX[site] ?? "pmis_log_ph4";
  const doc = await fsGet<{ data: unknown }>(`${prefix}_${date}`);
  return doc?.data ?? null;
}

export async function listPmisLogDatesFS(site: string): Promise<string[]> {
  const prefix = PMIS_LOG_PREFIX[site] ?? "pmis_log_ph4";
  const index = await fsGet<{ dates: string[] }>(`${prefix}_index`);
  return index?.dates ?? [];
}

export async function deletePmisLogFS(site: string, date: string): Promise<boolean> {
  const prefix = PMIS_LOG_PREFIX[site] ?? "pmis_log_ph4";
  const index = (await fsGet<{ dates: string[] }>(`${prefix}_index`)) ?? { dates: [] };
  const dates = index.dates.filter((d) => d !== date);
  await fsSet(`${prefix}_index`, { dates });
  return fsSet(`${prefix}_${date}`, { data: null, deleted: true });
}

// ── 전자카드 기록 (일별, 사이트별) 저장 ─────────────────────────────
const ELECTRONIC_CARD_PREFIX: Record<string, string> = {
  PH4: "electronic_card_ph4",
  PH2: "electronic_card_ph2",
  P5PH1: "electronic_card_p5ph1",
};

export function getElectronicCardDocIds(site: string, date: string): { prefix: string; dateDocId: string; indexDocId: string } {
  const prefix = ELECTRONIC_CARD_PREFIX[site] ?? "electronic_card_ph4";
  return {
    prefix,
    dateDocId: `${prefix}_${date}`,
    indexDocId: `${prefix}_index`,
  };
}

export async function saveElectronicCardFS(site: string, date: string, data: unknown): Promise<boolean> {
  const { dateDocId, indexDocId } = getElectronicCardDocIds(site, date);
  const ok = await fsSet(dateDocId, { data, savedAt: new Date().toISOString() });
  if (!ok) return false;
  const index = (await fsGet<{ dates: string[] }>(indexDocId)) ?? { dates: [] };
  const dates = Array.from(new Set([...index.dates, date])).sort().reverse();
  return fsSet(indexDocId, { dates, lastSyncedAt: new Date().toISOString() });
}

export async function loadElectronicCardFS(site: string, date: string): Promise<unknown | null> {
  const { dateDocId } = getElectronicCardDocIds(site, date);
  const doc = await fsGet<{ data: unknown }>(dateDocId);
  return doc?.data ?? null;
}

export async function listElectronicCardDatesFS(site: string): Promise<string[]> {
  const { indexDocId } = getElectronicCardDocIds(site, "");
  const index = await fsGet<{ dates: string[] }>(indexDocId);
  return index?.dates ?? [];
}

// ── 카톡 근태 이벤트 (월별 문서) ─────────────────────────
// 카톡 원문 전체가 아니라 근태 관련 이벤트(날짜·이름·사유·해당 메시지)만 저장한다.
function kakaoEventsDocId(month: string): string {
  return `kakao_events_${month}`;
}
export async function loadKakaoEventsFS<T = unknown>(month: string): Promise<T[]> {
  const data = await fsGet<{ events?: T[] }>(kakaoEventsDocId(month));
  return data?.events ?? [];
}
export async function saveKakaoEventsFS(month: string, events: unknown[]): Promise<boolean> {
  return fsSet(kakaoEventsDocId(month), removeUndefinedFields({ events, updatedAt: new Date().toISOString() }) as object);
}

/** 지정한 날짜들의 XERP 공수반영 행만 읽는다(사이트 구분 없이 합침). 전체 날짜를 다 읽지 않기 위한 가벼운 조회. */
export async function loadXerpWorkRowsForDatesFS(dates: string[], sites?: readonly string[]): Promise<Record<string, unknown[]>> {
  const wanted = new Set(dates);
  const result: Record<string, unknown[]> = {};
  await Promise.all(
    XERP_WORK_DATE_SITES.filter((site) => !sites || sites.includes(site)).map(async (site) => {
      const index = await fsGet<{ dates?: XerpWorkDateIndex }>(xerpWorkDatesIndexDocId(site));
      const siteDates = Object.keys(index?.dates ?? {}).filter((d) => wanted.has(d));
      const entries = await Promise.all(siteDates.map(async (d) => [d, await fsGet<XerpWorkEntry>(xerpWorkDateDocId(site, d))] as const));
      for (const [d, entry] of entries) {
        if (entry?.rows?.length) result[d] = [...(result[d] ?? []), ...entry.rows];
      }
    }),
  );
  return result;
}
