import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.join(ROOT, "config", "electronic-card-sync.local");
const DEFAULT_PROFILE_DIR = path.join(ROOT, ".superpowers", "eum-browser-profile");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "outputs", "electronic-card-sync");
const EUM_HOME_URL = "https://eum.cw.or.kr/";
const EUM_CARD_URL = "https://eum.cw.or.kr/web/dec/WEBDEC060M00";
const EUM_API_URL = "https://eum.cw.or.kr/api/selectListElcdUseDsctn";
const FIRESTORE_COLLECTION = "worksite_data";

function usage() {
  console.log(`Electronic-card sync

Usage:
  npm run elcd:config
  npm run elcd:sync
  npm run elcd:sync -- --dry-run

Options:
  --config <path>       Config file path. Default: config/electronic-card-sync.local
  --profile <path>      Playwright browser profile path. Default: .superpowers/eum-browser-profile
  --output <path>       Output directory. Default: outputs/electronic-card-sync
  --site <site>         Firestore site key. Default: PH4
  --url <url>           Initial EUM URL. Default: https://eum.cw.or.kr/
  --timeout <ms>        Config polling timeout. Default: 180000
  --dry-run             Fetch and write output files, but skip Firestore writes.
  --help                Print this help.

Config flow:
  1. A visible browser opens.
  2. Log in to eum.cw.or.kr if needed.
  3. Open 전자카드사용내역 and choose 현장 plus both 소속 업체명 values.
  4. Leave that page open. The script reads selected values and saves config.
`);
}

