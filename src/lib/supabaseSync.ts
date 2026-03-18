import { supabase } from "@/integrations/supabase/client";
import type { ParsedData, Employee, AnomalyRecord, LeaveEmployee, LeaveDetail } from "./parseExcel";

export async function saveToSupabase(data: ParsedData, fileName: string): Promise<void> {
  const { dataYear, dataMonth } = data;

  // Clear existing data for this year/month + leave tables (전체 교체)
  await Promise.all([
    supabase.from("attendance_data").delete().eq("year", dataYear).eq("month", dataMonth),
    supabase.from("anomaly_data").delete().eq("year", dataYear).eq("month", dataMonth),
    supabase.from("yeoncha_data").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    supabase.from("leave_employees").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    supabase.from("leave_details").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
  ]);

  // Insert attendance data
  if (data.employees.length > 0) {
    const rows = data.employees.map((emp) => ({
      name: emp.name,
      team: emp.team,
      job: emp.jobTitle,
      year: emp.dataYear,
      month: emp.dataMonth,
      days_json: { ...emp.dailyRecords, __rank: emp.rank || "" },
    }));
    // Insert in batches of 50
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await supabase.from("attendance_data").upsert(rows.slice(i, i + 50), {
        onConflict: "name,team,year,month",
      });
      if (error) throw new Error(`attendance_data insert error: ${error.message}`);
    }
  }

  // Insert anomaly data
  if (data.anomalies.length > 0) {
    const anomalyRows = data.anomalies.map((a) => ({
      name: a.name,
      year: dataYear,
      month: dataMonth,
      mita: 0,
      jigak: a.지각,
      gyeol: a.결근,
      bansa: a.반차,
      yeoncha: a.연차,
    }));
    const { error } = await supabase.from("anomaly_data").upsert(anomalyRows, {
      onConflict: "name,year,month",
    });
    if (error) throw new Error(`anomaly_data insert error: ${error.message}`);
  }

  // Insert yeoncha data
  const yeonchaRows: { name: string; year: number; month: number; day: number }[] = [];
  for (const [name, dates] of Object.entries(data.annualLeaveMap)) {
    for (const key of Object.keys(dates)) {
      const [y, m, d] = key.split("|").map(Number);
      yeonchaRows.push({ name, year: y, month: m, day: d });
    }
  }
  if (yeonchaRows.length > 0) {
    for (let i = 0; i < yeonchaRows.length; i += 50) {
      const { error } = await supabase.from("yeoncha_data").upsert(yeonchaRows.slice(i, i + 50), {
        onConflict: "name,year,month,day",
      });
      if (error) throw new Error(`yeoncha_data insert error: ${error.message}`);
    }
  }

  // Insert leave_employees (연차_현채직)
  if (data.leaveEmployees.length > 0) {
    const leaveEmpRows = data.leaveEmployees.map((e) => ({
      name: e.name,
      dept: e.dept || "",
      hire_date: e.hireDate || "",
      accrued: e.totalUsed + e.remaining,
      total_used: e.totalUsed,
      remaining: e.remaining,
    }));
    for (let i = 0; i < leaveEmpRows.length; i += 50) {
      const { error } = await supabase.from("leave_employees").upsert(leaveEmpRows.slice(i, i + 50), {
        onConflict: "name",
      });
      if (error) throw new Error(`leave_employees insert error: ${error.message}`);
    }
  }

  // Insert leave_details (연차_상세)
  if (data.leaveDetails.length > 0) {
    const leaveDetailRows = data.leaveDetails.map((d) => ({
      name: d.name,
      year: d.year,
      month: d.month,
      day: d.day,
      days: d.days,
      reason: d.reason || "",
    }));
    for (let i = 0; i < leaveDetailRows.length; i += 50) {
      const { error } = await supabase.from("leave_details").upsert(leaveDetailRows.slice(i, i + 50), {
        onConflict: "name,year,month,day",
      });
      if (error) throw new Error(`leave_details insert error: ${error.message}`);
    }
  }

  // Save upload metadata
  const { error: metaError } = await supabase.from("upload_metadata").insert({
    file_name: fileName,
    record_count: data.employees.length,
  });
  if (metaError) throw new Error(`upload_metadata insert error: ${metaError.message}`);
}

