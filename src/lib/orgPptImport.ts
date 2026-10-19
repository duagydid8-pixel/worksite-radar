import JSZip from "jszip";
import type { PptOrgManager, PptOrgMember, PptOrgTeam } from "./pptOrgData";

/**
 * 본사 송부용 조직도 PPT(.pptx) 첫 슬라이드를 읽어 조직도 데이터로 바꾼다.
 * 양식: 사람마다 4줄 표 [직책] / [직급, 이름] / [E-MAIL, 메일] / [H.P, 연락처],
 * 표 위의 "공 사 팀" 같은 제목으로 팀을 정하고, 표 왼쪽 사진과 "(현채)/(3rd)" 표시를 같이 읽는다.
 */
export interface OrgPptImportResult {
  siteManager: PptOrgManager | null;
  teams: PptOrgTeam[];
  members: PptOrgMember[];
  /** member.id(또는 "site-manager") → 사진 data URL */
  photos: Record<string, string>;
  warnings: string[];
}

interface Rect { x: number; y: number; w: number; h: number }

const RANKS = ["수석", "책임", "선임", "사원"];
const MARKER_COLORS: Record<string, string> = { 현채: "#FFFF00", "3rd": "#FF0000", 태화: "#7030A0" };
const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const TEAM_COLOR = "#2B3A67";

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const compact = (s: string) => s.replace(/[\s　]+/g, "");
const clean = (s: string) => s.replace(/[　]/g, " ").replace(/\s+/g, " ").trim();

function textOf(fragment: string): string {
  const paragraphs = fragment.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) ?? [];
  return paragraphs
    .map((p) => (p.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => decode(t.replace(/<\/?a:t>/g, ""))).join(""))
    .join(" ");
}

function rectOf(fragment: string): Rect | null {
  const m = fragment.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
}

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
// 표 높이는 실제 줄 높이보다 작게 저장돼 있는 경우가 많아 최소 높이를 둔다(EMU)
const MIN_TABLE_H = 520000;
const inside = (p: { x: number; y: number }, r: Rect, pad = 0) =>
  p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + Math.max(r.h, MIN_TABLE_H) + pad;

interface PersonTable {
  rect: Rect;
  position: string;
  rank: string;
  name: string;
  email: string;
  phone: string;
}

function parsePersonTable(frame: string): PersonTable | null {
  const rect = rectOf(frame);
  if (!rect) return null;
  const rows = (frame.match(/<a:tr[\s>][\s\S]*?<\/a:tr>/g) ?? []).map((row) =>
    (row.match(/<a:tc[\s>][\s\S]*?<\/a:tc>/g) ?? []).map((c) => clean(textOf(c))),
  );
  const lastValue = (cells: string[]) => [...cells].reverse().find((c) => c && !/^(e-?mail|h\.?p|휴대폰|연락처)$/i.test(compact(c))) ?? "";
  const emailRow = rows.find((cells) => cells.some((c) => /^e-?mail$/i.test(compact(c))));
  const phoneRow = rows.find((cells) => cells.some((c) => /^(h\.?p|휴대폰|연락처)$/i.test(compact(c))));
  if (!emailRow || !phoneRow || rows.length < 3) return null;
  const position = rows[0].find(Boolean) ?? "";
  const nameRow = rows[1] ?? [];
  const rank = nameRow.find((c) => RANKS.includes(compact(c))) ?? "";
  const name = compact(nameRow.filter((c) => c && compact(c) !== compact(rank)).pop() ?? "");
  if (!name) return null;
  return { rect, position, rank: compact(rank), name, email: compact(lastValue(emailRow)), phone: compact(lastValue(phoneRow)) };
}

