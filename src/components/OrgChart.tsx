import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { loadOrgFS, saveOrgFS } from "@/lib/firestoreService";
import { createHeadOfficeOrgData, createPptOrgData, HEAD_OFFICE_ORG_VERSION, PPT_MEMBER_BORDER_COLORS, PPT_ORG_VERSION } from "@/lib/pptOrgData";
import { Plus, Trash2, Search, X, Download, Save, Camera, Pencil, FileSpreadsheet, Loader2, RotateCw } from "lucide-react";
import { toPng } from "html-to-image";
import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

/* ── types ── */
interface OrgTeam { id: string; name: string; color: string; sort_order: number; }
interface OrgMember { id: string; team_id: string; name: string; position: string; rank: string; phone: string; email: string; photo_url: string; is_leader: boolean; sort_order: number; border_color?: string; }
interface SiteManagerInfo { name: string; role?: string; phone: string; email: string; photo_url: string; }
interface OrgData { teams: OrgTeam[]; members: OrgMember[]; siteManager?: SiteManagerInfo; businessManager?: SiteManagerInfo; orgSourceVersion?: string; }
type OrgSiteKey = "p4-ph4" | "p4-ph2" | "p5-ph1" | "head-office-p4-ph4" | "head-office-p4-ph2" | "head-office-p5-ph1";

const RANKS = ["수석", "책임", "선임", "사원"] as const;
const TEAM_COLORS = ["#2563eb", "#7c3aed", "#059669", "#dc2626", "#d97706", "#0891b2", "#be185d", "#4f46e5", "#15803d", "#b45309"];
const MEMBER_BORDER_OPTIONS = [
  { label: "상용직", color: "#00B050" },
  { label: "현채", color: "#FFFF00" },
  { label: "태화/협력업체", color: "#FF0000" },
] as const;
const DEFAULT_BM: SiteManagerInfo = { name: "사업 1본부 팀장", role: "사업 1본부 팀장", phone: "", email: "", photo_url: "" };
const DEFAULT_SM: SiteManagerInfo = { name: "현장소장", phone: "", email: "", photo_url: "" };
const ORG_SITES: Array<{ key: OrgSiteKey; label: string; title: string; docId: string; date: string }> = [
  { key: "p4-ph4", label: "P4-PH4", title: "P4 PH4 초순수", docId: "org_p4_ph4", date: "26.05.12" },
  { key: "p4-ph2", label: "P4-PH2", title: "P4 PH2 초순수", docId: "org_p4_ph2", date: "26.05.12" },
  { key: "p5-ph1", label: "P5-PH1", title: "P5 PH1 초순수", docId: "org_p5_ph1", date: "26.05.12" },
  { key: "head-office-p4-ph4", label: "P4-PH4", title: "P4 PH4 초순수", docId: "org_head_office_p4_ph4", date: "26.05.06" },
  { key: "head-office-p4-ph2", label: "P4-PH2", title: "P4 PH2 초순수", docId: "org_head_office_p4_ph2", date: "26.05.06" },
  { key: "head-office-p5-ph1", label: "P5-PH1", title: "P5 PH1 초순수", docId: "org_head_office_p5_ph1", date: "26.05.06" },
];
const BASE_TEAMS: OrgTeam[] = [
  { id: "base-team-construction", name: "공사팀", color: "#2563eb", sort_order: 0 },
  { id: "base-team-office", name: "공무팀", color: "#7c3aed", sort_order: 1 },
  { id: "base-team-quality", name: "품질팀", color: "#059669", sort_order: 2 },
  { id: "base-team-safety", name: "안전팀", color: "#dc2626", sort_order: 3 },
  { id: "base-team-design", name: "설계팀", color: "#d97706", sort_order: 4 },
];

const SEED_DATA: OrgData = {
  siteManager: DEFAULT_SM,
  teams: [
    { id: "seed-team-1", name: "공무팀", color: "#7c3aed", sort_order: 0 },
    { id: "seed-team-2", name: "공사팀", color: "#2563eb", sort_order: 1 },
    { id: "seed-team-3", name: "품질팀", color: "#059669", sort_order: 2 },
    { id: "seed-team-4", name: "안전팀", color: "#dc2626", sort_order: 3 },
    { id: "seed-team-5", name: "설계팀", color: "#d97706", sort_order: 4 },
  ],
  members: [
    { id:"sm-01", team_id:"seed-team-1", name:"정두용", position:"팀장", rank:"수석", phone:"010-3499-5097", email:"dooyong@hscleantech.com",   photo_url:"", is_leader:true,  sort_order:0 },
    { id:"sm-02", team_id:"seed-team-1", name:"이재호", position:"담당", rank:"수석", phone:"010-6566-4804", email:"hatbazi@hscleantech.com",    photo_url:"", is_leader:false, sort_order:1 },
    { id:"sm-03", team_id:"seed-team-1", name:"이진식", position:"담당", rank:"책임", phone:"010-5037-5567", email:"jinsik@hscleantech.com",     photo_url:"", is_leader:false, sort_order:2 },
    { id:"sm-04", team_id:"seed-team-1", name:"염효양", position:"담당", rank:"선임", phone:"010-2467-3241", email:"duagydid_@hscleantech.com",  photo_url:"", is_leader:false, sort_order:3 },
    { id:"sm-05", team_id:"seed-team-2", name:"전제현", position:"팀장", rank:"수석", phone:"010-4542-8574", email:"jaehyun@hscleantech.com",    photo_url:"", is_leader:true,  sort_order:0 },
    { id:"sm-06", team_id:"seed-team-2", name:"엄태원", position:"담당", rank:"수석", phone:"010-4044-3004", email:"utw3004@hscleantech.com",    photo_url:"", is_leader:false, sort_order:1 },
    { id:"sm-07", team_id:"seed-team-2", name:"양선우", position:"서류", rank:"선임", phone:"010-4953-3359", email:"iosyhcc@hscleantech.com",    photo_url:"", is_leader:false, sort_order:2 },
    { id:"sm-08", team_id:"seed-team-2", name:"이중현", position:"차량", rank:"선임", phone:"010-8695-8987", email:"wndgus77@nate.com",          photo_url:"", is_leader:false, sort_order:3 },
    { id:"sm-09", team_id:"seed-team-3", name:"오세현", position:"팀장", rank:"수석", phone:"010-9322-2664", email:"ippon@hscleantech.com",      photo_url:"", is_leader:true,  sort_order:0 },
    { id:"sm-10", team_id:"seed-team-3", name:"이형우", position:"담당", rank:"수석", phone:"010-2268-9990", email:"Nanlhweda@naver.com",        photo_url:"", is_leader:false, sort_order:1 },
    { id:"sm-11", team_id:"seed-team-3", name:"박재형", position:"담당", rank:"책임", phone:"010-9285-7676", email:"upwquality@hscleantech.com", photo_url:"", is_leader:false, sort_order:2 },
    { id:"sm-12", team_id:"seed-team-3", name:"김성덕", position:"담당", rank:"책임", phone:"010-2442-0069", email:"upwquality@hscleantech.com", photo_url:"", is_leader:false, sort_order:3 },
    { id:"sm-13", team_id:"seed-team-3", name:"강태길", position:"담당", rank:"책임", phone:"010-6480-2263", email:"taegil@hscleantech.com",     photo_url:"", is_leader:false, sort_order:4 },
    { id:"sm-14", team_id:"seed-team-3", name:"안형철", position:"서류", rank:"선임", phone:"010-8277-7514", email:"upwquality@hscleantech.com", photo_url:"", is_leader:false, sort_order:5 },
    { id:"sm-15", team_id:"seed-team-3", name:"박슬기", position:"서류", rank:"선임", phone:"010-5062-3217", email:"sg3217@hscleantech.com",     photo_url:"", is_leader:false, sort_order:6 },
    { id:"sm-16", team_id:"seed-team-4", name:"윤근희", position:"팀장", rank:"수석", phone:"010-8008-2681", email:"ghyoon@hscleantech.com",     photo_url:"", is_leader:true,  sort_order:0 },
    { id:"sm-17", team_id:"seed-team-4", name:"곽희규", position:"서류", rank:"책임", phone:"010-5865-4584", email:"heekyu@hscleantech.com",     photo_url:"", is_leader:false, sort_order:1 },
    { id:"sm-18", team_id:"seed-team-4", name:"조성진", position:"담당", rank:"책임", phone:"010-6575-9539", email:"upwsafety@hscleantech.com", photo_url:"", is_leader:false, sort_order:2 },
    { id:"sm-19", team_id:"seed-team-4", name:"원영섭", position:"담당", rank:"책임", phone:"010-7696-2269", email:"dudtjq122@hscleantech.com", photo_url:"", is_leader:false, sort_order:3 },
    { id:"sm-20", team_id:"seed-team-4", name:"양준용", position:"담당", rank:"선임", phone:"010-3020-8418", email:"did8418@hscleantech.com",   photo_url:"", is_leader:false, sort_order:4 },
    { id:"sm-21", team_id:"seed-team-5", name:"이대용", position:"팀장", rank:"수석", phone:"010-6213-3902", email:"daeyong@hscleantech.com",   photo_url:"", is_leader:true,  sort_order:0 },
    { id:"sm-22", team_id:"seed-team-5", name:"박세일", position:"담당", rank:"수석", phone:"010-9959-8992", email:"psw062@hscleantech.com",    photo_url:"", is_leader:false, sort_order:1 },
    { id:"sm-23", team_id:"seed-team-5", name:"전종수", position:"담당", rank:"수석", phone:"010-2840-7163", email:"jongsoo@hscleantech.com",   photo_url:"", is_leader:false, sort_order:2 },
    { id:"sm-24", team_id:"seed-team-5", name:"이호기", position:"담당", rank:"수석", phone:"010-2840-7163", email:"jongsoo@hscleantech.com",   photo_url:"", is_leader:false, sort_order:3 },
    { id:"sm-25", team_id:"seed-team-5", name:"소영성", position:"담당", rank:"책임", phone:"010-8501-6881", email:"soyy99@hscleantech.com",    photo_url:"", is_leader:false, sort_order:4 },
    { id:"sm-26", team_id:"seed-team-5", name:"신동건", position:"담당", rank:"선임", phone:"010-8747-6786", email:"donggeon@hscleantech.com",  photo_url:"", is_leader:false, sort_order:5 },
  ],
};

