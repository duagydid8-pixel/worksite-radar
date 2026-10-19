import { useEffect, useRef, useState } from "react";
import { Download, FileUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteOrgPptFS, loadOrgPptFilesFS, uploadOrgPptFS, type OrgPptFileMeta } from "@/lib/firestoreService";

interface Props {
  /** 조직도 현장 문서 id (예: org_head_office_p4_ph4) — 현장마다 PPT 하나씩 보관 */
  docId: string;
  siteLabel: string;
  /** 올린 PPT를 읽어 화면 조직도에 채운다 */
  onImport: (file: File) => Promise<void>;
}

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);

/** 본사 송부용 조직도: 앱에서 만든 PPT 대신 직접 만든 PPT 원본을 현장별로 올려 두고 내려받는다. */
export default function OrgPptUploadBar({ docId, siteLabel, onImport }: Props) {
  const [file, setFile] = useState<OrgPptFileMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    loadOrgPptFilesFS().then((files) => { if (!cancelled) setFile(files[docId] ?? null); });
    return () => { cancelled = true; };
  }, [docId]);

  const handleFile = async (picked: File | undefined) => {
    if (!picked) return;
    if (!/\.pptx$/i.test(picked.name)) { toast.error(".pptx 파일만 올릴 수 있습니다."); return; }
    if (picked.size >= 50 * 1024 * 1024) { toast.error("50MB 미만 파일만 올릴 수 있습니다."); return; }
    setBusy(true);
    try {
      // 1) PPT 내용을 화면 조직도에 반영 (브라우저 안에서 읽음)
      await onImport(picked);
    } catch (e) {
      setBusy(false);
      toast.error("PPT를 읽지 못했습니다.", { description: e instanceof Error ? e.message : undefined });
      return;
    }
    setBusy(false);
    // 2) 원본 파일도 뒤에서 보관 (실패해도 화면 반영은 유지, 30초 넘으면 포기)
    const meta = await Promise.race([
      uploadOrgPptFS(docId, picked),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 30000)),
    ]);
    if (meta) setFile(meta);
    else toast.info("화면에는 반영했지만 원본 PPT 파일 보관은 하지 못했습니다.");
  };

  const handleDelete = async () => {
    if (!file || !window.confirm(`${siteLabel}에 올린 "${file.name}"을(를) 삭제할까요?`)) return;
    setBusy(true);
    const ok = await deleteOrgPptFS(docId);
    setBusy(false);
    if (ok) { setFile(null); toast.success("올린 PPT를 삭제했습니다."); }
    else toast.error("삭제에 실패했습니다.");
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <span className="text-sm font-black text-slate-800">{siteLabel} 조직도 PPT 불러오기</span>
      {file ? (
        <>
          <span className="min-w-0 truncate text-xs font-semibold text-slate-600" title={file.name}>
            {file.name} · {formatSize(file.size)} · {file.uploadedAt.slice(0, 10)} 업로드
          </span>
          <a href={file.downloadUrl} download={file.name} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-700">
            <Download className="h-3.5 w-3.5" /> 내려받기
          </a>
          <button type="button" onClick={handleDelete} disabled={busy} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40">
            <Trash2 className="h-3.5 w-3.5" /> 삭제
          </button>
        </>
      ) : (
        <span className="text-xs text-slate-500">직접 만든 본사 송부용 PPT를 올리면 이름·직책·연락처·사진을 읽어 아래 조직도에 채웁니다. 확인 후 저장을 누르세요.</span>
      )}
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} {file ? "새 PPT로 교체" : "PPT 업로드"}
      </button>
      <input ref={inputRef} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="hidden" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}
