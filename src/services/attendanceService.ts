import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebaseClient";
import type { ParsedData } from "../types/attendance";

const COL = "attendance";
const COL_META = "upload_meta";
const COL_ORDER = "row_order";
const TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 타임아웃 (${ms / 1000}초 초과)`)), ms)
    ),
  ]);
}

export async function saveAttendanceFS(data: ParsedData, fileName: string): Promise<void> {
  if (!db) throw new Error("Firebase 환경변수가 설정되지 않았습니다.");
  const base = `${data.dataYear}_${String(data.dataMonth).padStart(2, "0")}`;
  const uploadedAt = new Date().toISOString();
  await withTimeout(setDoc(doc(db, COL, `${base}_main`), { dataYear: data.dataYear, dataMonth: data.dataMonth, fileName, uploadedAt, employees: data.employees, anomalies: data.anomalies }), TIMEOUT_MS, "근태 데이터 저장");
  await withTimeout(setDoc(doc(db, COL, `${base}_leave`), { annualLeaveMap: data.annualLeaveMap, leaveEmployees: data.leaveEmployees, leaveDetails: data.leaveDetails }), TIMEOUT_MS, "연차 데이터 저장");
  await withTimeout(setDoc(doc(db, COL_META, "latest"), { base, fileName, uploadedAt, recordCount: data.employees.length }), TIMEOUT_MS, "메타 저장");
}

export async function fetchAttendanceFS(): Promise<{ data: ParsedData; uploadedAt: string } | null> {
  if (!db) return null;
  try {
    const metaSnap = await withTimeout(getDoc(doc(db, COL_META, "latest")), TIMEOUT_MS, "메타 조회");
    if (!metaSnap.exists()) return null;
    const meta = metaSnap.data() as { base: string; uploadedAt: string };
    const [mainSnap, leaveSnap] = await withTimeout(Promise.all([getDoc(doc(db, COL, `${meta.base}_main`)), getDoc(doc(db, COL, `${meta.base}_leave`))]), TIMEOUT_MS, "데이터 조회");
    if (!mainSnap.exists()) return null;
    const main = mainSnap.data() as any;
    const leave = leaveSnap.exists() ? (leaveSnap.data() as any) : {};
    return { data: { dataYear: main.dataYear, dataMonth: main.dataMonth, employees: main.employees ?? [], anomalies: main.anomalies ?? [], annualLeaveMap: leave.annualLeaveMap ?? {}, leaveEmployees: leave.leaveEmployees ?? [], leaveDetails: leave.leaveDetails ?? [] }, uploadedAt: meta.uploadedAt };
  } catch (e) {
    console.warn("[Firestore] fetchAttendanceFS failed:", e);
    return null;
  }
}

export async function saveRowOrderFS(context: string, names: string[]): Promise<void> {
  if (!db) return;
  try {
    await withTimeout(setDoc(doc(db, COL_ORDER, context), { names }), TIMEOUT_MS, "행 순서 저장");
  } catch (e) {
    console.warn("[Firestore] saveRowOrderFS failed:", e);
  }
}

export async function fetchRowOrderFS(context: string): Promise<string[]> {
  if (!db) return [];
  try {
    const snap = await withTimeout(getDoc(doc(db, COL_ORDER, context)), TIMEOUT_MS, "행 순서 조회");
    if (!snap.exists()) return [];
    const d = snap.data();
    return Array.isArray(d.names) ? (d.names as string[]) : [];
  } catch (e) {
    console.warn("[Firestore] fetchRowOrderFS failed:", e);
    return [];
  }
}