// 이미지 압축: 최대 150×150, JPEG 0.75 품질 → base64
function compressImage(file: File, maxPx = 300, quality = 0.88): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(maxPx / img.width, maxPx / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

async function imageSrcToObjectUrl(src: string): Promise<{ url: string; revoke: () => void }> {
  if (src.startsWith("data:image/")) return { url: src, revoke: () => undefined };
  const response = await fetch(src);
  if (!response.ok) throw new Error("image-load-failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

async function rotateImageSrc(src: string, degrees = 90): Promise<string> {
  const { url, revoke } = await imageSrcToObjectUrl(src);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const normalizedDegrees = ((degrees % 360) + 360) % 360;
    const swap = normalizedDegrees === 90 || normalizedDegrees === 270;
    const canvas = document.createElement("canvas");
    canvas.width = swap ? img.height : img.width;
    canvas.height = swap ? img.width : img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas-unavailable");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((normalizedDegrees * Math.PI) / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    revoke();
  }
}

function lighten(hex: string, pct: number) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16), f = pct/100;
  return `rgb(${Math.round(r+(255-r)*f)},${Math.round(g+(255-g)*f)},${Math.round(b+(255-b)*f)})`;
}

function createBlankOrgData(): OrgData {
  return {
    businessManager: { ...DEFAULT_BM },
    siteManager: { ...DEFAULT_SM },
    teams: BASE_TEAMS.map((team) => ({ ...team, id: team.id.replace("base", crypto.randomUUID()) })),
    members: [],
  };
}

function pptColor(color: string) {
  return color.replace("#", "").toUpperCase();
}

function spacedKoreanName(name: string) {
  return name.length === 3 ? `${name[0]} ${name[1]} ${name[2]}` : name;
}