export async function fetchFromSupabase(): Promise<{ data: ParsedData; uploadedAt: string } | null> {
  // Get latest upload metadata
  const { data: meta } = await supabase
    .from("upload_metadata")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .single();

  if (!meta) return null;

  // Fetch all data
  const [attRes, anomRes, yeonRes, leaveEmpRes, leaveDetailRes] = await Promise.all([
    supabase.from("attendance_data").select("*"),
    supabase.from("anomaly_data").select("*"),
    supabase.from("yeoncha_data").select("*"),
    supabase.from("leave_employees").select("*"),
    supabase.from("leave_details").select("*").order("year").order("month").order("day"),
  ]);

  if (!attRes.data?.length) return null;

  // Reconstruct employees
  const employees: Employee[] = (attRes.data || []).map((row: any) => {
    const rawJson = row.days_json || {};
    const { __rank, ...dailyRecords } = rawJson;
    return {
      team: row.team as "한성_F" | "태화_F",
      name: row.name,
      jobTitle: row.job,
      rank: typeof __rank === "string" ? __rank : "",
      totalDays: Object.keys(dailyRecords).length,
      dataYear: row.year,
      dataMonth: row.month,
      dailyRecords,
    };
  });

  // Sort: 한성_F first, then 태화_F
  employees.sort((a, b) => {
    if (a.team === b.team) return 0;
    return a.team === "한성_F" ? -1 : 1;
  });

  // Reconstruct anomalies
  const anomalies: AnomalyRecord[] = (anomRes.data || []).map((row: any) => ({
    name: row.name,
    지각: row.jigak,
    결근: row.gyeol,
    반차: row.bansa,
    연차: row.yeoncha,
  }));

  // Reconstruct annualLeaveMap
  const annualLeaveMap: Record<string, Record<string, boolean>> = {};
  for (const row of yeonRes.data || []) {
    const r = row as any;
    const key = `${r.year}|${r.month}|${r.day}`;
    if (!annualLeaveMap[r.name]) annualLeaveMap[r.name] = {};
    annualLeaveMap[r.name][key] = true;
  }

  // Reconstruct leaveEmployees
  const leaveEmployees: LeaveEmployee[] = (leaveEmpRes.data || []).map((row: any) => ({
    name: row.name,
    dept: row.dept,
    hireDate: row.hire_date,
    totalUsed: Number(row.total_used),
    remaining: Number(row.remaining),
  }));

  // Reconstruct leaveDetails (날짜순 정렬은 쿼리에서 처리됨)
  const leaveDetails: LeaveDetail[] = (leaveDetailRes.data || []).map((row: any) => ({
    year: row.year,
    month: row.month,
    day: row.day,
    name: row.name,
    days: Number(row.days),
    reason: row.reason,
  }));

  // Determine dataYear/dataMonth from first employee
  const dataYear = employees[0]?.dataYear || new Date().getFullYear();
  const dataMonth = employees[0]?.dataMonth || new Date().getMonth() + 1;

  return {
    data: { employees, anomalies, annualLeaveMap, dataYear, dataMonth, leaveEmployees, leaveDetails },
    uploadedAt: meta.uploaded_at,
  };
}

export async function saveRowOrder(context: string, names: string[]): Promise<void> {
  const { error } = await (supabase as any)
    .from("row_order")
    .upsert({ context, names }, { onConflict: "context" });
  if (error) throw new Error(`row_order upsert error: ${error.message}`);
}

export async function fetchRowOrder(context: string): Promise<string[]> {
  const { data } = await (supabase as any)
    .from("row_order")
    .select("names")
    .eq("context", context)
    .single();
  if (!data) return [];
  return Array.isArray(data.names) ? (data.names as string[]) : [];
}

export async function fetchLastUploadTime(): Promise<string | null> {
  const { data } = await supabase
    .from("upload_metadata")
    .select("uploaded_at")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .single();
  return data?.uploaded_at || null;
}
