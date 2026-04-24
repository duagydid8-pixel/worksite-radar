import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { loadOrgFS, saveOrgFS } from "@/lib/firestoreService";
import { Plus, Trash2, Search, X, Download, Save, Camera, Pencil, FileSpreadsheet, Loader2 } from "lucide-react";
import { toPng } from "html-to-image";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";

/* ── types ── */
interface OrgTeam { id: string; name: string; color: string; sort_order: number; }
interface OrgMember { id: string; team_id: string; name: string; position: string; rank: string; phone: string; email: string; photo_url: string; is_leader: boolean; sort_order: number; }
interface SiteManagerInfo { name: string; phone: string; email: string; photo_url: string; }
interface OrgData { teams: OrgTeam[]; members: OrgMember[]; siteManager?: SiteManagerInfo; }

const RANKS = ["수석", "책임", "선임", "사원"] as const;
const TEAM_COLORS = ["#2563eb", "#7c3aed", "#059669", "#dc2626", "#d97706", "#0891b2", "#be185d", "#4f46e5", "#15803d", "#b45309"];
const DEFAULT_SM: SiteManagerInfo = { name: "현장소장", phone: "", email: "", photo_url: "" };

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

function lighten(hex: string, pct: number) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16), f = pct/100;
  return `rgb(${Math.round(r+(255-r)*f)},${Math.round(g+(255-g)*f)},${Math.round(b+(255-b)*f)})`;
}

