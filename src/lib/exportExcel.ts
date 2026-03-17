import * as XLSX from "xlsx";
import type { Employee, LeaveEmployee, LeaveDetail } from "./parseExcel";

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
