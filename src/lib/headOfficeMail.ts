export type CertificateType = "재직증명서" | "경력증명서" | "원천징수영수증" | "기타";

export interface SelectOption {
  label: string;
  value: string;
}

export interface CertificateRequestRow {
  no: number;
  name: string;
  residentNo: string;
  address: string;
  siteName: string;
  joinDate: string;
  note: string;
  found: boolean;
}

export const CERTIFICATE_OPTIONS: SelectOption[] = [
  { label: "재직증명서", value: "재직증명서" },
  { label: "경력증명서", value: "경력증명서" },
  { label: "원천징수영수증", value: "원천징수영수증" },
  { label: "기타", value: "기타" },
];

export const SITE_OPTIONS: SelectOption[] = [
  { label: "P4-PH4", value: "사업팀[삼성전자 평택 P4-PH4 초순수 현장]" },
  { label: "P4-PH2", value: "사업팀[삼성전자 평택 P4-PH2 초순수 현장]" },
  { label: "P5-PH1", value: "사업팀[삼성전자 평택 P5-PH1 초순수 현장]" },
];

const EMPTY_EMPLOYEE_VALUE = "";

function readEmployeeField(employee: unknown, field: string): string {
  if (!employee || typeof employee !== "object") return EMPTY_EMPLOYEE_VALUE;
  const value = (employee as Record<string, unknown>)[field];
  if (value === null || value === undefined) return EMPTY_EMPLOYEE_VALUE;
  return String(value).trim();
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

export function splitNames(input: string): string[] {
  return input
    .split(/[\s,，;；/]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function formatDateDots(date: string): string {
  const trimmed = date.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}.${iso[2]}.${iso[3]}`;
  const loose = trimmed.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
  if (loose) {
    return `${loose[1]}.${loose[2].padStart(2, "0")}.${loose[3].padStart(2, "0")}`;
  }
  return trimmed;
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function resolveCertificateName(type: string, customName: string): string {
  if (type === "기타") return customName.trim();
  return type.trim();
}

export function createMailSubject(certificateName: string, requestDate: string): string {
  const name = certificateName.trim() || "증명서";
  return `평택 P4 초순수 ${name}요청의 件_${formatDateDots(requestDate)}`;
}

export function getRequestSitePhrase(siteName: string): string {
  const matched = SITE_OPTIONS.find((option) => option.value === siteName);
  if (matched) return `평택 ${matched.label} 초순수 현장`;

  const bracketValue = siteName.match(/\[삼성전자\s*(.+)\]/);
  if (bracketValue?.[1]) return bracketValue[1].trim();

  return siteName.trim();
}

export function createMailBody(certificateName: string, siteName: string): string {
  const name = certificateName.trim() || "증명서";
  const sitePhrase = getRequestSitePhrase(siteName);

  return [
    "안녕하세요. 사업1본부 초순수파트 염효양 사원입니다.",
    "",
    "업무에 노고가 많으십니다.",
    "",
    `${sitePhrase} ${name} 요청드립니다.`,
  ].join("\n");
}

export function buildCertificateRows(
  names: string[],
  employees: unknown[],
  siteName: string,
): { rows: CertificateRequestRow[]; missingNames: string[] } {
  const employeeByName = new Map<string, unknown>();
  for (const employee of employees) {
    const employeeName = readEmployeeField(employee, "이름");
    if (!employeeName) continue;
    const key = normalizeName(employeeName);
    if (!employeeByName.has(key)) employeeByName.set(key, employee);
  }

  const missingNames: string[] = [];
  const rows = names.map((typedName, index) => {
    const employee = employeeByName.get(normalizeName(typedName));
    const found = Boolean(employee);
    if (!found) missingNames.push(typedName);

    return {
      no: index + 1,
      name: found ? readEmployeeField(employee, "이름") : typedName,
      residentNo: found ? readEmployeeField(employee, "주민번호") : "",
      address: found ? readEmployeeField(employee, "주소") : "",
      siteName,
      joinDate: found ? formatDateDots(readEmployeeField(employee, "입사일")) : "",
      note: "",
      found,
    };
  });

  return { rows, missingNames };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function createCertificateTableText(certificateName: string, rows: CertificateRequestRow[]): string {
  const header = ["NO.", "성명", "주민번호", "주소", "현장명", "입사일", "비고"].join("\t");
  const body = rows.map((row) => [
    String(row.no),
    row.name,
    row.residentNo,
    row.address,
    row.siteName,
    row.joinDate,
    row.note,
  ].join("\t"));

  return [certificateName, "", header, ...body].join("\n");
}

export function createCertificateTableHtml(certificateName: string, rows: CertificateRequestRow[]): string {
  const cellStyle = "border:1px solid #000;padding:8px 10px;text-align:center;font-size:13px;";
  const headerStyle = `${cellStyle}background:#d9e2f3;font-weight:700;`;
  const addressStyle = "border:1px solid #000;padding:8px 10px;text-align:center;font-size:13px;min-width:260px;";
  const siteStyle = "border:1px solid #000;padding:8px 10px;text-align:center;font-size:13px;min-width:260px;";

  const body = rows.map((row) => `
    <tr>
      <td style="${cellStyle}">${row.no}</td>
      <td style="${cellStyle}">${escapeHtml(row.name)}</td>
      <td style="${cellStyle}">${escapeHtml(row.residentNo)}</td>
      <td style="${addressStyle}">${escapeHtml(row.address)}</td>
      <td style="${siteStyle}">${escapeHtml(row.siteName)}</td>
      <td style="${cellStyle}">${escapeHtml(row.joinDate)}</td>
      <td style="${cellStyle}">${escapeHtml(row.note)}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family:Arial,'Malgun Gothic',sans-serif;">
      <p style="margin:0 0 10px 0;font-size:18px;font-weight:700;"><strong>${escapeHtml(certificateName)}</strong></p>
      <table style="border-collapse:collapse;">
        <thead>
          <tr>
            <th style="${headerStyle}">NO.</th>
            <th style="${headerStyle}">성명</th>
            <th style="${headerStyle}">주민번호</th>
            <th style="${headerStyle}">주소</th>
            <th style="${headerStyle}">현장명</th>
            <th style="${headerStyle}">입사일</th>
            <th style="${headerStyle}">비고</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}
