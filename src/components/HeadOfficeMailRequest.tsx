import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Clipboard, Loader2, Mail, Search, UserX } from "lucide-react";
import { toast } from "sonner";
import { loadEmployeesP5PH1FS, loadEmployeesPH2FS, loadEmployeesPH4FS } from "@/lib/firestoreService";
import {
  buildCertificateRows,
  CERTIFICATE_OPTIONS,
  createExtraWorkMailBody,
  createExtraWorkMailSubject,
  createCertificateTableHtml,
  createCertificateTableText,
  createMailBody,
  createMailSubject,
  createOrgChartMailBody,
  createOrgChartMailSubject,
  MAIL_REQUEST_MENU_OPTIONS,
  previousMonthISO,
  resolveCertificateName,
  SITE_OPTIONS,
  splitNames,
  todayISO,
  type CertificateType,
  type MailRequestMenu,
} from "@/lib/headOfficeMail";

type EmployeeSite = "PH4" | "PH2" | "P5PH1";

const DATA_SOURCE_OPTIONS: { label: string; value: EmployeeSite }[] = [
  { label: "P4-PH4 명단", value: "PH4" },
  { label: "P4-PH2 명단", value: "PH2" },
  { label: "P5-PH1 명단", value: "P5PH1" },
];

function employeeName(employee: unknown): string {
  if (!employee || typeof employee !== "object") return "";
  const value = (employee as Record<string, unknown>)["이름"];
  return value === null || value === undefined ? "" : String(value).trim();
}

function PreparingPanel({ title }: { title: string }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <Mail className="mx-auto h-8 w-8 text-slate-300" />
      <h3 className="mt-3 text-base font-extrabold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm font-semibold text-slate-400">
        메일 양식이 정해지면 이 메뉴에 자동 작성 도구를 추가할 수 있습니다.
      </p>
    </section>
  );
}

