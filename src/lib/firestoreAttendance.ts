/**
 * 근태 데이터 Firebase Firestore 서비스
 *
 * 컬렉션 구조:
 *   attendance/{year}_{month}   → 해당 월 전체 데이터
 *   upload_meta/latest          → 최신 업로드 메타데이터
 *   row_order/{context}         → 행 순서 (context: "attendance_한성_F" 등)
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { ParsedData } from "./parseExcel";

const COL_ATT = "attendance";
const COL_META = "upload_meta";
const COL_ORDER = "row_order";

// ── 저장 ──────────────────────────────────────────────────────
export async function saveAttendanceFS(data: ParsedData, fileName: string): Promise<void> {
  if (!db) throw new Error("Firebase가 설정되지 않았습니다. 환경변수를 확인하세요.");

  const docId = `${data.dataYear}_${String(data.dataMonth).padStart(2, "0")}`;
  const uploadedAt = new Date().toISOString();

  await setDoc(doc(db, COL_ATT, docId), {
    dataYear: data.dataYear,
    dataMonth: data.dataMonth,
    fileName,
    uploadedAt,
    employees: data.employees,
    anomalies: data.anomalies,
    annualLeaveMap: data.annualLeaveMap,
    leaveEmployees: data.leaveEmployees,
    leaveDetails: data.leaveDetails,
  });

  // 최신 업로드 메타 갱신 (빠른 조회용)
  await setDoc(doc(db, COL_META, "latest"), {
    docId,
    fileName,
    uploadedAt,
    recordCount: data.employees.length,
  });
}

// ── 불러오기 ──────────────────────────────────────────────────
export async function fetchAttendanceFS(): Promise<{ data: ParsedData; uploadedAt: string } | null> {
  if (!db) return null;

  try {
    const metaSnap = await getDoc(doc(db, COL_META, "latest"));
    if (!metaSnap.exists()) return null;

    const meta = metaSnap.data() as { docId: string; uploadedAt: string };

    const attSnap = await getDoc(doc(db, COL_ATT, meta.docId));
    if (!attSnap.exists()) return null;

    const raw = attSnap.data() as any;

    return {
      data: {
        dataYear: raw.dataYear,
        dataMonth: raw.dataMonth,
        employees: raw.employees ?? [],
        anomalies: raw.anomalies ?? [],
        annualLeaveMap: raw.annualLeaveMap ?? {},
        leaveEmployees: raw.leaveEmployees ?? [],
        leaveDetails: raw.leaveDetails ?? [],
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
    await setDoc(doc(db, COL_ORDER, context), { names });
  } catch (e) {
    console.warn("[Firestore] saveRowOrderFS failed:", e);
  }
}

export async function fetchRowOrderFS(context: string): Promise<string[]> {
  if (!db) return [];
  try {
    const snap = await getDoc(doc(db, COL_ORDER, context));
    if (!snap.exists()) return [];
    const data = snap.data();
    return Array.isArray(data.names) ? (data.names as string[]) : [];
  } catch (e) {
    console.warn("[Firestore] fetchRowOrderFS failed:", e);
    return [];
  }
}