function parseArgs(argv) {
  const args = { command: argv[0] || "sync" };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--config") args.config = argv[++i];
    else if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--site") args.site = argv[++i];
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--timeout") args.timeout = Number(argv[++i]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

function p2(value) {
  return String(value).padStart(2, "0");
}

function currentMonthRange(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const startDate = `${year}-${p2(month)}-01`;
  const endDate = `${year}-${p2(month)}-${p2(day)}`;
  return {
    startDate,
    endDate,
    startYmd: startDate.replace(/-/g, ""),
    endYmd: endDate.replace(/-/g, ""),
  };
}

function text(value) {
  return String(value ?? "").trim();
}

function isMeaningfulCode(value) {
  const raw = text(value);
  return Boolean(raw && raw !== "on" && raw !== "[object Object]");
}

function normalizeDate(value) {
  const digits = text(value).replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function normalizeTime(value) {
  const match = text(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${p2(Number(match[1]))}:${match[2]}`;
}

function normalizeBirth(value) {
  const digits = text(value).replace(/\D/g, "");
  if (digits.length >= 13) return digits.slice(0, 6);
  if (digits.length >= 8) return digits.slice(2, 8);
  return digits.slice(0, 6);
}

function firstText(row, keys) {
  for (const key of keys) {
    const value = text(row?.[key]);
    if (value) return value;
  }
  return "";
}

function normalizeApiRows(rows) {
  return rows.flatMap((row) => {
    const name = firstText(row, ["custNm", "wkrNm", "nm", "workerNm", "name"]);
    const date = normalizeDate(firstText(row, ["tagYmd", "lbrYmd", "wkYmd", "workYmd", "useYmd"]))
      || normalizeDate(firstText(row, ["gtwkDt", "workStrTm", "inTm", "strTm"]))
      || normalizeDate(firstText(row, ["lvwkDt", "workEndTm", "outTm", "endTm"]));
    if (!name || !date) return [];
    return [{
      name,
      birthDate: normalizeBirth(firstText(row, ["birthday", "brdt", "birthYmd", "rrno", "rrn"])),
      company: firstText(row, ["conm", "company", "osrccNm", "entrpsNm"]),
      date,
      inTime: normalizeTime(firstText(row, ["gtwkDt", "workStrTm", "inTm", "strTm", "inTime"])),
      outTime: normalizeTime(firstText(row, ["lvwkDt", "workEndTm", "outTm", "endTm", "outTime"])),
      authMethod: firstText(row, ["tagNm", "authMtdNm", "tagMtdNm", "tagMtdCd", "tagSeNm", "inOutNm"]),
    }];
  });
}

function groupByDate(rows) {
  const byDate = new Map();
  for (const row of rows) {
    const people = byDate.get(row.date) ?? new Map();
    const key = `${row.name.replace(/\s+/g, "")}|${normalizeBirth(row.birthDate)}`;
    const current = people.get(key);
    people.set(key, {
      name: current?.name || row.name,
      birthDate: current?.birthDate || normalizeBirth(row.birthDate),
      inTime: current?.inTime || row.inTime || "",
      outTime: current?.outTime || row.outTime || "",
      authMethod: current?.authMethod || row.authMethod || "",
      company: current?.company || row.company || "",
    });
    byDate.set(row.date, people);
  }
  return Object.fromEntries([...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dateLabel, people]) => [
    dateLabel,
    {
      dateLabel,
      persons: [...people.values()].sort((a, b) => (a.inTime || "99:99").localeCompare(b.inTime || "99:99") || a.name.localeCompare(b.name)),
    },
  ]));
}

async function ensureParent(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await ensureParent(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function selectedConfigFromDom() {
  function visibleText(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }
  function labelForInput(input) {
    const id = input.id;
    const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const wrapping = input.closest("label");
    const row = input.closest("li, tr, div");
    return visibleText(explicit) || visibleText(wrapping) || visibleText(row);
  }
  const fields = [...document.querySelectorAll("input, select, textarea")].map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type") || "",
    name: el.getAttribute("name") || "",
    id: el.id || "",
    value: el.value || "",
    checked: Boolean(el.checked),
    selectedText: el.tagName === "SELECT" ? visibleText(el.selectedOptions?.[0]) : "",
  }));
  const siteSelect = fields.find((field) =>
    field.tag === "select" && (
      /grnds|site|현장|pjt|prj/i.test(`${field.name} ${field.id}`)
      || /\[\d{2}-\d+/.test(field.selectedText)
      || /P\d|Ph/i.test(field.selectedText)
    )
  );
  const grndsField = fields.find((field) => /grndsCd/i.test(`${field.name} ${field.id}`) && field.value);
  const checkedCompanies = [...document.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => ({
      label: labelForInput(input).replace(/\s+/g, " ").trim(),
      value: input.value || "",
      name: input.getAttribute("name") || "",
      id: input.id || "",
    }))
    .filter((item) => item.value && !/전체|대상|비대상|내국인|외국인|전자카드|지문|GPS|NFC|블루투스/.test(item.label));
  const osrccField = fields.find((field) => /osrcc/i.test(`${field.name} ${field.id}`) && field.value);
  const osrccSnStr = osrccField?.value || checkedCompanies.map((item) => item.value).join(",");
  const companyLabels = checkedCompanies.map((item) => item.label).filter(Boolean);
  const companyValues = checkedCompanies.map((item) => item.value).filter(Boolean);
  return {
    url: location.href,
    siteLabel: siteSelect?.selectedText || "",
    grndsCd: grndsField?.value || siteSelect?.value || "",
    companies: companyLabels.map((label, index) => ({ label, value: companyValues[index] || "" })),
    osrccSnStr,
    diagnostics: {
      selectCount: document.querySelectorAll("select").length,
      checkedCompanyCount: checkedCompanies.length,
      osrccFieldFound: Boolean(osrccField),
      grndsFieldFound: Boolean(grndsField),
    },
  };
}

async function readEumControlData(page) {
  return page.evaluate(async ({ apiUrl }) => {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ prcsSeCd: "C1", userGrdSeCd: "", bldrYn: "Y", recordCount: 500, pageNo: 1 }),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) throw new Error(`EUM C1 API ${response.status}`);
    if (!contentType.includes("json")) throw new Error("EUM login session is not returning JSON.");
    const data = await response.json();
    const inner = data._data_ || {};
    return {
      sites: Array.isArray(inner.rdGrndsNmOutBVOList) ? inner.rdGrndsNmOutBVOList : [],
      companies: Array.isArray(inner.rdConmListOutBVOList) ? inner.rdConmListOutBVOList : [],
    };
  }, { apiUrl: EUM_API_URL });
}

function labelsMatch(a, b) {
  const left = text(a).replace(/\s+/g, "");
  const right = text(b).replace(/\s+/g, "");
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function pickSite(sites, domConfig, existingConfig) {
  if (!Array.isArray(sites) || sites.length === 0) return null;
  const configuredCode = isMeaningfulCode(existingConfig?.grndsCd) ? text(existingConfig.grndsCd) : "";
  const configuredMargNo = isMeaningfulCode(existingConfig?.margNo) ? text(existingConfig.margNo) : "";
  return sites.find((site) =>
    (!configuredCode || text(site.grndsCd) === configuredCode)
    && (!configuredMargNo || text(site.margNo) === configuredMargNo)
  )
    || sites.find((site) => labelsMatch(site.grndsNm, existingConfig?.siteLabel))
    || sites.find((site) => labelsMatch(site.grndsNm, domConfig?.siteLabel))
    || sites[0];
}

function normalizeCompanies(companies) {
  if (!Array.isArray(companies)) return [];
  return companies.flatMap((company) => {
    const label = text(company.conm || company.ogdpConm || company.osrccNm || company.entrpsNm || company.grndsNm);
    const value = text(company.osrccSn || company.osrccSnStr || company.value);
    if (!label && !value) return [];
    return [{ label, value }];
  });
}

async function resolveConfigFromPage(page, existingConfig = {}) {
  const domConfig = await page.evaluate(selectedConfigFromDom).catch(() => ({}));
  const controlData = await readEumControlData(page);
  const site = pickSite(controlData.sites, domConfig, existingConfig);
  if (!site?.grndsCd || !site?.margNo) {
    throw new Error("Could not resolve EUM site codes from the logged-in session.");
  }
  const osrccSnStr = isMeaningfulCode(existingConfig.osrccSnStr) ? text(existingConfig.osrccSnStr) : "";
  return {
    ...existingConfig,
    siteLabel: text(site.grndsNm) || text(domConfig.siteLabel),
    grndsCd: text(site.grndsCd),
    margNo: text(site.margNo),
    grndsCdObj: site,
    companies: normalizeCompanies(controlData.companies),
    osrccSnStr,
    sourceUrl: page.url(),
  };
}

async function openContext(profileDir, initialUrl, { headless = false } = {}) {
  await mkdir(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless,
    viewport: { width: 1440, height: 950 },
  }).catch(() => chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1440, height: 950 },
  }));
  const page = context.pages()[0] ?? await context.newPage();
  if (!page.url() || page.url() === "about:blank") {
    await page.goto(initialUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  return { context, page };
}

async function findSelectedConfig(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (!page.url().includes("eum.cw.or.kr")) continue;
      const config = await resolveConfigFromPage(page).catch(() => null);
      if (config?.grndsCd && config?.margNo) {
        return config;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("현장/소속 업체 선택값을 읽지 못했습니다. 전자카드사용내역 화면에서 현장과 업체 2개를 선택한 상태로 다시 실행하세요.");
}

async function commandConfig(args) {
  const configPath = path.resolve(args.config || DEFAULT_CONFIG_PATH);
  const profileDir = path.resolve(args.profile || DEFAULT_PROFILE_DIR);
  const timeoutMs = Number(args.timeout || 180000);
  const { context } = await openContext(profileDir, args.url || EUM_CARD_URL);
  console.log("[elcd] 브라우저가 열렸습니다. EUM 로그인 후 전자카드사용내역 화면에서 현장과 업체 2개를 선택해두세요.");
  const selected = await findSelectedConfig(context, timeoutMs);
  const config = {
    site: args.site || "PH4",
    siteLabel: selected.siteLabel,
    grndsCd: selected.grndsCd,
    margNo: selected.margNo,
    grndsCdObj: selected.grndsCdObj,
    companies: selected.companies,
    osrccSnStr: selected.osrccSnStr,
    sourceUrl: selected.sourceUrl,
    savedAt: new Date().toISOString(),
  };
  await writeJson(configPath, config);
  await context.close();
  console.log(`[elcd] 설정 저장: ${configPath}`);
  console.log(`[elcd] 현장: ${config.siteLabel}`);
  console.log(`[elcd] 업체: ${config.companies.map((item) => item.label).join(" / ")}`);
}

async function fetchRows(page, config, range) {
  return page.evaluate(async ({ apiUrl, config, range }) => {
    const collected = [];
    let pageNo = 1;
    const recordCount = 500;
    let totalCount = Infinity;
    const margNo = config.margNo || config.grndsCdObj?.margNo || "";
    const siteObject = config.grndsCdObj || { grndsCd: config.grndsCd, margNo };
    while (collected.length < totalCount) {
      const body = {
        lbrYmdBgng: range.startYmd,
        lbrYmdEnd: range.endYmd,
        lbrYm: "",
        grndsCd: config.grndsCd,
        conm: "",
        margNo,
        autoTot: 1,
        birthday: "",
        bldrYn: "Y",
        cardIssuHstryYn: "",
        custNm: "",
        ctpcTelno: "",
        directYn: null,
        frstWdaMh: "",
        grndsCdObj: siteObject,
        noNameYn: "N",
        ntnCd: "",
        ocptSeCd: "",
        osrccSnStr: config.osrccSnStr || "",
        pageNo,
        pastFlag: "N",
        prcsSeCd: "R1",
        recordCount,
        rrno: "",
        tagCd: "",
        targetListBtnId: "",
        trmnlNo: "",
      };
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) throw new Error(`EUM API ${response.status}`);
      if (!contentType.includes("json")) throw new Error("EUM 로그인 세션이 만료되었거나 JSON 응답이 아닙니다.");
      const data = await response.json();
      const inner = data._data_ || {};
      const list = inner.rdUxElcdUseDsctnOutBVOList || data.list || data.data || [];
      if (pageNo === 1) totalCount = inner.totalRecordCount || data.totalCount || data.totalCnt || data.cnt || list.length;
      if (!Array.isArray(list) || list.length === 0) break;
      collected.push(...list);
      if (collected.length >= totalCount || list.length < recordCount) break;
      pageNo += 1;
    }
    return collected;
  }, { apiUrl: EUM_API_URL, config, range });
}

function envFromFile(filePath) {
  if (!existsSync(filePath)) return {};
  const raw = String(readFileSync(filePath, "utf8"));
  return Object.fromEntries(raw.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) return [];
    const value = match[2].replace(/^['"]|['"]$/g, "");
    return [[match[1].trim(), value]];
  }));
}

function mergedEnv() {
  return {
    ...envFromFile(path.join(ROOT, ".env")),
    ...envFromFile(path.join(ROOT, ".env.local")),
    ...process.env,
  };
}

function hasFirebaseAuth(env) {
  return Boolean(
    env.FIREBASE_ID_TOKEN
    || env.FIREBASE_REFRESH_TOKEN
    || (env.FIREBASE_EMAIL && env.FIREBASE_PASSWORD)
  );
}

async function getFirebaseToken(env) {
  if (env.FIREBASE_ID_TOKEN) return env.FIREBASE_ID_TOKEN;
  const apiKey = env.VITE_FIREBASE_API_KEY;
  if (!apiKey) return "";
  if (env.FIREBASE_REFRESH_TOKEN) {
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: env.FIREBASE_REFRESH_TOKEN,
      }),
    });
    if (!response.ok) throw new Error(`Firebase refresh failed: ${response.status}`);
    const data = await response.json();
    return data.id_token || "";
  }
  if (env.FIREBASE_EMAIL && env.FIREBASE_PASSWORD) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: env.FIREBASE_EMAIL,
        password: env.FIREBASE_PASSWORD,
        returnSecureToken: true,
      }),
    });
    if (!response.ok) throw new Error(`Firebase sign-in failed: ${response.status}`);
    const data = await response.json();
    return data.idToken || "";
  }
  return "";
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: firestoreFields(value) } };
  }
  return { stringValue: String(value) };
}

function firestoreFields(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, firestoreValue(value)]));
}

function firestorePrefix(site) {
  return ({ PH4: "electronic_card_ph4", PH2: "electronic_card_ph2", P5PH1: "electronic_card_p5ph1" })[site] || "electronic_card_ph4";
}

async function writeFirestoreDoc({ projectId, token, docId, data }) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${FIRESTORE_COLLECTION}/${encodeURIComponent(docId)}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: firestoreFields(data) }),
  });
  if (!response.ok) {
    const textBody = await response.text();
    throw new Error(`Firestore write failed ${docId}: ${response.status} ${textBody.slice(0, 200)}`);
  }
}

async function syncFirestore({ env, site, grouped, range, dryRun }) {
  if (dryRun) return { skipped: true, reason: "dry-run" };
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) return { skipped: true, reason: "missing VITE_FIREBASE_PROJECT_ID" };
  if (!hasFirebaseAuth(env)) {
    return {
      skipped: true,
      reason: "missing Firebase admin credentials: set FIREBASE_EMAIL/FIREBASE_PASSWORD or FIREBASE_REFRESH_TOKEN",
    };
  }
  const token = await getFirebaseToken(env);
  const prefix = firestorePrefix(site);
  const dates = Object.keys(grouped).sort().reverse();
  const savedAt = new Date().toISOString();
  for (const date of dates) {
    await writeFirestoreDoc({
      projectId,
      token,
      docId: `${prefix}_${date}`,
      data: { data: grouped[date], savedAt },
    });
  }
  await writeFirestoreDoc({
    projectId,
    token,
    docId: `${prefix}_index`,
    data: { dates, lastSyncedAt: savedAt, syncRange: range },
  });
  return { skipped: false, dates: dates.length };
}

async function commandSync(args) {
  const configPath = path.resolve(args.config || DEFAULT_CONFIG_PATH);
  if (!existsSync(configPath)) {
    throw new Error(`설정 파일이 없습니다. 먼저 npm run elcd:config 를 실행하세요: ${configPath}`);
  }
  const config = await readJson(configPath);
  const profileDir = path.resolve(args.profile || DEFAULT_PROFILE_DIR);
  const outputDir = path.resolve(args.output || DEFAULT_OUTPUT_DIR);
  const range = currentMonthRange();
  const { context, page } = await openContext(profileDir, args.url || config.sourceUrl || EUM_CARD_URL, { headless: true });
  try {
  if (!page.url().includes("eum.cw.or.kr")) {
    await page.goto(EUM_CARD_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  console.log(`[elcd] Resolving EUM site config`);
  const runtimeConfig = await resolveConfigFromPage(page, config);
  if (!isMeaningfulCode(config.grndsCd) || config.margNo !== runtimeConfig.margNo || config.osrccSnStr !== runtimeConfig.osrccSnStr) {
    await writeJson(configPath, { ...runtimeConfig, site: args.site || config.site || "PH4", savedAt: new Date().toISOString() });
  }
  console.log(`[elcd] Range: ${range.startDate} ~ ${range.endDate}`);
  console.log(`[elcd] Site: ${runtimeConfig.grndsCd} / ${runtimeConfig.margNo}`);
  const apiRows = await fetchRows(page, runtimeConfig, range);
  const normalized = normalizeApiRows(apiRows);
  const grouped = groupByDate(normalized);
  await mkdir(outputDir, { recursive: true });
  await writeJson(path.join(outputDir, `raw_${range.startYmd}_${range.endYmd}.json`), apiRows);
  await writeJson(path.join(outputDir, `normalized_${range.startYmd}_${range.endYmd}.json`), normalized);
  await writeJson(path.join(outputDir, `grouped_${range.startYmd}_${range.endYmd}.json`), grouped);
  console.log(`[elcd] Output written: ${apiRows.length} raw / ${normalized.length} normalized / ${Object.keys(grouped).length} dates`);
  console.log(`[elcd] Syncing Firestore`);
  const firestore = await syncFirestore({
    env: mergedEnv(),
    site: args.site || runtimeConfig.site || config.site || "PH4",
    grouped,
    range,
    dryRun: Boolean(args.dryRun),
  });
  console.log(`[elcd] 원본 ${apiRows.length}건, 정규화 ${normalized.length}건, 날짜 ${Object.keys(grouped).length}개`);
  console.log(`[elcd] 출력 폴더: ${outputDir}`);
  if (firestore.skipped) console.log(`[elcd] Firestore 저장 건너뜀: ${firestore.reason}`);
  else console.log(`[elcd] Firestore 저장 완료: ${firestore.dates}개 날짜`);
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.command === "help") {
    usage();
    return;
  }
  if (args.command === "config") await commandConfig(args);
  else if (args.command === "sync") await commandSync(args);
  else throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  console.error(`[elcd] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