async function copyRichTable(html: string, text: string) {
  const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (navigator.clipboard?.write && ClipboardItemCtor) {
    const item = new ClipboardItemCtor({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
    return;
  }

  await navigator.clipboard.writeText(text);
}

interface HeadOfficeMailRequestProps {
  activeMenu?: MailRequestMenu;
  onMenuChange?: (menu: MailRequestMenu) => void;
}

export default function HeadOfficeMailRequest({ activeMenu: controlledActiveMenu, onMenuChange }: HeadOfficeMailRequestProps) {
  const [dataSource, setDataSource] = useState<EmployeeSite>("PH4");
  const [employees, setEmployees] = useState<unknown[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [certificateType, setCertificateType] = useState<CertificateType>("재직증명서");
  const [customCertificateName, setCustomCertificateName] = useState("");
  const [siteName, setSiteName] = useState(SITE_OPTIONS[0].value);
  const [orgChartSiteName, setOrgChartSiteName] = useState(SITE_OPTIONS[0].value);
  const [extraWorkSiteName, setExtraWorkSiteName] = useState(SITE_OPTIONS[0].value);
  const [extraWorkMonth, setExtraWorkMonth] = useState(previousMonthISO());
  const [requestDate, setRequestDate] = useState(todayISO());
  const [nameInput, setNameInput] = useState("");
  const [internalActiveMenu, setInternalActiveMenu] = useState<MailRequestMenu>("certificate");
  const activeMenu = controlledActiveMenu ?? internalActiveMenu;
  const showInternalMenu = controlledActiveMenu === undefined;

  const handleMenuChange = (menu: MailRequestMenu) => {
    if (onMenuChange) onMenuChange(menu);
    else setInternalActiveMenu(menu);
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const loadFn = dataSource === "P5PH1" ? loadEmployeesP5PH1FS : dataSource === "PH2" ? loadEmployeesPH2FS : loadEmployeesPH4FS;

    loadFn().then((rows) => {
      if (cancelled) return;
      setEmployees(Array.isArray(rows) ? rows : []);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [dataSource]);

  const certificateName = useMemo(
    () => resolveCertificateName(certificateType, customCertificateName) || "증명서",
    [certificateType, customCertificateName],
  );

  const names = useMemo(() => splitNames(nameInput), [nameInput]);
  const { rows, missingNames } = useMemo(
    () => buildCertificateRows(names, employees, siteName),
    [names, employees, siteName],
  );

  const mailSubject = useMemo(
    () => createMailSubject(certificateName, requestDate, siteName),
    [certificateName, requestDate, siteName],
  );

  const mailBody = useMemo(
    () => createMailBody(certificateName, siteName),
    [certificateName, siteName],
  );

  const tableText = useMemo(
    () => createCertificateTableText(certificateName, rows),
    [certificateName, rows],
  );

  const tableHtml = useMemo(
    () => createCertificateTableHtml(certificateName, rows),
    [certificateName, rows],
  );
  const orgChartMailSubject = useMemo(
    () => createOrgChartMailSubject(requestDate, orgChartSiteName),
    [requestDate, orgChartSiteName],
  );
  const orgChartMailBody = useMemo(
    () => createOrgChartMailBody(requestDate, orgChartSiteName),
    [requestDate, orgChartSiteName],
  );
  const extraWorkMailSubject = useMemo(
    () => createExtraWorkMailSubject(requestDate, extraWorkMonth, extraWorkSiteName),
    [requestDate, extraWorkMonth, extraWorkSiteName],
  );
  const extraWorkMailBody = useMemo(
    () => createExtraWorkMailBody(extraWorkMonth, extraWorkSiteName),
    [extraWorkMonth, extraWorkSiteName],
  );

  const employeeCount = employees.filter((employee) => employeeName(employee)).length;
  const activeMenuLabel = MAIL_REQUEST_MENU_OPTIONS.find((option) => option.value === activeMenu)?.label ?? "증명서";

  const handleCopySubject = async () => {
    await navigator.clipboard.writeText(mailSubject);
    toast.success("메일 제목을 복사했습니다.");
  };

  const handleCopyBody = async () => {
    await navigator.clipboard.writeText(mailBody);
    toast.success("메일 본문을 복사했습니다.");
  };

  const handleCopyTable = async () => {
    if (rows.length === 0) {
      toast.error("먼저 이름을 입력하세요.");
      return;
    }
    try {
      await copyRichTable(tableHtml, tableText);
      toast.success("증명서 요청 표를 복사했습니다.");
    } catch {
      toast.error("표 복사 중 오류가 발생했습니다.");
    }
  };

  const handleCopyOrgChartSubject = async () => {
    await navigator.clipboard.writeText(orgChartMailSubject);
    toast.success("조직도 송부메일 제목을 복사했습니다.");
  };

  const handleCopyOrgChartBody = async () => {
    await navigator.clipboard.writeText(orgChartMailBody);
    toast.success("조직도 송부메일 본문을 복사했습니다.");
  };

  const handleCopyExtraWorkSubject = async () => {
    await navigator.clipboard.writeText(extraWorkMailSubject);
    toast.success("가산공수 메일 제목을 복사했습니다.");
  };

  const handleCopyExtraWorkBody = async () => {
    await navigator.clipboard.writeText(extraWorkMailBody);
    toast.success("가산공수 메일 본문을 복사했습니다.");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="mr-auto">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-extrabold text-slate-950">본사 메일송부</h2>
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-400">
              이름을 입력하면 기술인명단에서 증명서 요청 표를 자동 생성합니다.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-bold text-slate-400">불러온 명단</p>
            <p className="text-lg font-extrabold text-slate-950 tabular-nums">
              {isLoading ? "..." : employeeCount}
              <span className="ml-0.5 text-xs font-semibold text-slate-400">명</span>
            </p>
          </div>
        </div>
      </div>

      {showInternalMenu && (
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-3 gap-1">
          {MAIL_REQUEST_MENU_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => handleMenuChange(option.value)}
              className={`h-10 rounded-lg text-sm font-extrabold transition-colors ${
                activeMenu === option.value
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {activeMenu === "certificate" ? (
      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">명단 선택</label>
              <select
                value={dataSource}
                onChange={(e) => setDataSource(e.target.value as EmployeeSite)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
              >
                {DATA_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">요청일</label>
              <input
                type="date"
                value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">증명서 종류</label>
            <select
              value={certificateType}
              onChange={(e) => setCertificateType(e.target.value as CertificateType)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
            >
              {CERTIFICATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {certificateType === "기타" && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">기타 증명서명</label>
              <input
                type="text"
                value={customCertificateName}
                onChange={(e) => setCustomCertificateName(e.target.value)}
                placeholder="예: 급여명세서"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300 focus:border-slate-400"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">현장명</label>
            <select
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
            >
              {SITE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.value}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">이름 입력</label>
            <textarea
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="예: 조성진&#10;김철수"
              rows={7}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-300 focus:border-slate-400"
            />
            <p className="mt-1 text-xs font-semibold text-slate-400">줄바꿈, 쉼표, 띄어쓰기로 여러 명을 입력할 수 있습니다.</p>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              onClick={handleCopySubject}
              className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-extrabold text-slate-800 transition-colors hover:bg-slate-50"
            >
              <Clipboard className="h-4 w-4 text-slate-400" />
              제목 복사
            </button>
            <button
              onClick={handleCopyBody}
              className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-extrabold text-slate-800 transition-colors hover:bg-slate-50"
            >
              <Clipboard className="h-4 w-4 text-slate-400" />
              본문 복사
            </button>
            <button
              onClick={handleCopyTable}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 text-sm font-extrabold text-white transition-colors hover:bg-slate-700"
            >
              <Clipboard className="h-4 w-4" />
              표 복사
            </button>
          </div>

          {isLoading && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              명단을 불러오는 중입니다.
            </div>
          )}

          {!isLoading && employeeCount === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              <UserX className="h-4 w-4" />
              선택한 명단에 저장된 데이터가 없습니다.
            </div>
          )}

          {missingNames.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-extrabold text-amber-900">명단에서 찾지 못한 이름</p>
              <p className="mt-1 text-xs font-bold text-amber-700">{missingNames.join(", ")}</p>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <p className="mb-1 text-xs font-bold text-slate-500">메일 제목</p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-extrabold text-slate-950">
              {mailSubject}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-slate-500">메일 본문</p>
            <div className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold leading-7 text-slate-900">
              {mailBody}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-slate-400" />
            <p className="text-xs font-bold text-slate-500">표 미리보기</p>
            {rows.length > 0 && missingNames.length === 0 && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-extrabold text-emerald-700">
                <CheckCircle className="h-3 w-3" />
                전체 매칭
              </span>
            )}
          </div>

          <div className="overflow-auto rounded-lg border border-slate-200 bg-white p-4">
            <div className="min-w-[920px]">
              <p className="mb-3 text-lg font-extrabold text-slate-950">{certificateName}</p>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[#d9e2f3]">
                    {["NO.", "성명", "주민번호", "주소", "현장명", "입사일", "비고"].map((header) => (
                      <th key={header} className="border border-black px-3 py-2 text-center font-extrabold text-slate-950">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="border border-black px-3 py-8 text-center font-bold text-slate-400">
                        이름을 입력하면 표가 생성됩니다.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={`${row.no}-${row.name}`} className={row.found ? "bg-white" : "bg-amber-50"}>
                        <td className="border border-black px-3 py-2 text-center tabular-nums">{row.no}</td>
                        <td className="border border-black px-3 py-2 text-center font-bold">{row.name}</td>
                        <td className="border border-black px-3 py-2 text-center tabular-nums">{row.residentNo}</td>
                        <td className="border border-black px-3 py-2 text-center">{row.address}</td>
                        <td className="border border-black px-3 py-2 text-center">{row.siteName}</td>
                        <td className="border border-black px-3 py-2 text-center tabular-nums">{row.joinDate}</td>
                        <td className="border border-black px-3 py-2 text-center">{row.note}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
      ) : activeMenu === "orgChart" ? (
        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">프로젝트</label>
              <select
                value={orgChartSiteName}
                onChange={(e) => setOrgChartSiteName(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
              >
                {SITE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">송부일</label>
              <input
                type="date"
                value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleCopyOrgChartSubject}
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-extrabold text-slate-800 transition-colors hover:bg-slate-50"
              >
                <Clipboard className="h-4 w-4 text-slate-400" />
                제목 복사
              </button>
              <button
                onClick={handleCopyOrgChartBody}
                className="flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 text-sm font-extrabold text-white transition-colors hover:bg-slate-700"
              >
                <Clipboard className="h-4 w-4" />
                본문 복사
              </button>
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold leading-5 text-blue-700">
              첨부파일은 `조직도 송부` 메뉴에서 PPT 다운로드한 파일을 첨부하면 됩니다.
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <p className="mb-1 text-xs font-bold text-slate-500">메일 제목</p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-extrabold text-slate-950">
                {orgChartMailSubject}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-bold text-slate-500">메일 본문</p>
              <div className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold leading-7 text-slate-900">
                {orgChartMailBody}
              </div>
            </div>
          </section>
        </div>
      ) : activeMenu === "extraWork" ? (
        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">프로젝트</label>
              <select
                value={extraWorkSiteName}
                onChange={(e) => setExtraWorkSiteName(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
              >
                {SITE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">대상월</label>
              <input
                type="month"
                value={extraWorkMonth}
                onChange={(e) => setExtraWorkMonth(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">송부일</label>
              <input
                type="date"
                value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleCopyExtraWorkSubject}
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-extrabold text-slate-800 transition-colors hover:bg-slate-50"
              >
                <Clipboard className="h-4 w-4 text-slate-400" />
                제목 복사
              </button>
              <button
                onClick={handleCopyExtraWorkBody}
                className="flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 text-sm font-extrabold text-white transition-colors hover:bg-slate-700"
              >
                <Clipboard className="h-4 w-4" />
                본문 복사
              </button>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <p className="mb-1 text-xs font-bold text-slate-500">메일 제목</p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-extrabold text-slate-950">
                {extraWorkMailSubject}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-bold text-slate-500">메일 본문</p>
              <div className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold leading-7 text-slate-900">
                {extraWorkMailBody}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <PreparingPanel title={activeMenuLabel} />
      )}
    </div>
  );
}
