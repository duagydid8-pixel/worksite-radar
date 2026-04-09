import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { loadOrgFS, saveOrgFS } from "@/lib/firestoreService";
import { Users, Plus, Trash2, Search, X, Download, Save, Camera, Pencil, FileSpreadsheet } from "lucide-react";
import { toPng } from "html-to-image";
import * as XLSX from "xlsx";

/* ── types ── */
interface OrgTeam {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

interface OrgMember {
  id: string;
  team_id: string;
  name: string;
  position: string;
  rank: string;
  phone: string;
  email: string;
  photo_url: string;
  is_leader: boolean;
  sort_order: number;
}

const RANKS = ["수석", "책임", "선임", "사원"] as const;

const TEAM_COLORS = [
  "#2563eb", "#7c3aed", "#059669", "#dc2626", "#d97706",
  "#0891b2", "#be185d", "#4f46e5", "#15803d", "#b45309",
];

/* ── localStorage ── */
const ORG_STORAGE_KEY = "worksite_org_data";

interface OrgData { teams: OrgTeam[]; members: OrgMember[] }

const SEED_DATA: OrgData = {
  teams: [
    { id: "seed-team-1", name: "공무팀", color: "#2563eb", sort_order: 0 },
    { id: "seed-team-2", name: "공사팀", color: "#7c3aed", sort_order: 1 },
    { id: "seed-team-3", name: "품질팀", color: "#059669", sort_order: 2 },
    { id: "seed-team-4", name: "안전팀", color: "#dc2626", sort_order: 3 },
    { id: "seed-team-5", name: "설계팀", color: "#d97706", sort_order: 4 },
  ],
  members: [
    // 공무팀
    { id:"sm-01", team_id:"seed-team-1", name:"정두용", position:"팀장", rank:"수석", phone:"010-3499-5097", email:"dooyong@hscleantech.com", photo_url:"", is_leader:true,  sort_order:0 },
    { id:"sm-02", team_id:"seed-team-1", name:"이재호", position:"담당", rank:"수석", phone:"010-6566-4804", email:"hatbazi@hscleantech.com", photo_url:"", is_leader:false, sort_order:1 },
    { id:"sm-03", team_id:"seed-team-1", name:"이진식", position:"담당", rank:"책임", phone:"010-5037-5567", email:"jinsik@hscleantech.com", photo_url:"", is_leader:false, sort_order:2 },
    { id:"sm-04", team_id:"seed-team-1", name:"염효양", position:"담당", rank:"선임", phone:"010-2467-3241", email:"duagydid_@hscleantech.com", photo_url:"", is_leader:false, sort_order:3 },
    // 공사팀
    { id:"sm-05", team_id:"seed-team-2", name:"전제현", position:"팀장", rank:"수석", phone:"010-4542-8574", email:"jaehyun@hscleantech.com", photo_url:"", is_leader:true,  sort_order:0 },
    { id:"sm-06", team_id:"seed-team-2", name:"엄태원", position:"담당", rank:"수석", phone:"010-4044-3004", email:"utw3004@hscleantech.com", photo_url:"", is_leader:false, sort_order:1 },
    { id:"sm-07", team_id:"seed-team-2", name:"양선우", position:"서류",  rank:"선임", phone:"010-4953-3359", email:"iosyhcc@hscleantech.com", photo_url:"", is_leader:false, sort_order:2 },
    { id:"sm-08", team_id:"seed-team-2", name:"이중현", position:"차량",  rank:"선임", phone:"010-8695-8987", email:"wndgus77@nate.com",       photo_url:"", is_leader:false, sort_order:3 },
    // 품질팀
    { id:"sm-09", team_id:"seed-team-3", name:"오세현", position:"팀장", rank:"수석", phone:"010-9322-2664", email:"ippon@hscleantech.com",       photo_url:"", is_leader:true,  sort_order:0 },
    { id:"sm-10", team_id:"seed-team-3", name:"이형우", position:"담당", rank:"수석", phone:"010-2268-9990", email:"Nanlhweda@naver.com",          photo_url:"", is_leader:false, sort_order:1 },
    { id:"sm-11", team_id:"seed-team-3", name:"박재형", position:"담당", rank:"책임", phone:"010-9285-7676", email:"upwquality@hscleantech.com",   photo_url:"", is_leader:false, sort_order:2 },
    { id:"sm-12", team_id:"seed-team-3", name:"김성덕", position:"담당", rank:"책임", phone:"010-2442-0069", email:"upwquality@hscleantech.com",   photo_url:"", is_leader:false, sort_order:3 },
    { id:"sm-13", team_id:"seed-team-3", name:"강태길", position:"담당", rank:"책임", phone:"010-6480-2263", email:"taegil@hscleantech.com",       photo_url:"", is_leader:false, sort_order:4 },
    { id:"sm-14", team_id:"seed-team-3", name:"안형철", position:"서류",  rank:"선임", phone:"010-8277-7514", email:"upwquality@hscleantech.com",   photo_url:"", is_leader:false, sort_order:5 },
    { id:"sm-15", team_id:"seed-team-3", name:"박슬기", position:"서류",  rank:"선임", phone:"010-5062-3217", email:"sg3217@hscleantech.com",       photo_url:"", is_leader:false, sort_order:6 },
    // 안전팀
    { id:"sm-16", team_id:"seed-team-4", name:"윤근희", position:"팀장", rank:"수석", phone:"010-8008-2681", email:"ghyoon@hscleantech.com",      photo_url:"", is_leader:true,  sort_order:0 },
    { id:"sm-17", team_id:"seed-team-4", name:"곽희규", position:"서류",  rank:"책임", phone:"010-5865-4584", email:"heekyu@hscleantech.com",       photo_url:"", is_leader:false, sort_order:1 },
    { id:"sm-18", team_id:"seed-team-4", name:"조성진", position:"담당", rank:"책임", phone:"010-6575-9539", email:"upwsafety@hscleantech.com",    photo_url:"", is_leader:false, sort_order:2 },
    { id:"sm-19", team_id:"seed-team-4", name:"원영섭", position:"담당", rank:"책임", phone:"010-7696-2269", email:"dudtjq122@hscleantech.com",    photo_url:"", is_leader:false, sort_order:3 },
    { id:"sm-20", team_id:"seed-team-4", name:"양준용", position:"담당", rank:"선임", phone:"010-3020-8418", email:"did8418@hscleantech.com",      photo_url:"", is_leader:false, sort_order:4 },
    // 설계팀
    { id:"sm-21", team_id:"seed-team-5", name:"이대용", position:"팀장", rank:"수석", phone:"010-6213-3902", email:"daeyong@hscleantech.com",     photo_url:"", is_leader:true,  sort_order:0 },
    { id:"sm-22", team_id:"seed-team-5", name:"박세일", position:"담당", rank:"수석", phone:"010-9959-8992", email:"psw062@hscleantech.com",       photo_url:"", is_leader:false, sort_order:1 },
    { id:"sm-23", team_id:"seed-team-5", name:"전종수", position:"담당", rank:"수석", phone:"010-2840-7163", email:"jongsoo@hscleantech.com",      photo_url:"", is_leader:false, sort_order:2 },
    { id:"sm-24", team_id:"seed-team-5", name:"이호기", position:"담당", rank:"수석", phone:"010-2840-7163", email:"jongsoo@hscleantech.com",      photo_url:"", is_leader:false, sort_order:3 },
    { id:"sm-25", team_id:"seed-team-5", name:"소영성", position:"담당", rank:"책임", phone:"010-8501-6881", email:"soyy99@hscleantech.com",       photo_url:"", is_leader:false, sort_order:4 },
    { id:"sm-26", team_id:"seed-team-5", name:"신동건", position:"담당", rank:"선임", phone:"010-8747-6786", email:"donggeon@hscleantech.com",     photo_url:"", is_leader:false, sort_order:5 },
  ],
};

function loadOrgFromStorage(): OrgData {
  try {
    const saved = localStorage.getItem(ORG_STORAGE_KEY);
    if (saved) {
      const parsed: OrgData = JSON.parse(saved);
      // teams가 1개 이상 있어야 유효한 데이터로 인정
      if (Array.isArray(parsed.teams) && parsed.teams.length > 0 && Array.isArray(parsed.members)) {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  // 저장된 데이터 없거나 비어있으면 시드 데이터 저장 후 반환
  localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(SEED_DATA));
  return SEED_DATA;
}

function saveOrgToStorage(data: OrgData) {
  localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(data));
}

/* ── helpers ── */
function lighten(hex: string, pct: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = pct / 100;
  return `rgb(${Math.round(r + (255 - r) * f)}, ${Math.round(g + (255 - g) * f)}, ${Math.round(b + (255 - b) * f)})`;
}

/* ━━━━━━━━━━━━━━━ EDIT DIALOG ━━━━━━━━━━━━━━━ */
function EditDialog({
  member,
  onSave,
  onClose,
  onPhotoUpload,
  uploading,
}: {
  member: OrgMember;
  onSave: (m: OrgMember) => void;
  onClose: () => void;
  onPhotoUpload: (memberId: string, file: File) => void;
  uploading: boolean;
}) {
  const [draft, setDraft] = useState<OrgMember>({ ...member });
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof OrgMember, v: string | boolean) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">인원 정보 수정</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Photo */}
          <div className="flex items-center gap-4">
            <div className="relative group">
              {draft.photo_url ? (
                <img src={draft.photo_url} className="w-16 h-16 rounded-full object-cover border-2 border-border" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-lg font-bold border-2 border-border">
                  {draft.name.slice(0, 1) || "?"}
                </div>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {uploading ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Camera className="h-5 w-5 text-white" />}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPhotoUpload(draft.id, f);
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">클릭하여 사진 업로드</p>
          </div>

          {/* Fields */}
          {([
            ["이름", "name", "text"],
            ["직책", "position", "text"],
            ["연락처", "phone", "tel"],
            ["이메일", "email", "email"],
          ] as const).map(([label, key, type]) => (
            <label key={key} className="block">
              <span className="text-xs font-semibold text-muted-foreground">{label}</span>
              <input
                type={type}
                value={draft[key]}
                onChange={(e) => set(key, e.target.value)}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </label>
          ))}

          {/* Rank */}
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">직급</span>
            <select
              value={draft.rank}
              onChange={(e) => set("rank", e.target.value)}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
            >
              {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>

          {/* Leader toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.is_leader}
              onChange={(e) => set("is_leader", e.target.checked)}
              className="rounded border-border"
            />
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
                <button key={c} onClick={() => setColor(c)} className="w-8 h-8 rounded-full border-2 transition-all" style={{ backgroundColor: c, borderColor: color === c ? "#111" : "transparent", transform: color === c ? "scale(1.15)" : "scale(1)" }} />
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-muted">취소</button>
          <button disabled={!name.trim()} onClick={() => { onAdd(name.trim(), color); onClose(); }} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 disabled:opacity-40">추가</button>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━ MAIN ━━━━━━━━━━━━━━━ */
export default function OrgChart() {
  const [teams, setTeams] = useState<OrgTeam[]>(() => loadOrgFromStorage().teams);
  const [members, setMembers] = useState<OrgMember[]>(() => loadOrgFromStorage().members);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editMember, setEditMember] = useState<OrgMember | null>(null);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  // 마운트 시 Firestore에서 로드 (localStorage는 즉시 렌더링용 캐시)
  useEffect(() => {
    loadOrgFS().then((data) => {
      if (data && Array.isArray(data.teams) && data.teams.length > 0) {
        setTeams(data.teams as OrgTeam[]);
        setMembers(data.members as OrgMember[]);
        saveOrgToStorage({ teams: data.teams as OrgTeam[], members: data.members as OrgMember[] });
      }
    });
  }, []);

  // 팀/멤버 변경 시 localStorage 자동 동기화
  useEffect(() => {
    saveOrgToStorage({ teams, members });
  }, [teams, members]);

  /* ── save all ── */
  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    const ok = await saveOrgFS({ teams, members });
    if (ok) {
      saveOrgToStorage({ teams, members });
      setDirty(false);
      toast.success("조직도가 저장되었습니다.");
    } else {
      toast.error("Firestore 저장 실패 (네트워크 확인)");
    }
    setSaving(false);
  }, [teams, members]);

  /* ── add team ── */
  const handleAddTeam = useCallback((name: string, color: string) => {
    const newTeam: OrgTeam = {
      id: crypto.randomUUID(),
      name,
      color,
      sort_order: teams.length,
    };
    setTeams((prev) => [...prev, newTeam]);
    // add a default leader
    setMembers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        team_id: newTeam.id,
        name: "이름 입력",
        position: "팀장",
        rank: "책임",
        phone: "",
        email: "",
        photo_url: "",
        is_leader: true,
        sort_order: 0,
      },
    ]);
    setDirty(true);
  }, [teams]);