/* ━━━━━━━━━━━━━━━ SITE MANAGER EDIT DIALOG ━━━━━━━━━━━━━━━ */
function SiteManagerEditDialog({ info, onSave, onClose }: { info: SiteManagerInfo; onSave: (i: SiteManagerInfo) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<SiteManagerInfo>({ ...info });
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold">현장소장 정보 수정</h3>
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
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const reader = new FileReader();
                reader.onload = (ev) => setDraft((d) => ({ ...d, photo_url: ev.target?.result as string }));
                reader.readAsDataURL(f);
                e.target.value = "";
              }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">클릭하여 사진 업로드</p>
              {draft.photo_url && (
                <button
                  onClick={() => setDraft((d) => ({ ...d, photo_url: "" }))}
                  className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-700 font-medium transition-colors"
                >
                  <X className="h-3 w-3" /> 사진 삭제
                </button>
              )}
            </div>
          </div>
          {([ ["이름","name"], ["연락처","phone"], ["이메일","email"] ] as const).map(([label, key]) => (
            <label key={key} className="block">
              <span className="text-xs font-semibold text-muted-foreground">{label}</span>
              <input value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
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
function EditDialog({ member, onSave, onClose, onPhotoUpload, onPhotoRemove, uploading }: { member: OrgMember; onSave: (m: OrgMember) => void; onClose: () => void; onPhotoUpload: (memberId: string, file: File) => void; onPhotoRemove: (memberId: string) => void; uploading: boolean }) {
  const [draft, setDraft] = useState<OrgMember>({ ...member });
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof OrgMember, v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));
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
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhotoUpload(draft.id, f); e.target.value = ""; }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">클릭하여 사진 업로드</p>
              {draft.photo_url && (
                <button
                  onClick={() => { onPhotoRemove(draft.id); setDraft((d) => ({ ...d, photo_url: "" })); }}
                  className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-700 font-medium transition-colors"
                >
                  <X className="h-3 w-3" /> 사진 삭제
                </button>
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
export default function OrgChart() {
  const [teams, setTeams] = useState<OrgTeam[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [siteManager, setSiteManager] = useState<SiteManagerInfo>(DEFAULT_SM);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editMember, setEditMember] = useState<OrgMember | null>(null);
  const [editSiteManager, setEditSiteManager] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadOrgFS().then((data) => {
      if (data && Array.isArray((data as OrgData).teams) && (data as OrgData).teams.length > 0) {
        const d = data as OrgData;
        setTeams(d.teams); setMembers(d.members);
        if (d.siteManager) setSiteManager(d.siteManager);
      } else {
        setTeams(SEED_DATA.teams); setMembers(SEED_DATA.members);
      }
    });
  }, []);

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    const ok = await saveOrgFS({ teams, members, siteManager });
    if (ok) { setDirty(false); toast.success("조직도가 저장되었습니다."); }
    else toast.error("Firestore 저장 실패 (네트워크 확인)");
    setSaving(false);
  }, [teams, members, siteManager]);

  const handleAddTeam = useCallback((name: string, color: string) => {
    const newTeam: OrgTeam = { id: crypto.randomUUID(), name, color, sort_order: teams.length };
    setTeams((prev) => [...prev, newTeam]);
    setMembers((prev) => [...prev, { id: crypto.randomUUID(), team_id: newTeam.id, name: "이름 입력", position: "팀장", rank: "책임", phone: "", email: "", photo_url: "", is_leader: true, sort_order: 0 }]);
    setDirty(true);
  }, [teams]);

  const handleDeleteTeam = useCallback((teamId: string) => {
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
    setMembers((prev) => prev.filter((m) => m.team_id !== teamId));
    setDirty(true);
  }, []);

  const handleAddMember = useCallback((teamId: string) => {
    const count = members.filter((m) => m.team_id === teamId).length;
    setMembers((prev) => [...prev, { id: crypto.randomUUID(), team_id: teamId, name: "이름 입력", position: "담당자", rank: "사원", phone: "", email: "", photo_url: "", is_leader: false, sort_order: count }]);
    setDirty(true);
  }, [members]);

  const handleDeleteMember = useCallback((memberId: string) => { setMembers((prev) => prev.filter((m) => m.id !== memberId)); setDirty(true); }, []);

  const handleMemberSave = useCallback((updated: OrgMember) => { setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m))); setEditMember(null); setDirty(true); }, []);

  const handleSiteManagerSave = useCallback((info: SiteManagerInfo) => { setSiteManager(info); setDirty(true); }, []);

  const handlePhotoRemove = useCallback(async (memberId: string) => {
    const nextMembers = members.map((m) => (m.id === memberId ? { ...m, photo_url: "" } : m));
    setMembers(nextMembers);
    const ok = await saveOrgFS({ teams, members: nextMembers, siteManager });
    if (ok) { setDirty(false); toast.success("사진이 삭제되었습니다."); }
    else { setDirty(true); toast.error("저장 실패 — 저장 버튼을 눌러주세요."); }
  }, [members, teams, siteManager]);

  const handlePhotoUpload = useCallback(async (memberId: string, file: File) => {
    try {
      const dataUrl = await compressImage(file);
      const nextMembers = members.map((m) => (m.id === memberId ? { ...m, photo_url: dataUrl } : m));
      setMembers(nextMembers);
      setEditMember((prev) => prev?.id === memberId ? { ...prev, photo_url: dataUrl } : prev);
      // 즉시 Firestore 저장
      const ok = await saveOrgFS({ teams, members: nextMembers, siteManager });
      if (ok) {
        setDirty(false);
        toast.success("사진이 저장되었습니다.");
      } else {
        setDirty(true);
        toast.error("사진 저장 실패 — 저장 버튼을 눌러주세요.");
      }
    } catch {
      toast.error("사진을 불러오는 중 오류가 발생했습니다.");
    }
  }, [members, teams, siteManager]);

  const handleExportImage = useCallback(async () => {
    if (!chartRef.current) return;
    try {
      const dataUrl = await toPng(chartRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const link = document.createElement("a"); link.download = "조직도.png"; link.href = dataUrl; link.click();
      toast.success("이미지가 저장되었습니다.");
    } catch { toast.error("이미지 저장 실패"); }
  }, []);

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
  const totalMembers = members.length;
  const leaderCount = members.filter((m) => m.is_leader).length;

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
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold text-slate-950">조직도</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">{totalMembers}명</span>
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500">팀 {teams.length}개 · 팀장 {leaderCount}명</p>
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
            <button onClick={handleExportExcel} className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50">
              <FileSpreadsheet className="h-3.5 w-3.5" /> 엑셀
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

      {/* Org chart */}
      <div ref={chartRef} className="rounded-2xl border border-slate-200 bg-slate-100/70 p-4 shadow-sm">

        {/* 현장소장 */}
        <div className="flex justify-center mb-5">
          <CompactSiteManagerNode info={siteManager} onEdit={() => setEditSiteManager(true)} />
        </div>

        {/* Connector: vertical + horizontal bar */}
        {sortedTeams.length > 0 && (
          <div className="relative hidden justify-around mb-0 px-[calc(100%/(var(--n)*2))] lg:flex"
            style={{ "--n": sortedTeams.length } as React.CSSProperties}>
            <div className="absolute left-1/2 -translate-x-1/2 -top-5 w-px h-5 bg-slate-300" />
            <div className="absolute top-0 left-[calc(100%/(var(--n)*2))] right-[calc(100%/(var(--n)*2))] h-px bg-slate-300" />
            {sortedTeams.map((t) => (
              <div key={t.id} className="flex-1 flex justify-center">
                <div className="w-px h-4 bg-slate-300" />
              </div>
            ))}
          </div>
        )}

        {/* Teams row */}
        {sortedTeams.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            {sortedTeams.map((team) => {
              const { leader, others } = getMembersForTeam(team.id);
              return (
                <div key={team.id} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  {/* Team header */}
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-7 w-1 rounded-full" style={{ backgroundColor: team.color }} />
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-extrabold text-slate-900">{team.name}</span>
                        <span className="text-[10px] font-bold text-slate-400">{(leader ? 1 : 0) + others.length}명</span>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteTeam(team.id)}
                      className="shrink-0 rounded-md p-1.5 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Leader */}
                  {leader ? (
                    <div className="border-b border-slate-100 bg-slate-50">
                      <CompactRow member={leader} color={team.color} isLeader
                        onEdit={() => setEditMember(leader)}
                        onDelete={() => handleDeleteMember(leader.id)} />
                    </div>
                  ) : (
                    <div className="border-b border-slate-100 px-3 py-3 text-xs font-semibold text-slate-400">팀장 없음</div>
                  )}

                  {/* Members */}
                  {others.length > 0 && (
                    <div className="divide-y divide-slate-100">
                      {others.map((m) => (
                        <CompactRow key={m.id} member={m} color={team.color}
                          onEdit={() => setEditMember(m)}
                          onDelete={() => handleDeleteMember(m.id)} />
                      ))}
                    </div>
                  )}

                  {/* Add member */}
                  <button onClick={() => handleAddMember(team.id)}
                    className="w-full border-t border-dashed border-slate-200 px-3 py-2 text-center text-[11px] font-bold text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700">
                    + 인원 추가
                  </button>
                </div>
              );
            })}

            {/* Add team */}
            <button onClick={() => setShowAddTeam(true)}
              className="flex min-h-[160px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-white text-slate-400 transition-colors hover:border-slate-400 hover:text-slate-600">
              <Plus className="h-4 w-4" />
              <span className="text-[10px] font-semibold">팀 추가</span>
            </button>
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

      {filteredTeams.length === 0 && searchQuery && (
        <div className="py-10 text-center">
          <Search className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">"{searchQuery}" 검색 결과 없음</p>
        </div>
      )}

      {editSiteManager && <SiteManagerEditDialog info={siteManager} onSave={handleSiteManagerSave} onClose={() => setEditSiteManager(false)} />}
      {editMember && <EditDialog member={editMember} onSave={handleMemberSave} onClose={() => setEditMember(null)} onPhotoUpload={handlePhotoUpload} onPhotoRemove={handlePhotoRemove} uploading={false} />}
      {showAddTeam && <AddTeamDialog onAdd={handleAddTeam} onClose={() => setShowAddTeam(false)} usedColors={teams.map((t) => t.color)} />}
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
function CompactSiteManagerNode({ info, onEdit }: { info: SiteManagerInfo; onEdit: () => void }) {
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
        <p className="mb-0.5 text-[10px] font-extrabold tracking-wide text-slate-400">현장소장</p>
        <p className="truncate text-sm font-extrabold leading-tight text-slate-900">{info.name}</p>
        {info.phone && <p className="mt-0.5 text-[10px] font-medium text-slate-400">{info.phone}</p>}
      </div>
      <Pencil className="ml-1 h-3.5 w-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
