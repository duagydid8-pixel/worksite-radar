import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Search, X, Download } from "lucide-react";
import * as XLSX from "xlsx";

interface NewEmployee {
  id: string;
  현장구분: string;
  이름: string;
  주민번호: string;
  연락처: string;
  남여: string;
  입사일: string;
  퇴사일: string;
  신청공종: string;
  단가: string;
  은행명: string;
  계좌번호: string;
  주소: string;
}

function calcAge(jumin: string): string {
  if (!jumin || jumin.replace(/-/g, "").length < 7) return "";
  const raw = jumin.replace(/-/g, "");
  const yy = parseInt(raw.slice(0, 2), 10);
  const mm = parseInt(raw.slice(2, 4), 10);
  const dd = parseInt(raw.slice(4, 6), 10);
  const genderDigit = parseInt(raw[6], 10);
  if (isNaN(yy) || isNaN(mm) || isNaN(dd) || isNaN(genderDigit)) return "";
  const fullYear = genderDigit <= 2 ? 1900 + yy : 2000 + yy;
  const birthDate = new Date(fullYear, mm - 1, dd);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const mDiff = today.getMonth() - birthDate.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < birthDate.getDate())) age--;
  return isNaN(age) || age < 0 || age > 120 ? "" : String(age);
}

function calcTenure(
  입사일: string,
  퇴사일: string
): { days: string; months: string; status: string } {
  if (!입사일) return { days: "", months: "", status: "" };
  const start = new Date(입사일);
  if (isNaN(start.getTime())) return { days: "", months: "", status: "" };
  const end = 퇴사일 ? new Date(퇴사일) : new Date();
  if (isNaN(end.getTime())) return { days: "", months: "", status: "" };
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return { days: "", months: "", status: "" };
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const months = Math.floor(days / 30.4375);
  return {
    days: String(days),
    months: String(months),
    status: 퇴사일 ? "퇴사" : "재직중",
  };
}

const STORAGE_KEY = "worksite_new_employees";

function emptyRow(): NewEmployee {
  return {
    id: crypto.randomUUID(),
    현장구분: "",
    이름: "",
    주민번호: "",
    연락처: "",
    남여: "",
    입사일: "",
    퇴사일: "",
    신청공종: "",
    단가: "",
    은행명: "",
    계좌번호: "",
    주소: "",
  };
}

const TEXT_FIELDS: (keyof NewEmployee)[] = ["현장구분", "이름", "주민번호", "연락처"];
const RIGHT_FIELDS: (keyof NewEmployee)[] = ["신청공종", "단가", "은행명", "계좌번호", "주소"];