  /* ── delete team ── */
  const handleDeleteTeam = useCallback((teamId: string) => {
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
    setMembers((prev) => prev.filter((m) => m.team_id !== teamId));
    setDirty(true);
  }, []);

  /* ── add member ── */
  const handleAddMember = useCallback((teamId: string) => {
    const count = members.filter((m) => m.team_id === teamId).length;
    setMembers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        team_id: teamId,
        name: "이름 입력",
        position: "담당자",
        rank: "사원",
        phone: "",
        email: "",
        photo_url: "",
        is_leader: false,
        sort_order: count,
      },
    ]);
    setDirty(true);
  }, [members]);

  /* ── delete member ── */
  const handleDeleteMember = useCallback((memberId: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    setDirty(true);
  }, []);

  /* ── update member from dialog ── */
  const handleMemberSave = useCallback((updated: OrgMember) => {
    setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setEditMember(null);
    setDirty(true);
  }, []);

  /* ── photo upload (base64 → localStorage) ── */
  const handlePhotoUpload = useCallback((memberId: string, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, photo_url: dataUrl } : m)));
      setEditMember((prev) => prev?.id === memberId ? { ...prev, photo_url: dataUrl } : prev);
      setDirty(true);
      toast.success("사진이 저장되었습니다.");
    };
    reader.readAsDataURL(file);
  }, []);

  /* ── export image ── */
  const handleExportImage = useCallback(async () => {
    if (!chartRef.current) return;
    try {
      const dataUrl = await toPng(chartRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = "조직도.png";
      link.href = dataUrl;
      link.click();
      toast.success("이미지가 저장되었습니다.");
    } catch {
      toast.error("이미지 저장 실패");
    }
  }, []);

  /* ── export excel ── */
  const handleExportExcel = useCallback(() => {
    if (teams.length === 0) { toast.error("내보낼 조직도 데이터가 없습니다."); return; }
    const headers = ["팀명", "직급", "이름", "이메일", "연락처"];
    const rows: string[][] = [headers];

    // 팀 순서대로, 각 팀 내 팀장 먼저
    for (const team of [...teams].sort((a, b) => a.sort_order - b.sort_order)) {
      const teamMembers = members.filter((m) => m.team_id === team.id);
      const leaders = teamMembers.filter((m) => m.is_leader).sort((a, b) => a.sort_order - b.sort_order);
      const others = teamMembers.filter((m) => !m.is_leader).sort((a, b) => a.sort_order - b.sort_order);
      for (const m of [...leaders, ...others]) {
        rows.push([team.name, m.rank, m.name, m.email || "", m.phone || ""]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 26 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "조직도");
    const d = new Date();
    const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
    XLSX.writeFile(wb, `조직도_${dateStr}.xlsx`);
    toast.success("엑셀로 내보냈습니다.");
  }, [teams, members]);

  /* ── filtered data ── */
  const filteredTeams = useMemo(() => {
    if (!searchQuery.trim()) return teams;
    const q = searchQuery.trim();
    const matchedTeamIds = new Set(members.filter((m) => m.name.includes(q)).map((m) => m.team_id));
    return teams.filter((t) => matchedTeamIds.has(t.id));
  }, [teams, members, searchQuery]);

  const getMembersForTeam = useCallback(
    (teamId: string) => {
      let mems = members.filter((m) => m.team_id === teamId);
      if (searchQuery.trim()) mems = mems.filter((m) => m.name.includes(searchQuery.trim()));
      const leaders = mems.filter((m) => m.is_leader).sort((a, b) => a.sort_order - b.sort_order);
      const others = mems.filter((m) => !m.is_leader).sort((a, b) => a.sort_order - b.sort_order);
      return { leaders, others };
    },
    [members, searchQuery],
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold text-foreground">조직도</h2>
        </div>

        {/* Search */}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="이름 검색..."
            className="bg-white border border-border rounded-lg pl-8 pr-8 py-2 text-sm w-48 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Actions */}
        <button onClick={() => setShowAddTeam(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors">
          <Plus className="h-4 w-4" /> 팀 추가
        </button>
        <button onClick={handleExportExcel} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors">
          <FileSpreadsheet className="h-4 w-4" /> 엑셀 내보내기
        </button>
        <button onClick={handleExportImage} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors">
          <Download className="h-4 w-4" /> 이미지 저장
        </button>
        <button
          onClick={handleSaveAll}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          <Save className="h-4 w-4" />
          {saving ? "저장 중..." : "변경사항 저장"}
        </button>
      </div>

      {/* Chart grid */}
      <div ref={chartRef} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 p-1">
        {filteredTeams.map((team) => {
          const { leaders, others } = getMembersForTeam(team.id);

          return (
            <div
              key={team.id}
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: lighten(team.color, 60), backgroundColor: lighten(team.color, 92) }}
            >
              {/* Team header */}
              <div className="px-4 py-2.5 flex items-center gap-2" style={{ backgroundColor: team.color }}>
                <span className="text-sm font-bold text-white">{team.name}</span>
                <span className="text-xs text-white/70 ml-auto">{leaders.length + others.length}명</span>
                <button onClick={() => handleDeleteTeam(team.id)} className="text-white/60 hover:text-white ml-1" title="팀 삭제">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                {/* Leaders */}
                {leaders.map((m) => (
                  <MemberCard key={m.id} member={m} color={team.color} isLeader onEdit={() => setEditMember(m)} onDelete={() => handleDeleteMember(m.id)} />
                ))}

                {others.length > 0 && (
                  <>
                    <div className="flex justify-center">
                      <div className="w-px h-4" style={{ backgroundColor: lighten(team.color, 60) }} />
                    </div>
                    <div className="space-y-2 pl-4 border-l-2" style={{ borderColor: lighten(team.color, 60) }}>
                      {others.map((m) => (
                        <MemberCard key={m.id} member={m} color={team.color} onEdit={() => setEditMember(m)} onDelete={() => handleDeleteMember(m.id)} />
                      ))}
                    </div>
                  </>
                )}

                {/* Add member button */}
                <button
                  onClick={() => handleAddMember(team.id)}
                  className="w-full py-2 rounded-lg border-2 border-dashed text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                  style={{ borderColor: lighten(team.color, 60) }}
                >
                  + 인원 추가
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {filteredTeams.length === 0 && searchQuery && (
        <div className="py-12 text-center">
          <Search className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-semibold text-muted-foreground">"{searchQuery}" 검색 결과 없음</p>
        </div>
      )}

      {/* Dialogs */}
      {editMember && (
        <EditDialog
          member={editMember}
          onSave={handleMemberSave}
          onClose={() => setEditMember(null)}
          onPhotoUpload={handlePhotoUpload}
          uploading={false}
        />
      )}
      {showAddTeam && (
        <AddTeamDialog
          onAdd={handleAddTeam}
          onClose={() => setShowAddTeam(false)}
          usedColors={teams.map((t) => t.color)}
        />
      )}
    </div>
  );
}

/* ── Member Card ── */
function MemberCard({
  member,
  color,
  isLeader,
  onEdit,
  onDelete,
}: {
  member: OrgMember;
  color: string;
  isLeader?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-3 bg-white border rounded-xl px-3 py-2.5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      style={{ borderColor: isLeader ? color : "#e5e7eb" }}
      onClick={onEdit}
    >
      {member.photo_url ? (
        <img src={member.photo_url} className="w-9 h-9 rounded-full object-cover border border-border shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: color }}>
          {member.name.slice(0, 1)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground leading-tight truncate">{member.name}</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: lighten(color, 85), color }}>{member.rank}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate">{member.position}</p>
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1 rounded hover:bg-muted">
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 rounded hover:bg-red-50">
          <Trash2 className="h-3.5 w-3.5 text-red-400" />
        </button>
      </div>
    </div>
  );
}
