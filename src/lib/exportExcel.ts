import * as XLSX from "xlsx";
import type { Employee, LeaveEmployee, LeaveDetail, AnomalyRecord } from "./parseExcel";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function formatDateCol(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}(${DAY_NAMES[date.getDay()]})`;
}

function isLate(timeStr: string): boolean {
  const [h, m] = timeStr.split(":").map(Number);
  return h > 6 || (h === 6 && m > 30);
}

export function exportAttendanceExcel(
  employees: Employee[],
  annualLeaveMap: Record<string, Record<string, boolean>>,
  weekDates: Date[]
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 헤더 행
  const dateHeaders: string[] = [];
  for (const d of weekDates) {
    const label = formatDateCol(d);
    dateHeaders.push(`${label} 출근`);
    dateHeaders.push(`${label} 퇴근`);
  }
  const header = ["NO", "팀", "이름", "직종", ...dateHeaders, "이상사항(이번주)"];

  const rows: (string | number)[][] = [header];

  employees.forEach((emp, idx) => {
    const cells: (string | number)[] = [idx + 1, emp.team, emp.name, emp.jobTitle];

    // 각 날짜별 출퇴근
    weekDates.forEach((date, di) => {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const key = `${year}-${month}-${day}`;
      const leaveKey = `${year}|${month}|${day}`;
      const cellDate = new Date(date);
      cellDate.setHours(0, 0, 0, 0);
      const isFuture = cellDate > today;
      const isWeekend = di >= 6;

      if (isFuture) { cells.push("", ""); return; }

      const rec = emp.dailyRecords[key];
      const hasLeave = annualLeaveMap[emp.name]?.[leaveKey];

      if (hasLeave && (!rec || !rec.punchIn)) {
        cells.push("연차", "");
        return;
      }
      if (!rec || (!rec.punchIn && !rec.punchOut)) {
        if (emp.team === "태화_F" && !isWeekend) {
          cells.push("미출근", "");
        } else {
          cells.push("", "");
        }
        return;
      }

      const pIn = rec.punchIn || "";
      const pOut = rec.punchOut || "";
      const lateFlag = pIn && isLate(pIn) ? `⏰ ${pIn}` : pIn;
      const uncheckFlag = !pOut && emp.team === "태화_F" ? "↑미기록" : pOut;
      cells.push(lateFlag, uncheckFlag);
    });

    // 이상사항 (이번주 지각 수)
    let lateCount = 0;
    weekDates.forEach((wd, i) => {
      if (i >= 6) return;
      const cellDate = new Date(wd);
      cellDate.setHours(0, 0, 0, 0);
      if (cellDate > today) return;
      if (wd.getDay() === 0) return;
      const leaveKey = `${wd.getFullYear()}|${wd.getMonth() + 1}|${wd.getDate()}`;
      if (annualLeaveMap[emp.name]?.[leaveKey]) return;
      const key = `${wd.getFullYear()}-${wd.getMonth() + 1}-${wd.getDate()}`;
      const rec = emp.dailyRecords[key];
      if (rec?.punchIn && isLate(rec.punchIn)) lateCount++;
    });
    cells.push(lateCount > 0 ? `지각 ${lateCount}` : "이상없음");

    rows.push(cells);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // 열 너비 설정
  ws["!cols"] = [
    { wch: 4 }, { wch: 8 }, { wch: 8 }, { wch: 10 },
    ...weekDates.flatMap(() => [{ wch: 12 }, { wch: 10 }]),
    { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "근태보고");
  XLSX.writeFile(wb, `근태보고_${todayStr()}.xlsx`);
}

function buildMonthlySheet(
  employees: Employee[],
  annualLeaveMap: Record<string, Record<string, boolean>>,
  anomalyMap: Map<string, AnomalyRecord>,
  dataYear: number,
  dataMonth: number,
  isHanseong: boolean
): XLSX.WorkSheet {
  const daysInMonth = new Date(dataYear, dataMonth, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayStartCol = isHanseong ? 10 : 11;
  const monthStr = String(dataMonth).padStart(2, "0");
  const totalCols = dayStartCol + daysInMonth * 2 + 3; // +3: 빈칸2 + 비고1
  const bigoCol = dayStartCol + daysInMonth * 2 + 2;

  const makeRow = (len = totalCols): any[] => new Array(len).fill(null);

  // Row 1: 제목
  const row1 = makeRow(80);
  if (isHanseong) {
    row1[1] = "평택 초순수 현장 P4-Ph.4 한성 관리자 근태표";
    row1[11] = parseFloat(`${dataYear}.${monthStr}`);
    row1[12] = `${dataYear}년 ${monthStr}월`;
    row1[74] = "반차"; row1[75] = "결근"; row1[76] = "지각"; row1[77] = "미타각"; row1[78] = "예비군";
  } else {
    row1[7] = "평택 초순수 현장 P4-Ph.4 협력사 관리자 근태표";
    row1[20] = parseFloat(`${dataYear}.${monthStr}`);
    row1[74] = "결근"; row1[75] = "지각"; row1[76] = "미타각"; row1[77] = "예비군";
  }

  // Row 2: 보조 헤더
  const row2 = makeRow(80);
  row2[75] = "기타"; row2[76] = "입사"; row2[77] = "퇴사"; row2[78] = "병가";
  if (!isHanseong) row2[79] = "외근";

  // Row 3: 컬럼 헤더
  const row3 = makeRow();
  if (isHanseong) {
    row3[0] = "NO"; row3[1] = "성명"; row3[2] = "직종"; row3[3] = "구분";
    row3[4] = "미타각"; row3[5] = "지각"; row3[6] = "결근"; row3[7] = "반차"; row3[8] = "연차"; row3[9] = "주말\n근무";
  } else {
    row3[0] = "NO"; row3[1] = "현장명"; row3[2] = "성명"; row3[3] = "직종"; row3[4] = "노임";
    row3[5] = "미타각"; row3[6] = "지각"; row3[7] = "결근"; row3[8] = "반차"; row3[9] = "연차"; row3[10] = "주말\n근무";
  }
  for (let d = 1; d <= daysInMonth; d++) row3[dayStartCol + (d - 1) * 2] = `${d}일`;
  row3[bigoCol] = "비고";

  // Row 4: 출근/퇴근 서브 헤더
  const row4 = makeRow();
  for (let d = 1; d <= daysInMonth; d++) {
    row4[dayStartCol + (d - 1) * 2] = "출\n근";
    row4[dayStartCol + (d - 1) * 2 + 1] = "퇴\n근";
  }

  const aoa: any[][] = [row1, row2, row3, row4];

  employees.forEach((emp, idx) => {
    const anomaly = anomalyMap.get(emp.name);

    let lateCount = 0, absentCount = 0, uncheckCount = 0, leaveCount = 0, weekendCount = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(dataYear, dataMonth - 1, d);
      dateObj.setHours(0, 0, 0, 0);
      const dow = dateObj.getDay();
      const leaveKey = `${dataYear}|${dataMonth}|${d}`;
      const isLeave = !!(annualLeaveMap[emp.name]?.[leaveKey]);
      const key = `${dataYear}-${dataMonth}-${d}`;
      const rec = emp.dailyRecords[key];

      if (dow === 0 || dow === 6) { if (rec?.punchIn) weekendCount++; continue; }
      if (isLeave) { leaveCount++; continue; }
      if (dateObj > today) continue;

      if (rec?.punchIn) {
        if (isLate(rec.punchIn)) lateCount++;
        if (!isHanseong && !rec.punchOut) uncheckCount++;
      } else {
        absentCount++;
      }
    }

    const dataRow = makeRow();
    if (isHanseong) {
      dataRow[0] = idx + 1; dataRow[1] = emp.name; dataRow[2] = emp.jobTitle; dataRow[3] = emp.rank;
      dataRow[4] = uncheckCount; dataRow[5] = lateCount; dataRow[6] = absentCount;
      dataRow[7] = 0; dataRow[8] = leaveCount; dataRow[9] = weekendCount;
    } else {
      dataRow[0] = idx + 1; dataRow[1] = "태화"; dataRow[2] = emp.name; dataRow[3] = emp.jobTitle; dataRow[4] = "월급";
      dataRow[5] = uncheckCount; dataRow[6] = anomaly?.지각 ?? lateCount;
      dataRow[7] = anomaly?.결근 ?? absentCount; dataRow[8] = anomaly?.반차 ?? 0;
      dataRow[9] = anomaly?.연차 ?? leaveCount; dataRow[10] = weekendCount;
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const leaveKey = `${dataYear}|${dataMonth}|${d}`;
      const isLeave = !!(annualLeaveMap[emp.name]?.[leaveKey]);
      const key = `${dataYear}-${dataMonth}-${d}`;
      const rec = emp.dailyRecords[key];
      const inCol = dayStartCol + (d - 1) * 2;

      if (isLeave) {
        dataRow[inCol] = "연차";
        dataRow[inCol + 1] = "연차";
      } else if (rec?.punchIn) {
        dataRow[inCol] = rec.punchIn;
        if (!isHanseong) dataRow[inCol + 1] = rec.punchOut || "미타각";
      }
    }

    aoa.push(dataRow);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 열 너비
  const cols: XLSX.ColInfo[] = [];
  if (isHanseong) {
    cols.push({ wch: 4 }, { wch: 8 }, { wch: 8 }, { wch: 6 },
      { wch: 5 }, { wch: 4 }, { wch: 4 }, { wch: 4 }, { wch: 4 }, { wch: 5 });
  } else {
    cols.push({ wch: 4 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 5 },
      { wch: 5 }, { wch: 4 }, { wch: 4 }, { wch: 4 }, { wch: 4 }, { wch: 5 });
  }
  for (let d = 0; d < daysInMonth; d++) cols.push({ wch: 6 }, { wch: 6 });
  cols.push({ wch: 4 }, { wch: 4 }, { wch: 12 });
  ws["!cols"] = cols;

  return ws;
}

export function exportMonthlyExcel(
  allEmployees: Employee[],
  annualLeaveMap: Record<string, Record<string, boolean>>,
  anomalyMap: Map<string, AnomalyRecord>,
  dataYear: number,
  dataMonth: number
): void {
  const hanseongEmps = allEmployees.filter(
    (e) => e.team === "한성_F" && e.dataYear === dataYear && e.dataMonth === dataMonth
  );
  const taehwaEmps = allEmployees.filter(
    (e) => e.team === "태화_F" && e.dataYear === dataYear && e.dataMonth === dataMonth
  );

  const wb = XLSX.utils.book_new();
  const yearStr = String(dataYear).slice(2);

  XLSX.utils.book_append_sheet(
    wb,
    buildMonthlySheet(hanseongEmps, annualLeaveMap, anomalyMap, dataYear, dataMonth, true),
    `${yearStr}년_P4한성`
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildMonthlySheet(taehwaEmps, annualLeaveMap, anomalyMap, dataYear, dataMonth, false),
    `${yearStr}년_P4협력사`
  );

  XLSX.writeFile(wb, `P4근태현황_${dataYear}${String(dataMonth).padStart(2, "0")}_${todayStr()}.xlsx`);
}

export function exportLeaveExcel(
  leaveEmployees: LeaveEmployee[],
  leaveDetails: LeaveDetail[]
) {
  // 시트1: 직원별 현황
  const empHeader = ["NO", "성명", "부서", "입사일", "발생연차", "사용일수", "잔여일수"];
  const empRows: (string | number)[][] = [empHeader];
  leaveEmployees.forEach((emp, idx) => {
    empRows.push([
      idx + 1,
      emp.name,
      emp.dept || "-",
      emp.hireDate || "-",
      emp.totalUsed + emp.remaining,
      emp.totalUsed,
      emp.remaining,
    ]);
  });

  const wsEmp = XLSX.utils.aoa_to_sheet(empRows);
  wsEmp["!cols"] = [
    { wch: 4 }, { wch: 8 }, { wch: 10 }, { wch: 14 },
    { wch: 8 }, { wch: 8 }, { wch: 8 },
  ];

  // 시트2: 사용 내역
  const detailHeader = ["날짜", "성명", "사용일수", "사유"];
  const detailRows: (string | number)[][] = [detailHeader];
  leaveDetails.forEach((d) => {
    const month = String(d.month).padStart(2, "0");
    const day = String(d.day).padStart(2, "0");
    detailRows.push([`${d.year}-${month}-${day}`, d.name, d.days, d.reason || "-"]);
  });

  const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
  wsDetail["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsEmp, "직원별현황");
  XLSX.utils.book_append_sheet(wb, wsDetail, "사용내역");
  XLSX.writeFile(wb, `연차관리_${todayStr()}.xlsx`);
}
