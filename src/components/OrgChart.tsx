import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Users, Plus, Trash2, Search, X, Download, Save, Loader2, Camera, Pencil } from "lucide-react";
import { toPng } from "html-to-image";

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
  const [teams, setTeams] = useState<OrgTeam[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editMember, setEditMember] = useState<OrgMember | null>(null);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [uploading, setUploading] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  /* ── load ── */
  useEffect(() => {
    (async () => {
      try {
        const [t, m] = await Promise.all([
          supabase.from("org_teams").select("*").order("sort_order"),
          supabase.from("org_members").select("*").order("sort_order"),
        ]);
        if (t.data) setTeams(t.data);
        if (m.data) setMembers(m.data);
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, []);

  /* ── save all ── */
  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    try {
      // upsert teams
      const { error: te } = await supabase.from("org_teams").upsert(teams, { onConflict: "id" });
      if (te) throw te;

      // delete removed members
      const existingIds = members.map((m) => m.id);
      if (existingIds.length > 0) {
        // fetch current DB member ids for these teams
        const teamIds = teams.map((t) => t.id);
        const { data: dbMembers } = await supabase.from("org_members").select("id").in("team_id", teamIds);
        const toDelete = (dbMembers || []).filter((d) => !existingIds.includes(d.id)).map((d) => d.id);
        if (toDelete.length > 0) {
          await supabase.from("org_members").delete().in("id", toDelete);
        }
      }

      // upsert members
      if (members.length > 0) {
        const { error: me } = await supabase.from("org_members").upsert(members, { onConflict: "id" });
        if (me) throw me;
      }

      // delete removed teams
      const teamIds = teams.map((t) => t.id);
      await supabase.from("org_teams").delete().not("id", "in", `(${teamIds.join(",")})`);

      setDirty(false);
      toast.success("조직도가 저장되었습니다.");
    } catch (err: any) {
      toast.error(`저장 실패: ${err.message}`);
    } finally { setSaving(false); }
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

  /* ── photo upload ── */
  const handlePhotoUpload = useCallback(async (memberId: string, file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${memberId}.${ext}`;
      const { error: upErr } = await supabase.storage.from("org-photos").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("org-photos").getPublicUrl(path);
      const url = data.publicUrl + "?t=" + Date.now();
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, photo_url: url } : m)));
      if (editMember?.id === memberId) setEditMember((prev) => prev ? { ...prev, photo_url: url } : null);
      setDirty(true);
      toast.success("사진이 업로드되었습니다.");
    } catch (err: any) {
      toast.error(`업로드 실패: ${err.message}`);
    } finally { setUploading(false); }
  }, [editMember]);

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

  if (loading) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

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
        <button onClick={handleExportImage} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors">
          <Download className="h-4 w-4" /> 이미지 저장
        </button>
        <button
          onClick={handleSaveAll}
          disabled={saving || !dirty}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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
          uploading={uploading}
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
