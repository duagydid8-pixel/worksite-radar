/**
 * 근태 데이터 Firebase Firestore 서비스
 *
 * 컬렉션 구조:
 *   attendance/{year}_{month}_main  → employees + anomalies
 *   attendance/{year}_{month}_leave → annualLeaveMap + leaveEmployees + leaveDetails
 *   upload_meta/latest              → 최신 업로드 메타데이터
 *   row_order/{context}             → 행 순서
 *
 * ※ 1MB Firestore 문서 제한 대응을 위해 데이터를 두 문서로 분리
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { ParsedData } from "./parseExcel";

const COL = "attendance";
const COL_META = "upload_meta";
const COL_ORDER = "row_order";
const TIMEOUT_MS = 30_000;

/** Promise에 타임아웃을 걸어 무한 대기 방지 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 타임아웃 (${ms / 1000}초 초과)`)), ms)
    ),
  ]);
}

// ── 저장 ──────────────────────────────────────────────────────
export async function saveAttendanceFS(data: ParsedData, fileName: string): Promise<void> {
  if (!db) throw new Error("Firebase 환경변수가 설정되지 않았습니다.");

  const base = `${data.dataYear}_${String(data.dataMonth).padStart(2, "0")}`;
  const uploadedAt = new Date().toISOString();

  // 문서1: 근태 + 이상 데이터 (직원 dailyRecords 포함)
  await withTimeout(
    setDoc(doc(db, COL, `${base}_main`), {
      dataYear: data.dataYear,
      dataMonth: data.dataMonth,
      fileName,
      uploadedAt,
      employees: data.employees,
      anomalies: data.anomalies,
    }),
    TIMEOUT_MS,
    "근태 데이터 저장"
  );

  // 문서2: 연차 관련 데이터
  await withTimeout(
    setDoc(doc(db, COL, `${base}_leave`), {
      annualLeaveMap: data.annualLeaveMap,
      leaveEmployees: data.leaveEmployees,
      leaveDetails: data.leaveDetails,
    }),
    TIMEOUT_MS,
    "연차 데이터 저장"
  );

  // 최신 업로드 메타 갱신
  await withTimeout(
    setDoc(doc(db, COL_META, "latest"), {
      base,
      fileName,
      uploadedAt,
      recordCount: data.employees.length,
    }),
    TIMEOUT_MS,
    "메타 저장"
  );
}

// ── 불러오기 ──────────────────────────────────────────────────
export async function fetchAttendanceFS(): Promise<{ data: ParsedData; uploadedAt: string } | null> {
  if (!db) return null;

  try {
    const metaSnap = await withTimeout(
      getDoc(doc(db, COL_META, "latest")),
      TIMEOUT_MS,
      "메타 조회"
    );
    if (!metaSnap.exists()) return null;

    const meta = metaSnap.data() as { base: string; uploadedAt: string };

    const [mainSnap, leaveSnap] = await withTimeout(
      Promise.all([
        getDoc(doc(db, COL, `${meta.base}_main`)),
        getDoc(doc(db, COL, `${meta.base}_leave`)),
      ]),
      TIMEOUT_MS,
      "데이터 조회"
    );

    if (!mainSnap.exists()) return null;

    const main = mainSnap.data() as any;
    const leave = leaveSnap.exists() ? (leaveSnap.data() as any) : {};

    return {
      data: {
        dataYear: main.dataYear,
        dataMonth: main.dataMonth,
        employees: main.employees ?? [],
        anomalies: main.anomalies ?? [],
        annualLeaveMap: leave.annualLeaveMap ?? {},
        leaveEmployees: leave.leaveEmployees ?? [],
        leaveDetails: leave.leaveDetails ?? [],
      },
      uploadedAt: meta.uploadedAt,
    };
  } catch (e) {
    console.warn("[Firestore] fetchAttendanceFS failed:", e);
    return null;
  }
}

// ── 행 순서 저장 / 불러오기 ───────────────────────────────────
export async function saveRowOrderFS(context: string, names: string[]): Promise<void> {
  if (!db) return;
  try {
    await withTimeout(
      setDoc(doc(db, COL_ORDER, context), { names }),
      TIMEOUT_MS,
      "행 순서 저장"
    );
  } catch (e) {
    console.warn("[Firestore] saveRowOrderFS failed:", e);
  }
}

export async function fetchRowOrderFS(context: string): Promise<string[]> {
  if (!db) return [];
  try {
    const snap = await withTimeout(
      getDoc(doc(db, COL_ORDER, context)),
      TIMEOUT_MS,
      "행 순서 조회"
    );
    if (!snap.exists()) return [];
    const d = snap.data();
    return Array.isArray(d.names) ? (d.names as string[]) : [];
  } catch (e) {
    console.warn("[Firestore] fetchRowOrderFS failed:", e);
    return [];
  }
}