export default function NewEmployeeList() {
  const [rows, setRows] = useState<NewEmployee[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : [emptyRow()];
    } catch {
      return [emptyRow()];
    }
  });
  const [search, setSearch] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }, [rows]);

  const displayRows = useMemo(() => {
    if (!search.trim()) return rows;
    return rows.filter((r) => r.이름.includes(search.trim()));
  }, [rows, search]);

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const deleteRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  const updateRow = (id: string, field: keyof NewEmployee, value: string) =>
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );

  const exportToExcel = () => {
    const headers = [
      "No", "현장구분", "이름", "주민번호", "연락처", "연령", "남/여",
      "입사일", "퇴사일", "근속일수", "근속개월", "근속현황",
      "신청공종", "단가", "은행명", "계좌번호", "주소",
    ];
    const dataRows = rows.map((r, i) => {
      const { days, months, status } = calcTenure(r.입사일, r.퇴사일);
      return [
        i + 1, r.현장구분, r.이름, r.주민번호, r.연락처,
        calcAge(r.주민번호), r.남여, r.입사일, r.퇴사일,
        days, months, status,
        r.신청공종, r.단가, r.은행명, r.계좌번호, r.주소,
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = [
      { wch: 4 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 14 },
      { wch: 5 }, { wch: 5 }, { wch: 11 }, { wch: 11 },
      { wch: 8 }, { wch: 8 }, { wch: 8 },
      { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 32 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "신규자명단");
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `신규자명단_${dateStr}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-foreground flex-1">신규자 명단</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 검색..."
            className="pl-9 pr-9 py-2 text-sm border border-border rounded-lg bg-white outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-44"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          행 추가
        </button>
        <button
          onClick={exportToExcel}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
          엑셀 내보내기
        </button>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              {[
                "No", "현장구분", "이름", "주민번호", "연락처",
                "연령", "남/여", "입사일", "퇴사일",
                "근속일수", "근속개월", "근속현황",
                "신청공종", "단가", "은행명", "계좌번호", "주소", "",
              ].map((col, i) => (
                <th
                  key={i}
                  className="px-2 py-2.5 text-center font-semibold text-muted-foreground whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={18} className="py-16 text-center text-muted-foreground text-sm">
                  {search
                    ? `"${search}"에 해당하는 직원이 없습니다`
                    : "데이터가 없습니다. 행 추가 버튼을 눌러 입력하세요."}
                </td>
              </tr>
            ) : (
              displayRows.map((row, idx) => {
                const { days, months, status } = calcTenure(row.입사일, row.퇴사일);
                const age = calcAge(row.주민번호);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    {/* No */}
                    <td className="px-3 py-1.5 text-center text-muted-foreground font-medium w-8">
                      {idx + 1}
                    </td>

                    {/* 현장구분, 이름, 주민번호, 연락처 */}
                    {TEXT_FIELDS.map((field) => (
                      <td key={field} className="px-1 py-1">
                        <input
                          type="text"
                          value={row[field] as string}
                          onChange={(e) => updateRow(row.id, field, e.target.value)}
                          placeholder={field as string}
                          className={`px-2 py-1 border border-transparent hover:border-border focus:border-primary rounded bg-transparent focus:bg-white outline-none transition-colors text-xs ${
                            field === "주민번호" ? "min-w-[112px]" :
                            field === "연락처" ? "min-w-[100px]" :
                            field === "현장구분" ? "min-w-[72px]" : "min-w-[64px]"
                          }`}
                        />
                      </td>
                    ))}

                    {/* 연령 (자동계산) */}
                    <td className="px-2 py-1.5 text-center text-muted-foreground w-10">{age}</td>

                    {/* 남/여 */}
                    <td className="px-1 py-1">
                      <select
                        value={row.남여}
                        onChange={(e) => updateRow(row.id, "남여", e.target.value)}
                        className="px-1 py-1 w-14 border border-transparent hover:border-border focus:border-primary rounded bg-transparent focus:bg-white outline-none cursor-pointer text-xs"
                      >
                        <option value="">-</option>
                        <option value="남">남</option>
                        <option value="여">여</option>
                      </select>
                    </td>

                    {/* 입사일 */}
                    <td className="px-1 py-1">
                      <input
                        type="date"
                        value={row.입사일}
                        onChange={(e) => updateRow(row.id, "입사일", e.target.value)}
                        className="min-w-[110px] px-2 py-1 border border-transparent hover:border-border focus:border-primary rounded bg-transparent focus:bg-white outline-none text-xs"
                      />
                    </td>

                    {/* 퇴사일 */}
                    <td className="px-1 py-1">
                      <input
                        type="date"
                        value={row.퇴사일}
                        onChange={(e) => updateRow(row.id, "퇴사일", e.target.value)}
                        className="min-w-[110px] px-2 py-1 border border-transparent hover:border-border focus:border-primary rounded bg-transparent focus:bg-white outline-none text-xs"
                      />
                    </td>

                    {/* 근속일수 (자동계산) */}
                    <td className="px-2 py-1.5 text-center text-muted-foreground w-14">
                      {days ? `${days}일` : ""}
                    </td>

                    {/* 근속개월 (자동계산) */}
                    <td className="px-2 py-1.5 text-center text-muted-foreground w-14">
                      {months ? `${months}개월` : ""}
                    </td>

                    {/* 근속현황 (자동계산) */}
                    <td className="px-2 py-1.5 text-center">
                      {status && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            status === "재직중"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {status}
                        </span>
                      )}
                    </td>

                    {/* 신청공종, 단가, 은행명, 계좌번호, 주소 */}
                    {RIGHT_FIELDS.map((field) => (
                      <td key={field} className="px-1 py-1">
                        <input
                          type="text"
                          value={row[field] as string}
                          onChange={(e) => updateRow(row.id, field, e.target.value)}
                          placeholder={field as string}
                          className={`px-2 py-1 border border-transparent hover:border-border focus:border-primary rounded bg-transparent focus:bg-white outline-none transition-colors text-xs ${
                            field === "주소" ? "min-w-[160px]" : "min-w-[72px]"
                          }`}
                        />
                      </td>
                    ))}

                    {/* 삭제 */}
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => deleteRow(row.id)}
                        title="행 삭제"
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        총 {rows.length}명 · 연령 / 근속일수 / 근속개월 / 근속현황은 자동 계산됩니다
      </p>
    </div>
  );
}