function getTodayTitleDate() {
  const now = new Date();
  return `${String(now.getFullYear()).slice(2)}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
}

function getDateFileStamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function isHeadOfficeSiteKey(key: OrgSiteKey) {
  return key.startsWith("head-office");
}

const REGULAR_MEMBER_COLOR = "#00B050";
const HEAD_OFFICE_TEAM_LABELS = ["공사", "설계", "공무", "품질", "안전"] as const;

function normalizeTeamName(name: string) {
  return name.replace(/\s+/g, "");
}

function isRegularMember(member: OrgMember) {
  return (member.border_color ?? REGULAR_MEMBER_COLOR) === REGULAR_MEMBER_COLOR;
}

function formatEmploymentCount(regular: number, nonRegular: number) {
  return nonRegular > 0 ? `${regular}(${nonRegular})` : String(regular);
}

function getTeamMembers(teams: OrgTeam[], members: OrgMember[], teamLabel: string) {
  const normalizedLabel = normalizeTeamName(teamLabel);
  const team = teams.find((item) => normalizeTeamName(item.name) === normalizedLabel);
  return team ? members.filter((member) => member.team_id === team.id).sort((a, b) => a.sort_order - b.sort_order) : [];
}

function getEmploymentStat(members: OrgMember[]) {
  const regular = members.filter(isRegularMember).length;
  return formatEmploymentCount(regular, members.length - regular);
}

function getHeadOfficeStats(teams: OrgTeam[], members: OrgMember[], siteManager: SiteManagerInfo) {
  const hasSiteManager = Boolean(siteManager.name || siteManager.phone || siteManager.email || siteManager.photo_url);
  const regular = members.filter(isRegularMember).length + (hasSiteManager ? 1 : 0);
  const nonRegular = members.length - members.filter(isRegularMember).length;
  return [
    ["총원", formatEmploymentCount(regular, nonRegular)],
    ["현장/소장", hasSiteManager ? 1 : 0],
    ...HEAD_OFFICE_TEAM_LABELS.map((label) => [label, getEmploymentStat(getTeamMembers(teams, members, `${label}팀`))] as [string, string | number]),
  ] as Array<[string, string | number]>;
}

async function imageSrcToDataUri(src: string): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith("data:image/")) return src;
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function escapeXmlText(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function replaceTextRuns(xml: string, values: Array<string | number>) {
  let index = 0;
  return xml.replace(/<a:t>([\s\S]*?)<\/a:t>/g, (match) => {
    if (index >= values.length) return match;
    const value = escapeXmlText(values[index]);
    index += 1;
    return `<a:t>${value}</a:t>`;
  });
}

function replaceCellText(cellXml: string, value: string | number) {
  const escaped = escapeXmlText(value);
  let replaced = false;
  return cellXml.replace(/<a:t>([\s\S]*?)<\/a:t>/g, () => {
    if (!replaced) {
      replaced = true;
      return `<a:t>${escaped}</a:t>`;
    }
    return "<a:t></a:t>";
  });
}

function replaceTableCellTexts(tableXml: string, cells: Array<string | number | undefined>) {
  let cellIndex = 0;
  return tableXml.replace(/<a:tc>[\s\S]*?<\/a:tc>/g, (cellXml) => {
    const value = cells[cellIndex];
    cellIndex += 1;
    return value === undefined ? cellXml : replaceCellText(cellXml, value);
  });
}

function replaceShapeTextContaining(xml: string, needle: string, values: Array<string | number>) {
  let replaced = false;
  return xml.replace(/<p:sp[\s\S]*?<\/p:sp>/g, (shapeXml) => {
    if (replaced || !shapeXml.includes(needle)) return shapeXml;
    replaced = true;
    return replaceTextRuns(shapeXml, values);
  });
}

function getFrameY(frameXml: string) {
  const match = frameXml.match(/<a:off x="\d+" y="(\d+)"\/>/);
  return match ? Number(match[1]) : 0;
}

function setFrameY(frameXml: string, y: number) {
  return frameXml.replace(/<a:off x="(\d+)" y="\d+"\/>/, `<a:off x="$1" y="${Math.round(y)}"/>`);
}

function getMaxShapeId(xml: string) {
  let maxId = 1;
  for (const match of xml.matchAll(/<p:cNvPr id="(\d+)"/g)) {
    maxId = Math.max(maxId, Number(match[1]));
  }
  return maxId;
}

function uniquifyShape(shapeXml: string, id: number, name: string) {
  return shapeXml.replace(/<p:cNvPr id="\d+" name="[^"]*"/, `<p:cNvPr id="${id}" name="${name} ${id}"`);
}

function replacePicEmbed(picXml: string, relationshipId: string) {
  return picXml.replace(/r:embed="[^"]+"/, `r:embed="${relationshipId}"`);
}

function replacePicAtIndex(xml: string, picIndex: number, relationshipId: string) {
  let index = 0;
  return xml.replace(/<p:pic[\s\S]*?<\/p:pic>/g, (picXml) => {
    if (index !== picIndex) {
      index += 1;
      return picXml;
    }
    index += 1;
    return replacePicEmbed(picXml, relationshipId);
  });
}

function getMaxRelationshipId(relXml: string) {
  let maxId = 1;
  for (const match of relXml.matchAll(/Id="rId(\d+)"/g)) {
    maxId = Math.max(maxId, Number(match[1]));
  }
  return maxId;
}

async function addPptImageRelationship(zip: JSZip, relXml: string, imageSrc: string, imageIndex: number, relationshipIndex: number) {
  const dataUri = await imageSrcToDataUri(imageSrc);
  const match = dataUri?.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === "png" ? "png" : "jpg";
  const mediaName = `app-org-photo-${imageIndex}.${ext}`;
  const relationshipId = `rId${relationshipIndex}`;
  zip.file(`ppt/media/${mediaName}`, match[2], { base64: true });
  const relationship = `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>`;
  return {
    relXml: relXml.replace("</Relationships>", `${relationship}</Relationships>`),
    relationshipId,
  };
}

async function exportHeadOfficeTemplatePpt({
  activeSite,
  siteManager,
  teams,
  members,
}: {
  activeSite: { label: string; title: string; date: string };
  siteManager: SiteManagerInfo;
  teams: OrgTeam[];
  members: OrgMember[];
}) {
  const response = await fetch("/org-chart-pptx/head-office-original.pptx");
  if (!response.ok) throw new Error("head-office-template-not-found");

  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const slidePath = "ppt/slides/slide1.xml";
  const relsPath = "ppt/slides/_rels/slide1.xml.rels";
  let slideXml = await zip.file(slidePath)!.async("string");
  let relXml = await zip.file(relsPath)!.async("string");
  const tableRegex = /<p:graphicFrame[\s\S]*?<a:tbl>[\s\S]*?<\/a:tbl>[\s\S]*?<\/p:graphicFrame>/g;
  const originalTableFrames = Array.from(slideXml.matchAll(tableRegex), (match) => match[0]);
  const picRegex = /<p:pic[\s\S]*?<\/p:pic>/g;
  const originalPics = Array.from(slideXml.matchAll(picRegex), (match) => match[0]);

  const construction = getTeamMembers(teams, members, "공사팀");
  const design = getTeamMembers(teams, members, "설계팀");
  const office = getTeamMembers(teams, members, "공무팀");
  const quality = getTeamMembers(teams, members, "품질팀");
  const safety = getTeamMembers(teams, members, "안전팀");
  const headOfficeStats = getHeadOfficeStats(teams, members, siteManager);

  const memberCells = (member?: OrgMember) => [
    undefined,
    member?.rank ?? "",
    member ? spacedKoreanName(member.name) : "",
    undefined,
    "E-MAIL",
    member?.email ?? "",
    undefined,
    "H.P",
    member?.phone ?? "",
  ];
  const siteManagerCells = [
    undefined,
    "수석",
    spacedKoreanName(siteManager.name),
    undefined,
    "E-MAIL",
    siteManager.email,
    undefined,
    "H.P",
    siteManager.phone,
  ];
  const statsCells = [
    "총원", "현장 / 소장", "공사", "설계", "공무", "품질", "안전",
    ...headOfficeStats.map(([, value]) => value),
  ];

  const tableSlots: Array<{ cells: Array<string | number | undefined> }> = [
    { cells: siteManagerCells },
    { cells: memberCells(design[0]) },
    { cells: memberCells(safety[0]) },
    { cells: memberCells(office[0]) },
    { cells: memberCells(construction[0]) },
    { cells: memberCells(quality[0]) },
    { cells: memberCells(quality[1]) },
    { cells: memberCells(quality[2]) },
    { cells: memberCells(construction[1]) },
    { cells: memberCells(design[1]) },
    { cells: memberCells(design[2]) },
    { cells: memberCells(office[1]) },
    { cells: memberCells(office[2]) },
    { cells: memberCells(safety[1]) },
    { cells: statsCells },
    { cells: memberCells(safety[2]) },
    { cells: memberCells(safety[3]) },
    { cells: memberCells(design[3]) },
    { cells: memberCells(design[4]) },
    { cells: memberCells(design[5]) },
    { cells: memberCells(office[3]) },
    { cells: memberCells(office[4]) },
    { cells: memberCells(quality[3]) },
    { cells: memberCells(quality[4]) },
    { cells: memberCells(quality[5]) },
    { cells: memberCells(safety[4]) },
    { cells: memberCells(construction[3]) },
    { cells: memberCells(construction[4]) },
    { cells: memberCells(design[6]) },
    { cells: memberCells(construction[2]) },
  ];

  let tableIndex = 0;
  slideXml = slideXml.replace(tableRegex, (tableXml) => {
    const slot = tableSlots[tableIndex];
    tableIndex += 1;
    return slot ? replaceTableCellTexts(tableXml, slot.cells) : tableXml;
  });

  let nextShapeId = getMaxShapeId(slideXml) + 1;
  const overflowFrames: string[] = [];
  const appendOverflow = (teamMembers: OrgMember[], capacity: number, lastFrameIndex: number, previousFrameIndex: number) => {
    if (teamMembers.length <= capacity) return;
    const templateFrame = originalTableFrames[lastFrameIndex];
    const previousFrame = originalTableFrames[previousFrameIndex];
    if (!templateFrame || !previousFrame) return;
    const yStep = Math.max(390000, getFrameY(templateFrame) - getFrameY(previousFrame));
    const baseY = getFrameY(templateFrame);
    teamMembers.slice(capacity).forEach((member, index) => {
      let frame = replaceTableCellTexts(templateFrame, memberCells(member));
      frame = setFrameY(frame, baseY + yStep * (index + 1));
      frame = uniquifyShape(frame, nextShapeId, "추가 인원");
      nextShapeId += 1;
      overflowFrames.push(frame);
    });
  };

  appendOverflow(construction, 5, 27, 26);
  appendOverflow(design, 7, 28, 19);
  appendOverflow(office, 5, 21, 20);
  appendOverflow(quality, 6, 24, 23);
  appendOverflow(safety, 5, 25, 16);

  if (overflowFrames.length > 0) {
    slideXml = slideXml.replace("</p:spTree>", `${overflowFrames.join("")}</p:spTree>`);
  }

  let nextRelationshipIndex = getMaxRelationshipId(relXml) + 1;
  let nextImageIndex = 1;
  const addImage = async (imageSrc?: string) => {
    if (!imageSrc) return null;
    const added = await addPptImageRelationship(zip, relXml, imageSrc, nextImageIndex, nextRelationshipIndex);
    if (!added) return null;
    relXml = added.relXml;
    nextImageIndex += 1;
    nextRelationshipIndex += 1;
    return added.relationshipId;
  };
  const photoSlots: Array<{ picIndex: number; photoUrl?: string }> = [
    { picIndex: 0, photoUrl: siteManager.photo_url },
    { picIndex: 1, photoUrl: construction[0]?.photo_url },
    { picIndex: 2, photoUrl: design[0]?.photo_url },
    { picIndex: 3, photoUrl: design[1]?.photo_url },
    { picIndex: 4, photoUrl: design[2]?.photo_url },
    { picIndex: 5, photoUrl: design[3]?.photo_url },
    { picIndex: 6, photoUrl: design[4]?.photo_url },
    { picIndex: 7, photoUrl: office[0]?.photo_url },
    { picIndex: 8, photoUrl: office[1]?.photo_url },
    { picIndex: 9, photoUrl: office[2]?.photo_url },
    { picIndex: 10, photoUrl: office[3]?.photo_url },
    { picIndex: 11, photoUrl: office[4]?.photo_url },
    { picIndex: 12, photoUrl: quality[0]?.photo_url },
    { picIndex: 13, photoUrl: quality[1]?.photo_url },
    { picIndex: 14, photoUrl: quality[2]?.photo_url },
    { picIndex: 15, photoUrl: quality[3]?.photo_url },
    { picIndex: 16, photoUrl: quality[4]?.photo_url },
    { picIndex: 17, photoUrl: quality[5]?.photo_url },
    { picIndex: 18, photoUrl: safety[0]?.photo_url },
    { picIndex: 19, photoUrl: safety[1]?.photo_url },
    { picIndex: 20, photoUrl: safety[2]?.photo_url },
    { picIndex: 21, photoUrl: safety[3]?.photo_url },
    { picIndex: 22, photoUrl: safety[4]?.photo_url },
    { picIndex: 23, photoUrl: construction[4]?.photo_url },
    { picIndex: 24, photoUrl: design[6]?.photo_url },
    { picIndex: 25, photoUrl: construction[2]?.photo_url },
    { picIndex: 26, photoUrl: construction[3]?.photo_url },
    { picIndex: 27, photoUrl: design[5]?.photo_url },
    { picIndex: 28, photoUrl: construction[1]?.photo_url },
  ];
  for (const slot of photoSlots) {
    const relationshipId = await addImage(slot.photoUrl);
    if (relationshipId) slideXml = replacePicAtIndex(slideXml, slot.picIndex, relationshipId);
  }

  const overflowPics: string[] = [];
  const appendOverflowPics = async (teamMembers: OrgMember[], capacity: number, lastPicIndex: number, previousPicIndex: number) => {
    if (teamMembers.length <= capacity) return;
    const templatePic = originalPics[lastPicIndex];
    const previousPic = originalPics[previousPicIndex];
    if (!templatePic || !previousPic) return;
    const yStep = Math.max(390000, getFrameY(templatePic) - getFrameY(previousPic));
    const baseY = getFrameY(templatePic);
    for (const [index, member] of teamMembers.slice(capacity).entries()) {
      const relationshipId = await addImage(member.photo_url);
      if (!relationshipId) continue;
      let pic = replacePicEmbed(templatePic, relationshipId);
      pic = setFrameY(pic, baseY + yStep * (index + 1));
      pic = uniquifyShape(pic, nextShapeId, "추가 사진");
      nextShapeId += 1;
      overflowPics.push(pic);
    }
  };
  await appendOverflowPics(construction, 5, 23, 26);
  await appendOverflowPics(design, 7, 24, 27);
  await appendOverflowPics(office, 5, 11, 10);
  await appendOverflowPics(quality, 6, 17, 16);
  await appendOverflowPics(safety, 5, 22, 21);

  if (overflowPics.length > 0) {
    slideXml = slideXml.replace("</p:spTree>", `${overflowPics.join("")}</p:spTree>`);
  }

  const titleDate = getTodayTitleDate();
  const title = `   ■ 조직도_사업1본부_${activeSite.title} _${titleDate}`;
  slideXml = replaceShapeTextContaining(slideXml, "■ 조직도", [title, "", "", "", "", "", "", "", "", "", ""]);

  zip.file(slidePath, slideXml);
  zip.file(relsPath, relXml);
  const blob = await zip.generateAsync({ type: "blob" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `조직도_사업1팀_평택_${activeSite.label}_초순수현장_${titleDate}.pptx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

/* ━━━━━━━━━━━━━━━ SITE MANAGER EDIT DIALOG ━━━━━━━━━━━━━━━ */
function SiteManagerEditDialog({ info, title, onSave, onClose }: { info: SiteManagerInfo; title: string; onSave: (i: SiteManagerInfo) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<SiteManagerInfo>({ ...info });
  const fileRef = useRef<HTMLInputElement>(null);
  const handleRotate = async () => {
    if (!draft.photo_url) return;
    try {
      const rotated = await rotateImageSrc(draft.photo_url);
      setDraft((current) => ({ ...current, photo_url: rotated }));
    } catch {
      toast.error("사진 회전 중 오류가 발생했습니다.");
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold">{title} 정보 수정</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative group">
              {draft.photo_url ? (
                <img src={draft.photo_url} className="w-16 h-16 rounded-full object-cover border-2 border-border" />
              ) : (
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold" style={{ background: "linear-gradient(135deg,#a8c8f8,#c8b4f8)" }}>
                  {draft.name.slice(0,1) || "?"}
                </div>
              )}
              <button onClick={() => fileRef.current?.click()} className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="h-5 w-5 text-white" />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try {
                  const dataUrl = await compressImage(f);
                  setDraft((d) => ({ ...d, photo_url: dataUrl }));
                } catch {
                  toast.error("사진을 불러오는 중 오류가 발생했습니다.");
                }
                e.target.value = "";
              }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">클릭하여 사진 업로드</p>
              {draft.photo_url && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleRotate}
                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 font-medium transition-colors"
                  >
                    <RotateCw className="h-3 w-3" /> 90도 회전
                  </button>
                  <button
                    onClick={() => setDraft((d) => ({ ...d, photo_url: "" }))}
                    className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-700 font-medium transition-colors"
                  >
                    <X className="h-3 w-3" /> 사진 삭제
                  </button>
                </div>
              )}
            </div>
          </div>
          {([ ["이름","name"], ["직책","role"], ["연락처","phone"], ["이메일","email"] ] as const).map(([label, key]) => (
            <label key={key} className="block">
              <span className="text-xs font-semibold text-muted-foreground">{label}</span>
              <input value={draft[key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
            </label>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-muted">취소</button>
          <button onClick={() => { onSave(draft); onClose(); }} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold hover:bg-primary/90">적용</button>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━ EDIT DIALOG ━━━━━━━━━━━━━━━ */
function EditDialog({ member, onSave, onClose, onPhotoUpload, onPhotoRemove, uploading }: { member: OrgMember; onSave: (m: OrgMember) => void; onClose: () => void; onPhotoUpload: (memberId: string, file: File) => Promise<string | null>; onPhotoRemove: (memberId: string) => void; uploading: boolean }) {
  const [draft, setDraft] = useState<OrgMember>({
    ...member,
    border_color: member.border_color ?? PPT_MEMBER_BORDER_COLORS[member.name] ?? MEMBER_BORDER_OPTIONS[0].color,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof OrgMember, v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));
  useEffect(() => {
    setDraft((current) => ({ ...current, photo_url: member.photo_url }));
  }, [member.photo_url]);
  const handleRotate = async () => {
    if (!draft.photo_url) return;
    try {
      const rotated = await rotateImageSrc(draft.photo_url);
      setDraft((current) => ({ ...current, photo_url: rotated }));
    } catch {
      toast.error("사진 회전 중 오류가 발생했습니다.");
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">인원 정보 수정</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative group">
              {draft.photo_url ? (
                <img src={draft.photo_url} className="w-16 h-16 rounded-full object-cover border-2 border-border" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-lg font-bold border-2 border-border">
                  {draft.name.slice(0,1) || "?"}
                </div>
              )}
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploading ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Camera className="h-5 w-5 text-white" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const dataUrl = await onPhotoUpload(draft.id, f);
                  if (dataUrl) setDraft((d) => ({ ...d, photo_url: dataUrl }));
                }
                e.target.value = "";
              }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">클릭하여 사진 업로드</p>
              {draft.photo_url && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleRotate}
                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 font-medium transition-colors"
                  >
                    <RotateCw className="h-3 w-3" /> 90도 회전
                  </button>
                  <button
                    onClick={() => { onPhotoRemove(draft.id); setDraft((d) => ({ ...d, photo_url: "" })); }}
                    className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-700 font-medium transition-colors"
                  >
                    <X className="h-3 w-3" /> 사진 삭제
                  </button>
                </div>
              )}
            </div>
          </div>
          {([ ["이름","name","text"], ["직책","position","text"], ["연락처","phone","tel"], ["이메일","email","email"] ] as const).map(([label, key, type]) => (
            <label key={key} className="block">
              <span className="text-xs font-semibold text-muted-foreground">{label}</span>
              <input type={type} value={draft[key] as string} onChange={(e) => set(key, e.target.value)}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
            </label>
          ))}
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">직급</span>
            <select value={draft.rank} onChange={(e) => set("rank", e.target.value)}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white">
              {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div>
            <span className="text-xs font-semibold text-muted-foreground">테두리 구분</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {MEMBER_BORDER_OPTIONS.map((option) => (
                <button
                  key={option.color}
                  type="button"
                  onClick={() => set("border_color", option.color)}
                  className={`flex h-10 items-center justify-center gap-2 rounded-lg border px-2 text-xs font-bold transition-colors ${
                    draft.border_color === option.color
                      ? "border-slate-900 bg-slate-50 text-slate-950"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="h-3 w-3 rounded-full border border-slate-300" style={{ backgroundColor: option.color }} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={draft.is_leader} onChange={(e) => set("is_leader", e.target.checked)} className="rounded border-border" />
            <span className="text-sm text-foreground">팀장</span>
          </label>
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-muted">취소</button>
          <button onClick={() => onSave(draft)} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold hover:bg-primary/90">적용</button>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━ ADD TEAM DIALOG ━━━━━━━━━━━━━━━ */
function AddTeamDialog({ onAdd, onClose, usedColors }: { onAdd: (name: string, color: string) => void; onClose: () => void; usedColors: string[] }) {
  const [name, setName] = useState("");
  const available = TEAM_COLORS.filter((c) => !usedColors.includes(c));
  const [color, setColor] = useState(available[0] || TEAM_COLORS[0]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border"><h3 className="text-sm font-bold">팀 추가</h3></div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">팀 이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="예: 경영지원팀" />
          </label>
          <div>
            <span className="text-xs font-semibold text-muted-foreground">팀 색상</span>
            <div className="flex gap-2 mt-1 flex-wrap">
              {TEAM_COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} className="w-8 h-8 rounded-full border-2 transition-all"
                  style={{ backgroundColor: c, borderColor: color === c ? "#111" : "transparent", transform: color === c ? "scale(1.15)" : "scale(1)" }} />
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-muted">취소</button>
          <button disabled={!name.trim()} onClick={() => { onAdd(name.trim(), color); onClose(); }}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 disabled:opacity-40">추가</button>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━ MAIN ━━━━━━━━━━━━━━━ */
interface OrgChartProps {
  initialSiteKey?: OrgSiteKey;
  showSiteTabs?: boolean;
}

export default function OrgChart({ initialSiteKey = "p4-ph4", showSiteTabs = true }: OrgChartProps = {}) {
  const [activeSiteKey, setActiveSiteKey] = useState<OrgSiteKey>(initialSiteKey);
  const [teams, setTeams] = useState<OrgTeam[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [businessManager, setBusinessManager] = useState<SiteManagerInfo>(DEFAULT_BM);
  const [siteManager, setSiteManager] = useState<SiteManagerInfo>(DEFAULT_SM);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editMember, setEditMember] = useState<OrgMember | null>(null);
  const [editBusinessManager, setEditBusinessManager] = useState(false);
  const [editSiteManager, setEditSiteManager] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const activeSite = ORG_SITES.find((site) => site.key === activeSiteKey) ?? ORG_SITES[0];
  const isHeadOfficeTemplate = isHeadOfficeSiteKey(activeSite.key);
  const titleDate = getTodayTitleDate();
  const visibleOrgSites = showSiteTabs
    ? ORG_SITES.filter((site) => !isHeadOfficeSiteKey(site.key))
    : isHeadOfficeTemplate
      ? ORG_SITES.filter((site) => isHeadOfficeSiteKey(site.key))
      : [activeSite];
  const expectedOrgSourceVersion = activeSite.key === "p4-ph4"
    ? PPT_ORG_VERSION
    : isHeadOfficeTemplate
      ? HEAD_OFFICE_ORG_VERSION
      : activeSite.key;

  useEffect(() => {
    setActiveSiteKey(initialSiteKey);
  }, [initialSiteKey]);

  useEffect(() => {
    setDirty(false);
    setSearchQuery("");
    loadOrgFS(activeSite.docId).then(async (data) => {
      if (activeSite.key === "p4-ph4" && !data) {
        data = await loadOrgFS("org");
      }
      if (activeSite.key === "head-office-p4-ph4" && !data) {
        data = await loadOrgFS("org_head_office");
      }
      if (data && Array.isArray((data as OrgData).teams) && (data as OrgData).teams.length > 0 && (data as OrgData).orgSourceVersion === expectedOrgSourceVersion) {
        const d = data as OrgData;
        setTeams(d.teams); setMembers(d.members);
        setBusinessManager(d.businessManager ?? DEFAULT_BM);
        setSiteManager(d.siteManager ?? DEFAULT_SM);
      } else {
        const initial = activeSite.key === "p4-ph4" ? createPptOrgData() : isHeadOfficeTemplate ? createHeadOfficeOrgData() : createBlankOrgData();
        setBusinessManager(initial.businessManager);
        setSiteManager(initial.siteManager);
        setTeams(initial.teams);
        setMembers(initial.members);
      }
    });
  }, [activeSite.docId, activeSite.key, expectedOrgSourceVersion]);

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    const ok = await saveOrgFS({ teams, members, businessManager, siteManager, orgSourceVersion: expectedOrgSourceVersion }, activeSite.docId);
    if (ok) { setDirty(false); toast.success("조직도가 저장되었습니다."); }
    else toast.error("Firestore 저장 실패 (네트워크 확인)");
    setSaving(false);
  }, [teams, members, businessManager, siteManager, activeSite.docId, expectedOrgSourceVersion]);

  const handleApplyPptOrg = useCallback(() => {
    const ppt = createPptOrgData();
    setBusinessManager(ppt.businessManager);
    setSiteManager(ppt.siteManager);
    setTeams(ppt.teams);
    setMembers(ppt.members);
    setDirty(true);
    toast.success("PPT 기준 조직도를 적용했습니다. 저장을 누르면 서버 데이터에 반영됩니다.");
  }, []);

  const handleApplyHeadOfficeOrg = useCallback(() => {
    const headOffice = createHeadOfficeOrgData();
    setBusinessManager(headOffice.businessManager);
    setSiteManager(headOffice.siteManager);
    setTeams(headOffice.teams);
    setMembers(headOffice.members);
    setDirty(true);
    toast.success("본사 송부용 PPT 기준 조직도를 적용했습니다. 저장을 누르면 서버 데이터에 반영됩니다.");
  }, []);

  const handleApplyBlankOrg = useCallback(() => {
    const blank = createBlankOrgData();
    setBusinessManager(blank.businessManager ?? DEFAULT_BM);
    setSiteManager(blank.siteManager ?? DEFAULT_SM);
    setTeams(blank.teams);
    setMembers(blank.members);
    setDirty(true);
    toast.success(`${activeSite.label} 빈 조직도 틀을 적용했습니다.`);
  }, [activeSite.label]);

  const handleAddTeam = useCallback((name: string, color: string) => {
    const newTeam: OrgTeam = { id: crypto.randomUUID(), name, color, sort_order: teams.length };
    setTeams((prev) => [...prev, newTeam]);
    setMembers((prev) => [...prev, { id: crypto.randomUUID(), team_id: newTeam.id, name: "이름 입력", position: "팀장", rank: "책임", phone: "", email: "", photo_url: "", is_leader: true, sort_order: 0, border_color: MEMBER_BORDER_OPTIONS[0].color }]);
    setDirty(true);
  }, [teams]);

  const handleDeleteTeam = useCallback((teamId: string) => {
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
    setMembers((prev) => prev.filter((m) => m.team_id !== teamId));
    setDirty(true);
  }, []);

  const handleAddMember = useCallback((teamId: string) => {
    const count = members.filter((m) => m.team_id === teamId).length;
    setMembers((prev) => [...prev, { id: crypto.randomUUID(), team_id: teamId, name: "이름 입력", position: "담당자", rank: "사원", phone: "", email: "", photo_url: "", is_leader: false, sort_order: count, border_color: MEMBER_BORDER_OPTIONS[0].color }]);
    setDirty(true);
  }, [members]);

  const handleDeleteMember = useCallback((memberId: string) => { setMembers((prev) => prev.filter((m) => m.id !== memberId)); setDirty(true); }, []);

  const handleMemberSave = useCallback((updated: OrgMember) => { setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m))); setEditMember(null); setDirty(true); }, []);

  const handleBusinessManagerSave = useCallback((info: SiteManagerInfo) => { setBusinessManager(info); setDirty(true); }, []);

  const handleSiteManagerSave = useCallback((info: SiteManagerInfo) => { setSiteManager(info); setDirty(true); }, []);

  const handlePhotoRemove = useCallback(async (memberId: string) => {
    const nextMembers = members.map((m) => (m.id === memberId ? { ...m, photo_url: "" } : m));
    setMembers(nextMembers);
    const ok = await saveOrgFS({ teams, members: nextMembers, businessManager, siteManager, orgSourceVersion: expectedOrgSourceVersion }, activeSite.docId);
    if (ok) { setDirty(false); toast.success("사진이 삭제되었습니다."); }
    else { setDirty(true); toast.error("저장 실패 — 저장 버튼을 눌러주세요."); }
  }, [members, teams, businessManager, siteManager, activeSite.docId, expectedOrgSourceVersion]);

  const handlePhotoUpload = useCallback(async (memberId: string, file: File) => {
    try {
      const dataUrl = await compressImage(file);
      const nextMembers = members.map((m) => (m.id === memberId ? { ...m, photo_url: dataUrl } : m));
      setMembers(nextMembers);
      setEditMember((prev) => prev?.id === memberId ? { ...prev, photo_url: dataUrl } : prev);
      // 즉시 Firestore 저장
      const ok = await saveOrgFS({ teams, members: nextMembers, businessManager, siteManager, orgSourceVersion: expectedOrgSourceVersion }, activeSite.docId);
      if (ok) {
        setDirty(false);
        toast.success("사진이 저장되었습니다.");
        return dataUrl;
      } else {
        setDirty(true);
        toast.error("사진 저장 실패 — 저장 버튼을 눌러주세요.");
        return dataUrl;
      }
    } catch {
      toast.error("사진을 불러오는 중 오류가 발생했습니다.");
      return null;
    }
  }, [members, teams, businessManager, siteManager, activeSite.docId, expectedOrgSourceVersion]);

  const topManagerCount = [businessManager, siteManager].filter((manager) => manager.phone || manager.email || manager.photo_url).length;
  const totalMembers = members.length + topManagerCount;
  const leaderCount = members.filter((m) => m.is_leader).length;
  const teamCountById = useMemo(() => {
    return members.reduce<Record<string, number>>((counts, member) => {
      counts[member.team_id] = (counts[member.team_id] || 0) + 1;
      return counts;
    }, {});
  }, [members]);
  const teamCountByName = useMemo(() => {
    return teams.reduce<Record<string, number>>((counts, team) => {
      counts[team.name] = teamCountById[team.id] || 0;
      return counts;
    }, {});
  }, [teams, teamCountById]);
  const headOfficeStats = useMemo(() => getHeadOfficeStats(teams, members, siteManager), [teams, members, siteManager]);
  const displayTotalMembers = isHeadOfficeTemplate ? headOfficeStats[0]?.[1] : totalMembers;

  const handleExportImage = useCallback(async () => {
    if (!chartRef.current) return;
    try {
      const dataUrl = await toPng(chartRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const link = document.createElement("a"); link.download = "조직도.png"; link.href = dataUrl; link.click();
      toast.success("이미지가 저장되었습니다.");
    } catch { toast.error("이미지 저장 실패"); }
  }, []);

  const handleExportPpt = useCallback(async () => {
    try {
      if (isHeadOfficeTemplate) {
        await exportHeadOfficeTemplatePpt({ activeSite, siteManager, teams, members });
        toast.success("본사 송부용 원본 PPT 양식에 앱 데이터를 반영했습니다.");
        return;
      }

      const pptx = new pptxgen();
      if (isHeadOfficeTemplate) {
        pptx.defineLayout({ name: "HEAD_OFFICE", width: 11.6927, height: 8.2674 });
        pptx.layout = "HEAD_OFFICE";
      } else {
        pptx.layout = "LAYOUT_WIDE";
      }
      pptx.author = "Worksite Radar";
      pptx.subject = `${activeSite.label} 조직도`;
      pptx.title = `${activeSite.label} 조직도`;
      pptx.company = "한성크린텍";
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };

      const rect = pptx.ShapeType.rect;
      const line = pptx.ShapeType.line;
      const dark = "2B3A67";
      const textDark = "1B2A4A";
      const xOffset = 0.65;

      if (isHeadOfficeTemplate) {
        const regularColor = "#00B050";
        const contractColor = "#FFFF00";
        const partnerColor = "#FF0000";
        const sortedForPpt = [...teams].sort((a, b) => a.sort_order - b.sort_order);
        const regularCount = members.filter((member) => (member.border_color ?? regularColor) === regularColor).length + (siteManager.name ? 1 : 0);
        const nonRegularCount = members.length + (siteManager.name ? 1 : 0) - regularCount;
        const statValue = (teamName: string) => {
          const team = teams.find((item) => item.name === teamName);
          if (!team) return "-";
          const teamMembers = members.filter((member) => member.team_id === team.id);
          const regular = teamMembers.filter((member) => (member.border_color ?? regularColor) === regularColor).length;
          const nonRegular = teamMembers.length - regular;
          return nonRegular > 0 ? `${regular}(${nonRegular})` : regular;
        };

        slide.addText(`■ 조직도_사업1본부_${activeSite.title} _${titleDate}`, {
          x: 0.08, y: 0.08, w: 7.5, h: 0.3, fontFace: "맑은 고딕", fontSize: 15, bold: true, color: "000000", margin: 0,
        });

        const statRows: Array<[string, string | number]> = [
          ["총원", `${regularCount}(${nonRegularCount})`],
          ["현장/소장", siteManager.name ? 1 : 0],
          ["공사", statValue("공사 팀")],
          ["설계", statValue("설계 팀")],
          ["공무", statValue("공무 팀")],
          ["품질", statValue("품질 팀")],
          ["안전", statValue("안전 팀")],
        ];
        const statX = 8.07;
        const statY = 0.87;
        const statW = 3.42 / statRows.length;
        statRows.forEach(([label, value], idx) => {
          const x = statX + idx * statW;
          slide.addShape(rect, { x, y: statY, w: statW, h: 0.32, fill: { color: "D9EAF7" }, line: { color: "000000", width: 0.45 } });
          slide.addText(String(label), { x, y: statY + 0.11, w: statW, h: 0.09, fontFace: "맑은 고딕", fontSize: 5.6, bold: true, color: "000000", align: "center", margin: 0 });
          slide.addShape(rect, { x, y: statY + 0.32, w: statW, h: 0.32, fill: { color: "FFFFFF" }, line: { color: "000000", width: 0.45 } });
          slide.addText(String(value), { x, y: statY + 0.43, w: statW, h: 0.09, fontFace: "맑은 고딕", fontSize: 5.7, bold: true, color: "000000", align: "center", margin: 0 });
        });
        slide.addText("▶괄호 안의 인원은 현채 / 3rd part  인원 기입", {
          x: 8.07, y: 1.56, w: 2.88, h: 0.2, fontFace: "맑은 고딕", fontSize: 7, color: "C00000", margin: 0,
        });

        const addHeadCard = async (info: SiteManagerInfo | OrgMember, role: string, x: number, y: number, w: number, h: number, borderColor = "000000") => {
          const photoUrl = "photo_url" in info ? info.photo_url : "";
          const rank = "rank" in info ? info.rank : "";
          const name = "name" in info ? info.name : "";
          const email = "email" in info ? info.email : "";
          const phone = "phone" in info ? info.phone : "";
          slide.addShape(rect, { x, y, w, h, fill: { color: "FFFFFF" }, line: { color: pptColor(borderColor), width: 1 } });
          const img = await imageSrcToDataUri(photoUrl);
          if (img) slide.addImage({ data: img, x: x + 0.02, y: y + 0.12, w: 0.48, h: h - 0.14, sizingCrop: { x: x + 0.02, y: y + 0.12, w: 0.48, h: h - 0.14 } });
          slide.addText(role, { x: x + 0.54, y: y + 0.04, w: w - 0.58, h: 0.07, fontFace: "맑은 고딕", fontSize: 4.7, bold: true, color: "000000", margin: 0, fit: "shrink" });
          slide.addText(`${rank} ${spacedKoreanName(name)}`.trim(), { x: x + 0.54, y: y + 0.14, w: w - 0.58, h: 0.08, fontFace: "맑은 고딕", fontSize: 5.8, bold: true, color: "000000", margin: 0, fit: "shrink" });
          if (email) slide.addText(`E-MAIL ${email}`, { x: x + 0.54, y: y + 0.27, w: w - 0.58, h: 0.06, fontFace: "맑은 고딕", fontSize: 3.2, color: "000000", margin: 0, fit: "shrink" });
          if (phone) slide.addText(`H.P ${phone}`, { x: x + 0.54, y: y + 0.37, w: w - 0.58, h: 0.06, fontFace: "맑은 고딕", fontSize: 3.7, color: "000000", margin: 0, fit: "shrink" });
        };

        await addHeadCard(siteManager, siteManager.role || "현장소장", 4.89, 1.76, 2.16, 0.88, "000000");
        slide.addShape(line, { x: 1.16, y: 2.98, w: 9.37, h: 0, line: { color: "000000", width: 0.75 } });

        const columnXs = [0.17, 2.55, 4.9, 7.24, 9.57];
        const headerXs = [0.77, 3.11, 5.45, 7.82, 10.14];
        const rowYs = [3.53, 4.12, 4.69, 5.25, 5.82, 6.39, 6.95];
        for (let i = 0; i < sortedForPpt.length; i += 1) {
          const team = sortedForPpt[i];
          slide.addShape(rect, { x: headerXs[i], y: 3.27, w: 0.78, h: 0.19, fill: { color: "0000FF" }, line: { color: "0000FF", width: 0.5 } });
          slide.addText(team.name, { x: headerXs[i], y: 3.315, w: 0.78, h: 0.08, fontFace: "맑은 고딕", fontSize: 5.7, bold: true, color: "FFFFFF", align: "center", margin: 0 });
          const teamMembers = members.filter((member) => member.team_id === team.id).sort((a, b) => a.sort_order - b.sort_order);
          for (let j = 0; j < teamMembers.length; j += 1) {
            const member = teamMembers[j];
            const y = rowYs[j] ?? (rowYs[rowYs.length - 1] + (j - rowYs.length + 1) * 0.57);
            await addHeadCard(member, member.position, columnXs[i], y, 1.94, 0.47, member.border_color ?? regularColor);
            if (member.border_color === contractColor || member.border_color === partnerColor) {
              slide.addText(member.border_color === partnerColor ? "(3rd)" : "(현채)", {
                x: columnXs[i] + 1.5, y: y + 0.07, w: 0.42, h: 0.12, fontFace: "맑은 고딕", fontSize: 5.3, bold: true, color: "0000FF", margin: 0,
              });
            }
          }
        }

        const d = new Date();
        await pptx.writeFile({
          fileName: `조직도_${activeSite.label}_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}.pptx`,
        });
        toast.success("본사 송부용 PPT로 내보냈습니다.");
        return;
      }

      slide.addText(`■ 조직도 _ 사업 1 팀 _${activeSite.title} _${titleDate}`, {
        x: 0.1 + xOffset, y: 0.1, w: 7.4, h: 0.3, fontFace: "맑은 고딕", fontSize: 15, bold: true, color: "000000", margin: 0,
      });

      const statRows: Array<[string, string | number]> = [
        ["총원", totalMembers],
        ["팀장", businessManager.phone || businessManager.email || businessManager.photo_url ? 1 : 0],
        ["소장", siteManager.phone || siteManager.email || siteManager.photo_url ? 1 : 0],
        ["공사", teamCountByName["공사팀"] || 0],
        ["공무", teamCountByName["공무팀"] || 0],
        ["품질", teamCountByName["품질팀"] || 0],
        ["안전", teamCountByName["안전팀"] || 0],
        ["설계", teamCountByName["설계팀"] || 0],
      ];
      const statX = 7.95 + xOffset;
      const statW = 0.44;
      statRows.forEach(([label, value], idx) => {
        const x = statX + idx * statW;
        slide.addShape(rect, { x, y: 0.1, w: statW, h: 0.23, fill: { color: dark }, line: { color: "000000", width: 0.5 } });
        slide.addText(String(label), { x, y: 0.16, w: statW, h: 0.08, fontFace: "맑은 고딕", fontSize: 5.5, bold: true, color: "FFFFFF", align: "center", margin: 0 });
        slide.addShape(rect, { x, y: 0.33, w: statW, h: 0.27, fill: { color: "FFFFFF" }, line: { color: "000000", width: 0.5 } });
        slide.addText(String(value), { x, y: 0.40, w: statW, h: 0.08, fontFace: "맑은 고딕", fontSize: 6.2, bold: true, color: "000000", align: "center", margin: 0 });
      });

      slide.addShape(line, { x: 0.1 + xOffset, y: 0.73, w: 11.55, h: 0, line: { color: "000000", width: 1.0 } });

      const addManager = async (info: SiteManagerInfo, title: string, x: number) => {
        slide.addShape(rect, { x, y: 0.82, w: 3.35, h: 0.72, fill: { color: "FFFFFF" }, line: { color: "000000", width: 1.0 } });
        const img = await imageSrcToDataUri(info.photo_url);
        if (img) slide.addImage({ data: img, x: x + 0.08, y: 0.89, w: 0.55, h: 0.58, sizingCrop: { x: x + 0.08, y: 0.89, w: 0.55, h: 0.58 } });
        else slide.addShape(rect, { x: x + 0.08, y: 0.89, w: 0.55, h: 0.58, fill: { color: "64748B" }, line: { color: "64748B" } });
        slide.addText(title, { x: x + 0.75, y: 0.90, w: 2.45, h: 0.12, fontFace: "맑은 고딕", fontSize: 6.2, bold: true, color: textDark, margin: 0 });
        slide.addShape(line, { x: x + 0.75, y: 1.08, w: 2.45, h: 0, line: { color: "BFC7D5", width: 0.4 } });
        slide.addText(info.name, { x: x + 0.75, y: 1.18, w: 1.5, h: 0.14, fontFace: "맑은 고딕", fontSize: 10.5, bold: true, color: "000000", margin: 0 });
        if (info.email) slide.addText(`✉ ${info.email}`, { x: x + 0.75, y: 1.37, w: 2.45, h: 0.08, fontFace: "맑은 고딕", fontSize: 5.2, color: "32445A", margin: 0 });
        if (info.phone) slide.addText(`☎ ${info.phone}`, { x: x + 0.75, y: 1.48, w: 2.45, h: 0.08, fontFace: "맑은 고딕", fontSize: 5.2, color: "32445A", margin: 0 });
      };

      await addManager(businessManager, businessManager.role || "사업 1본부 팀장", 0.1 + xOffset);
      await addManager(siteManager, siteManager.role || "사업 1본부 현장 소장", 4.53 + xOffset);

      slide.addShape(line, { x: 5.84 + xOffset, y: 1.62, w: 0, h: 0.16, line: { color: "000000", width: 0.7 } });
      slide.addShape(line, { x: 1.15 + xOffset, y: 1.78, w: 9.36, h: 0, line: { color: "000000", width: 0.7 } });

      const sortedForPpt = [...teams].sort((a, b) => a.sort_order - b.sort_order);
      const teamXs = [0.03, 2.38, 4.7, 7.04, 9.39];
      const colW = 2.24;
      const teamHeaderY = 1.8;
      const leaderY = 2.13;
      const memberStartY = 3.08;
      const cardW = 1.1;
      const cardH = 0.82;
      const rowGap = 0.04;
      const colGap = 0.07;

      for (let i = 0; i < sortedForPpt.length; i += 1) {
        const team = sortedForPpt[i];
        const x = (teamXs[i] ?? (0.03 + i * (colW + 0.11))) + xOffset;
        slide.addShape(rect, { x, y: teamHeaderY, w: colW, h: 0.28, fill: { color: dark }, line: { color: dark, width: 0.8 } });
        slide.addText(team.name, { x: x + 0.05, y: teamHeaderY + 0.08, w: colW - 0.1, h: 0.1, fontFace: "맑은 고딕", fontSize: 8.5, bold: true, color: "FFFFFF", margin: 0 });

        const tm = members.filter((m) => m.team_id === team.id);
        const leaderMember = tm.filter((m) => m.is_leader).sort((a, b) => a.sort_order - b.sort_order)[0];
        const otherMembers = tm.filter((m) => !m.is_leader).sort((a, b) => a.sort_order - b.sort_order);

        const addMemberCard = async (member: OrgMember, cx: number, cy: number, cw: number, isLeaderCard = false) => {
          const borderColor = pptColor(member.border_color ?? PPT_MEMBER_BORDER_COLORS[member.name] ?? team.color);
          slide.addShape(rect, { x: cx, y: cy, w: cw, h: cardH, fill: { color: "FFFFFF" }, line: { color: borderColor, width: isLeaderCard ? 1.4 : 1 } });
          if (isLeaderCard) {
            slide.addShape(rect, { x: cx, y: cy, w: cw, h: 0.18, fill: { color: dark }, line: { color: borderColor, width: 0.8 } });
            slide.addText("팀 장", { x: cx, y: cy + 0.05, w: cw, h: 0.08, fontFace: "맑은 고딕", fontSize: 5.5, bold: true, color: "FFFFFF", align: "center", margin: 0 });
          }
          const imgX = cx + 0.05;
          const imgY = cy + (isLeaderCard ? 0.23 : 0.07);
          const imgW = isLeaderCard ? 0.49 : 0.35;
          const imgH = isLeaderCard ? 0.58 : 0.68;
          const img = await imageSrcToDataUri(member.photo_url);
          if (img) slide.addImage({ data: img, x: imgX, y: imgY, w: imgW, h: imgH, sizingCrop: { x: imgX, y: imgY, w: imgW, h: imgH } });
          else {
            slide.addShape(rect, { x: imgX, y: imgY, w: imgW, h: imgH, fill: { color: "64748B" }, line: { color: "64748B" } });
            slide.addText(member.name.slice(0, 1), { x: imgX, y: imgY + imgH / 2 - 0.05, w: imgW, h: 0.1, fontFace: "맑은 고딕", fontSize: 8, bold: true, color: "FFFFFF", align: "center", margin: 0 });
          }
          const textX = cx + (isLeaderCard ? 0.66 : 0.44);
          const textW = cw - (isLeaderCard ? 0.72 : 0.48);
          slide.addText(member.position, { x: textX, y: cy + (isLeaderCard ? 0.25 : 0.08), w: textW, h: 0.08, fontFace: "맑은 고딕", fontSize: isLeaderCard ? 6.2 : 5.3, bold: true, color: "607D8B", margin: 0 });
          slide.addText(`${member.rank} ${spacedKoreanName(member.name)}`, { x: textX, y: cy + (isLeaderCard ? 0.39 : 0.22), w: textW, h: 0.12, fontFace: "맑은 고딕", fontSize: isLeaderCard ? 8.3 : 6.2, bold: true, color: "000000", align: "center", margin: 0 });
          if (member.email) slide.addText(`✉ ${member.email}`, { x: textX, y: cy + (isLeaderCard ? 0.60 : 0.43), w: textW, h: 0.08, fontFace: "맑은 고딕", fontSize: isLeaderCard ? 5.0 : 3.8, color: "32445A", align: "center", margin: 0, fit: "shrink" });
          if (member.phone) slide.addText(`☎ ${member.phone}`, { x: textX, y: cy + (isLeaderCard ? 0.72 : 0.62), w: textW, h: 0.08, fontFace: "맑은 고딕", fontSize: isLeaderCard ? 5.0 : 3.8, color: "32445A", align: "center", margin: 0, fit: "shrink" });
        };

        if (leaderMember) {
          await addMemberCard(leaderMember, x, leaderY, colW, true);
        }

        for (let j = 0; j < otherMembers.length; j += 1) {
          const member = otherMembers[j];
          const subCol = j % 2;
          const row = Math.floor(j / 2);
          const cx = x + subCol * (cardW + colGap);
          const cy = memberStartY + row * (cardH + rowGap);
          await addMemberCard(member, cx, cy, cardW, false);
        }
      }

      const d = new Date();
      await pptx.writeFile({
        fileName: `조직도_${activeSite.label}_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}.pptx`,
      });
      toast.success("PPT로 내보냈습니다.");
    } catch {
      toast.error("PPT 저장 실패");
    }
  }, [activeSite.key, activeSite.label, activeSite.title, businessManager, siteManager, teams, members, totalMembers, teamCountByName, isHeadOfficeTemplate, titleDate]);

  const handleExportExcel = useCallback(async () => {
    if (teams.length === 0) { toast.error("내보낼 데이터가 없습니다."); return; }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("조직도");

    // 컬럼 설정: 사진(A) | 팀명(B) | 성명(C) | 직종(D) | 직급(E) | 연락처(F) | 이메일(G)
    ws.columns = [
      { width: 10 }, // A: 사진
      { width: 14 }, // B: 팀명
      { width: 10 }, // C: 성명
      { width: 10 }, // D: 직종
      { width: 8  }, // E: 직급
      { width: 16 }, // F: 연락처
      { width: 28 }, // G: 이메일
    ];

    // 헤더 행
    const hdr = ws.addRow(["사진", "팀명", "성명", "직종", "직급", "연락처", "이메일"]);
    hdr.height = 20;
    hdr.eachCell((cell) => {
      cell.font = { bold: true, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "thin" }, bottom: { style: "thin" },
        left: { style: "thin" }, right: { style: "thin" },
      };
    });

    const sortedTeams = [...teams].sort((a, b) => a.sort_order - b.sort_order);

    for (const team of sortedTeams) {
      const tm = members.filter((m) => m.team_id === team.id);
      const sorted = [
        ...tm.filter((x) => x.is_leader),
        ...tm.filter((x) => !x.is_leader),
      ].sort((a, b) => a.sort_order - b.sort_order);

      for (const m of sorted) {
        const row = ws.addRow(["", team.name, m.name, m.position, m.rank, m.phone, m.email]);
        row.height = 56; // 사진 크기 맞춤

        // 텍스트 셀 스타일
        row.eachCell((cell, colNum) => {
          cell.alignment = { vertical: "middle", horizontal: colNum === 1 ? "center" : "left" };
          cell.font = { size: 10 };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } },
          };
        });

        // 사진 삽입
        if (m.photo_url) {
          try {
            const match = m.photo_url.match(/^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/);
            if (match) {
              const ext = (match[1] === "jpg" ? "jpeg" : match[1]) as "jpeg" | "png" | "gif";
              const imageId = wb.addImage({ base64: match[2], extension: ext });
              const rowIdx = row.number - 1; // 0-based
              ws.addImage(imageId, {
                tl: { col: 0.1, row: rowIdx + 0.1 } as ExcelJS.Anchor,
                ext: { width: 52, height: 52 },
              });
            }
          } catch { /* 사진 삽입 실패 시 무시 */ }
        }
      }
    }

    // 다운로드
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    a.href = url;
    a.download = `조직도_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("엑셀로 내보냈습니다.");
  }, [teams, members]);

  const filteredTeams = useMemo(() => {
    if (!searchQuery.trim()) return teams;
    const q = searchQuery.trim();
    const matchedIds = new Set(members.filter((m) => m.name.includes(q)).map((m) => m.team_id));
    return teams.filter((t) => matchedIds.has(t.id));
  }, [teams, members, searchQuery]);

  const sortedTeams = useMemo(() => [...filteredTeams].sort((a, b) => a.sort_order - b.sort_order), [filteredTeams]);
  const getMembersForTeam = useCallback((teamId: string) => {
    let mems = members.filter((m) => m.team_id === teamId);
    if (searchQuery.trim()) mems = mems.filter((m) => m.name.includes(searchQuery.trim()));
    return {
      leader: mems.filter((m) => m.is_leader).sort((a,b)=>a.sort_order-b.sort_order)[0] ?? null,
      others: mems.filter((m) => !m.is_leader).sort((a,b)=>a.sort_order-b.sort_order),
    };
  }, [members, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Header / toolbar */}
      <div className={`rounded-2xl border bg-white p-4 shadow-sm ${isHeadOfficeTemplate ? "border-slate-300" : "border-slate-200"}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold text-slate-950">{isHeadOfficeTemplate ? "본사 송부용 PPT 조직도" : "조직도"}</h2>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${isHeadOfficeTemplate ? "bg-slate-900 text-white" : "bg-blue-50 text-blue-700"}`}>{activeSite.label}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">{displayTotalMembers}명</span>
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {isHeadOfficeTemplate
                ? "본사 제출용 원본 PPT 양식을 기준으로 표 텍스트를 반영합니다. 사진과 레이아웃은 원본 위치를 유지합니다."
                : `팀 ${teams.length}개 · 상단 ${topManagerCount}명 · 팀 리더 ${leaderCount}명`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="이름 검색"
                className="h-10 w-56 rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm font-semibold outline-none transition-colors focus:border-slate-300 focus:bg-white" />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button
              onClick={activeSite.key === "p4-ph4" ? handleApplyPptOrg : isHeadOfficeTemplate ? handleApplyHeadOfficeOrg : handleApplyBlankOrg}
              className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> {activeSite.key === "p4-ph4" ? "PPT 적용" : isHeadOfficeTemplate ? "본사 PPT 적용" : "빈 틀 적용"}
            </button>
            <button onClick={handleExportExcel} className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50">
              <FileSpreadsheet className="h-3.5 w-3.5" /> 엑셀
            </button>
            <button onClick={handleExportPpt} className={`flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors ${
              isHeadOfficeTemplate
                ? "border border-slate-900 bg-slate-900 text-white hover:bg-slate-700"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}>
              <Download className="h-3.5 w-3.5" /> {isHeadOfficeTemplate ? "본사 송부용 PPT 다운로드" : "PPT"}
            </button>
            <button onClick={handleExportImage} className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50">
              <Download className="h-3.5 w-3.5" /> 이미지
            </button>
            <button onClick={handleSaveAll} disabled={!dirty || saving}
              className="flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white transition-colors hover:bg-slate-700 disabled:opacity-40">
              <Save className="h-3.5 w-3.5" /> {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {visibleOrgSites.map((site) => (
          <button
            key={site.key}
            onClick={() => setActiveSiteKey(site.key)}
            className={`h-10 rounded-xl px-4 text-sm font-black transition-colors ${
              activeSiteKey === site.key
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            }`}
          >
            {site.label}
          </button>
        ))}
      </div>

      {isHeadOfficeTemplate && (
        <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-white shadow-sm">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-extrabold">본사에 송부하는 PPT 양식</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-300">
                화면 수정 후 `본사 송부용 PPT 다운로드`를 누르면 원본 송부 양식에 맞춰 내려받습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-bold">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-100">양식: 26.05.06</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-100">{activeSite.label} 초순수</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-100">본사 제출용</span>
            </div>
          </div>
        </div>
      )}

      {/* Org chart */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-200/60 p-3 shadow-sm">
        <div ref={chartRef} className="mx-auto min-w-[1180px] max-w-[1280px] bg-white p-5 text-slate-950 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-2">
            <h3 className="text-xl font-black tracking-tight">■ 조직도 _ 사업 1 팀 _{activeSite.title} _{titleDate}</h3>
            <div className={`grid overflow-hidden border border-slate-900 text-center text-[11px] font-black ${isHeadOfficeTemplate ? "grid-cols-7" : "grid-cols-8"}`}>
              {(isHeadOfficeTemplate ? headOfficeStats : [
                ["총원", totalMembers],
                ["팀장", businessManager.phone || businessManager.email || businessManager.photo_url ? 1 : 0],
                ["소장", siteManager.phone || siteManager.email || siteManager.photo_url ? 1 : 0],
                ["공사", teamCountByName["공사팀"] || 0],
                ["공무", teamCountByName["공무팀"] || 0],
                ["품질", teamCountByName["품질팀"] || 0],
                ["안전", teamCountByName["안전팀"] || 0],
                ["설계", teamCountByName["설계팀"] || 0],
              ]).map(([label, value]) => (
                <div key={String(label)} className="min-w-[52px] border-l border-slate-900 first:border-l-0">
                  <div className="bg-slate-900 px-1 py-1 text-white">{label}</div>
                  <div className="px-1 py-1.5">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={`mb-4 grid gap-10 px-16 ${isHeadOfficeTemplate ? "grid-cols-1 justify-items-center" : "grid-cols-[1fr_1fr]"}`}>
            {!isHeadOfficeTemplate && (
              <PptManagerCard info={businessManager} title={businessManager.role || "사업 1본부 팀장"} onEdit={() => setEditBusinessManager(true)} />
            )}
            <div className={isHeadOfficeTemplate ? "w-[360px]" : ""}>
              {isHeadOfficeTemplate ? (
                <HeadOfficeManagerCard info={siteManager} title={siteManager.role || "현장소장"} onEdit={() => setEditSiteManager(true)} />
              ) : (
                <PptManagerCard info={siteManager} title={siteManager.role || "사업 1본부 현장 소장"} onEdit={() => setEditSiteManager(true)} />
              )}
            </div>
          </div>

          <div className="relative mb-3 h-7">
            <div className="absolute left-1/2 top-0 h-7 w-px -translate-x-1/2 bg-slate-900" />
            <div className="absolute left-[10%] right-[10%] top-6 h-px bg-slate-900" />
          </div>

          {sortedTeams.length > 0 ? (
            <div className="grid grid-cols-5 gap-2">
              {sortedTeams.map((team) => {
                const { leader, others } = getMembersForTeam(team.id);
                const teamMembers = leader ? [leader, ...others] : others;
                return (
                  <div key={team.id} className="min-w-0">
                    <div className={`mb-1.5 flex h-8 items-center justify-between px-2 text-white ${
                      isHeadOfficeTemplate ? "mx-auto w-[92px] border border-blue-700 bg-blue-700" : "border border-[#2B3A67] bg-[#2B3A67]"
                    }`}>
                      <span className={`${isHeadOfficeTemplate ? "w-full text-center text-[12px]" : "text-sm"} font-black`}>{team.name}</span>
                      <button onClick={() => handleDeleteTeam(team.id)} className={`rounded p-1 text-white/65 hover:bg-white/15 hover:text-white ${isHeadOfficeTemplate ? "hidden group-hover:block" : ""}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className={isHeadOfficeTemplate ? "space-y-2" : "space-y-1.5"}>
                      {teamMembers.map((member) => (
                        isHeadOfficeTemplate ? (
                          <HeadOfficeMemberCard
                            key={member.id}
                            member={member}
                            onEdit={() => setEditMember(member)}
                            onDelete={() => handleDeleteMember(member.id)}
                          />
                        ) : (
                          <PptMemberCard
                            key={member.id}
                            member={member}
                            color={member.border_color ?? PPT_MEMBER_BORDER_COLORS[member.name] ?? team.color}
                            isLeader={member.is_leader}
                            onEdit={() => setEditMember(member)}
                            onDelete={() => handleDeleteMember(member.id)}
                          />
                        )
                      ))}
                    </div>
                    <button onClick={() => handleAddMember(team.id)}
                      className="mt-1.5 w-full border border-dashed border-slate-300 py-1.5 text-[10px] font-bold text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                      + 인원 추가
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <p className="text-sm text-gray-400">팀이 없습니다</p>
              <button onClick={() => setShowAddTeam(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:bg-gray-50">
                <Plus className="h-4 w-4" /> 팀 추가
              </button>
            </div>
          )}
        </div>
      </div>

      {filteredTeams.length === 0 && searchQuery && (
        <div className="py-10 text-center">
          <Search className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">"{searchQuery}" 검색 결과 없음</p>
        </div>
      )}

      {editBusinessManager && <SiteManagerEditDialog info={businessManager} title={businessManager.role || "사업 1본부 팀장"} onSave={handleBusinessManagerSave} onClose={() => setEditBusinessManager(false)} />}
      {editSiteManager && <SiteManagerEditDialog info={siteManager} title={siteManager.role || "사업 1본부 현장 소장"} onSave={handleSiteManagerSave} onClose={() => setEditSiteManager(false)} />}
      {editMember && <EditDialog member={editMember} onSave={handleMemberSave} onClose={() => setEditMember(null)} onPhotoUpload={handlePhotoUpload} onPhotoRemove={handlePhotoRemove} uploading={false} />}
      {showAddTeam && <AddTeamDialog onAdd={handleAddTeam} onClose={() => setShowAddTeam(false)} usedColors={teams.map((t) => t.color)} />}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━ PPT-LIKE CHART CARDS ━━━━━━━━━━━━━━━ */
function PptManagerCard({ info, title, onEdit }: { info: SiteManagerInfo; title: string; onEdit: () => void }) {
  return (
    <button
      onClick={onEdit}
      className="group grid min-h-[112px] grid-cols-[82px_1fr] border-2 border-slate-900 bg-white text-left shadow-[3px_3px_0_rgba(15,23,42,0.18)] transition-colors hover:bg-slate-50"
    >
      <div className="flex h-full items-center justify-center border-r-2 border-slate-900 bg-slate-100 p-1.5">
        {info.photo_url ? (
          <img src={info.photo_url} className="h-[92px] w-[68px] object-cover object-top" />
        ) : (
          <div className="flex h-[92px] w-[68px] items-center justify-center bg-slate-800 text-xl font-black text-white">{info.name.slice(0, 1) || "?"}</div>
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-center px-3">
        <div className="mb-2 border-b border-slate-300 pb-1 text-[12px] font-black text-slate-700">{title}</div>
        <div className="text-lg font-black leading-tight text-slate-950">{info.name}</div>
        {info.email && <div className="mt-2 truncate text-[11px] font-semibold text-slate-600">✉ {info.email}</div>}
        {info.phone && <div className="mt-0.5 text-[11px] font-semibold text-slate-600">☎ {info.phone}</div>}
      </div>
      <Pencil className="absolute h-0 w-0 opacity-0" />
    </button>
  );
}

function PptMemberCard({ member, color, isLeader, onEdit, onDelete }: { member: OrgMember; color: string; isLeader?: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div
      className={`group relative grid min-h-[88px] grid-cols-[60px_1fr] bg-white text-left ${isLeader ? "border-2" : "border"}`}
      style={{ borderColor: color }}
    >
      <button onClick={onEdit} className="contents">
        <div className="flex items-center justify-center border-r bg-white p-1" style={{ borderColor: color }}>
          {member.photo_url ? (
            <img src={member.photo_url} className="h-[78px] w-[52px] object-cover object-top" />
          ) : (
            <div className="flex h-[78px] w-[52px] items-center justify-center text-[12px] font-black text-white" style={{ backgroundColor: isLeader ? color : "#64748b" }}>
              {member.name.slice(0, 1)}
            </div>
          )}
        </div>
        <div className="min-w-0 px-1.5 py-1.5">
          <div className="mb-1 flex items-center justify-between gap-1">
            <span className="truncate text-[11px] font-black text-slate-800">{member.position}</span>
            {isLeader && <span className="shrink-0 bg-slate-900 px-1 py-0.5 text-[8px] font-black text-white">팀장</span>}
          </div>
          <div className="text-[13px] font-black leading-tight text-slate-950">{member.rank} {member.name}</div>
          {member.email && <div className="mt-1 truncate text-[8.5px] font-semibold leading-tight text-slate-600">✉ {member.email}</div>}
          {member.phone && <div className="mt-0.5 truncate text-[9px] font-semibold leading-tight text-slate-600">☎ {member.phone}</div>}
        </div>
      </button>
      <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
        <button onClick={onEdit} className="bg-white/90 p-1 text-slate-600 shadow hover:text-slate-950">
          <Pencil className="h-3 w-3" />
        </button>
        <button onClick={onDelete} className="bg-white/90 p-1 text-rose-500 shadow hover:text-rose-700">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function headOfficeMarker(member: OrgMember) {
  if (member.border_color === "#FF0000") return "(3rd)";
  if (member.border_color === "#FFFF00") return "(현채)";
  return "";
}

function HeadOfficeManagerCard({ info, title, onEdit }: { info: SiteManagerInfo; title: string; onEdit: () => void }) {
  return (
    <button
      onClick={onEdit}
      className="group grid min-h-[92px] grid-cols-[86px_1fr] border border-black bg-white text-left transition-colors hover:bg-slate-50"
    >
      <div className="flex items-center justify-center border-r border-black bg-white p-1">
        {info.photo_url ? (
          <img src={info.photo_url} className="h-[78px] w-[64px] object-cover object-top" />
        ) : (
          <div className="flex h-[78px] w-[64px] items-center justify-center bg-slate-700 text-lg font-black text-white">{info.name.slice(0, 1) || "?"}</div>
        )}
      </div>
      <div className="grid grid-rows-[24px_1fr]">
        <div className="flex items-center justify-center border-b border-black bg-[#E2F0D9] text-[11px] font-black text-black">
          {title}
        </div>
        <div className="grid grid-cols-[48px_1fr] text-[10px] font-bold text-black">
          <div className="flex items-center justify-center border-b border-r border-black">수석</div>
          <div className="flex items-center justify-center border-b border-black text-[13px] font-black">{spacedKoreanName(info.name)}</div>
          <div className="flex items-center justify-center border-b border-r border-black">E-MAIL</div>
          <div className="flex items-center justify-center border-b border-black px-1 text-[8px]">{info.email}</div>
          <div className="flex items-center justify-center border-r border-black">H.P</div>
          <div className="flex items-center justify-center px-1 text-[10px]">{info.phone}</div>
        </div>
      </div>
    </button>
  );
}

function HeadOfficeMemberCard({ member, onEdit, onDelete }: { member: OrgMember; onEdit: () => void; onDelete: () => void }) {
  const marker = headOfficeMarker(member);
  return (
    <div className="group relative grid min-h-[64px] grid-cols-[60px_1fr] border border-black bg-white text-left">
      <button onClick={onEdit} className="contents">
        <div className="flex items-center justify-center border-r border-black bg-white p-1">
          {member.photo_url ? (
            <img src={member.photo_url} className="h-[54px] w-[48px] object-cover object-top" />
          ) : (
            <div className="flex h-[54px] w-[48px] items-center justify-center bg-slate-700 text-[12px] font-black text-white">
              {member.name.slice(0, 1)}
            </div>
          )}
        </div>
        <div className="grid grid-rows-[16px_1fr]">
          <div className="flex items-center justify-center border-b border-black bg-[#E2F0D9] text-[9px] font-black text-black">
            {member.position}
          </div>
          <div className="grid grid-cols-[40px_1fr] text-[8px] font-bold text-black">
            <div className="flex items-center justify-center border-b border-r border-black">{member.rank}</div>
            <div className="flex items-center justify-center gap-1 border-b border-black text-[10px] font-black">
              <span>{spacedKoreanName(member.name)}</span>
              {marker && <span className="text-[8px] font-black text-blue-700">{marker}</span>}
            </div>
            <div className="flex items-center justify-center border-b border-r border-black">E-MAIL</div>
            <div className="flex items-center justify-center border-b border-black px-1 text-[6.5px]">{member.email}</div>
            <div className="flex items-center justify-center border-r border-black">H.P</div>
            <div className="flex items-center justify-center px-1 text-[8px]">{member.phone}</div>
          </div>
        </div>
      </button>
      <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
        <button onClick={onEdit} className="bg-white/90 p-1 text-slate-600 shadow hover:text-slate-950">
          <Pencil className="h-3 w-3" />
        </button>
        <button onClick={onDelete} className="bg-white/90 p-1 text-rose-500 shadow hover:text-rose-700">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━ COMPACT MEMBER ROW ━━━━━━━━━━━━━━━ */
function CompactRow({ member, color, isLeader, onEdit, onDelete }: { member: OrgMember; color: string; isLeader?: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="group flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-slate-50" onClick={onEdit}>
      {member.photo_url ? (
        <img src={member.photo_url} className="h-8 w-8 shrink-0 rounded-full border border-slate-200 object-cover" />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-extrabold"
          style={{ background: isLeader ? color : lighten(color, 88), borderColor: lighten(color, 55), color: isLeader ? "#ffffff" : color }}>
          {member.name.slice(0, 1)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-xs font-extrabold leading-tight text-slate-900">{member.name}</p>
        </div>
        {member.phone && <p className="truncate text-[10px] font-medium leading-tight text-slate-400">{member.phone}</p>}
      </div>
      <span className="shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold"
        style={{ background: lighten(color, 94), borderColor: lighten(color, 70), color }}>
        {member.position}
      </span>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="rounded p-1 hover:bg-slate-100">
          <Pencil className="h-3 w-3 text-slate-400" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="rounded p-1 hover:bg-rose-50">
          <Trash2 className="h-3 w-3 text-rose-400" />
        </button>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━ COMPACT SITE MANAGER NODE ━━━━━━━━━━━━━━━ */
function CompactSiteManagerNode({ info, title, onEdit }: { info: SiteManagerInfo; title: string; onEdit: () => void }) {
  return (
    <div className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm transition-colors hover:border-slate-300"
      onClick={onEdit}>
      {info.photo_url ? (
        <img src={info.photo_url} className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-base font-extrabold text-white">
          {info.name.slice(0, 1) || "?"}
        </div>
      )}
      <div className="min-w-0">
        <p className="mb-0.5 text-[10px] font-extrabold tracking-wide text-slate-400">{title}</p>
        <p className="truncate text-sm font-extrabold leading-tight text-slate-900">{info.name}</p>
        {info.phone && <p className="mt-0.5 text-[10px] font-medium text-slate-400">{info.phone}</p>}
      </div>
      <Pencil className="ml-1 h-3.5 w-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