export async function parseOrgPptx(data: ArrayBuffer | Uint8Array): Promise<OrgPptImportResult> {
  const zip = await JSZip.loadAsync(data);
  const slidePath = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => +a.match(/(\d+)\.xml$/)![1] - +b.match(/(\d+)\.xml$/)![1])[0];
  if (!slidePath) throw new Error("슬라이드를 찾지 못했습니다.");
  const xml = await zip.file(slidePath)!.async("string");
  const relsXml = (await zip.file(slidePath.replace("slides/", "slides/_rels/") + ".rels")?.async("string")) ?? "";
  const rels = new Map(Array.from(relsXml.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g), (m) => [m[1], m[2]]));

  const warnings: string[] = [];
  const people = (xml.match(/<p:graphicFrame[\s>][\s\S]*?<\/p:graphicFrame>/g) ?? [])
    .filter((f) => f.includes("<a:tbl>"))
    .map(parsePersonTable)
    .filter((p): p is PersonTable => p !== null);

  const shapes = (xml.match(/<p:sp[\s>][\s\S]*?<\/p:sp>/g) ?? [])
    .map((s) => ({ rect: rectOf(s), text: clean(textOf(s)) }))
    .filter((s): s is { rect: Rect; text: string } => s.rect !== null && s.text !== "");
  const headers = shapes
    .filter((s) => /^[가-힣A-Za-z]{1,6}팀$/.test(compact(s.text)))
    .map((s) => ({ ...s, name: `${compact(s.text).replace(/팀$/, "")} 팀` }))
    .sort((a, b) => a.rect.x - b.rect.x);
  const markers = shapes
    .map((s) => ({ ...s, key: compact(s.text).replace(/[()]/g, "") }))
    .filter((s) => s.key in MARKER_COLORS);
  const pics = (xml.match(/<p:pic[\s>][\s\S]*?<\/p:pic>/g) ?? [])
    .map((p) => ({ rect: rectOf(p), embed: p.match(/r:embed="([^"]+)"/)?.[1] ?? "" }))
    .filter((p): p is { rect: Rect; embed: string } => p.rect !== null && !!p.embed);

  const readPhoto = async (table: PersonTable): Promise<string> => {
    const pic = pics
      .filter((p) => inside(center(p.rect), table.rect, 120000))
      .sort((a, b) => a.rect.x - b.rect.x)[0];
    const target = pic && rels.get(pic.embed);
    if (!target) return "";
    const path = target.startsWith("/") ? target.slice(1) : `ppt/slides/${target}`.replace(/[^/]+\/\.\.\//g, "");
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const file = zip.file(path);
    if (!file || !IMAGE_MIME[ext]) return "";
    return `data:${IMAGE_MIME[ext]};base64,${await file.async("base64")}`;
  };

  const photos: Record<string, string> = {};
  const siteTable = people.find((p) => /소장/.test(p.position));
  let siteManager: PptOrgManager | null = null;
  if (siteTable) {
    siteManager = { name: siteTable.name, role: clean(siteTable.position), phone: siteTable.phone, email: siteTable.email, photo_url: "" };
    const ph = await readPhoto(siteTable);
    if (ph) photos["site-manager"] = ph;
  } else {
    warnings.push("현장소장 표를 찾지 못했습니다.");
  }

  if (!headers.length) throw new Error("팀 제목(예: 공사 팀)을 찾지 못했습니다. 본사 송부용 양식의 PPT인지 확인하세요.");
  const teams: PptOrgTeam[] = headers.map((h, i) => ({ id: `ppt-team-${i}`, name: h.name, color: TEAM_COLOR, sort_order: i }));

  const byTeam = new Map<string, PersonTable[]>();
  for (const p of people) {
    if (p === siteTable) continue;
    const c = center(p.rect);
    const candidates = headers.filter((h) => h.rect.y < p.rect.y);
    if (!candidates.length) continue;
    const nearest = candidates.reduce((best, h) => (Math.abs(center(h.rect).x - c.x) < Math.abs(center(best.rect).x - c.x) ? h : best));
    const teamId = teams[headers.indexOf(nearest)].id;
    byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), p]);
  }

  const members: PptOrgMember[] = [];
  for (const team of teams) {
    const list = (byTeam.get(team.id) ?? []).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const marker = markers.find((m) => inside(center(m.rect), p.rect));
      const id = `${team.id}-${i}`;
      members.push({
        id,
        team_id: team.id,
        name: p.name,
        position: clean(p.position),
        rank: p.rank,
        phone: p.phone,
        email: p.email,
        photo_url: "",
        is_leader: /팀장/.test(p.position),
        sort_order: i,
        ...(marker ? { border_color: MARKER_COLORS[marker.key] } : {}),
      });
      const ph = await readPhoto(p);
      if (ph) photos[id] = ph;
    }
  }
  if (!members.length) throw new Error("PPT에서 인원 표를 찾지 못했습니다.");
  return { siteManager, teams, members, photos, warnings };
}
