import { useCallback, useState } from "react";
import { Upload, FileSpreadsheet, X } from "lucide-react";

interface FileUploadZoneProps {
  onFileLoaded: (buffer: ArrayBuffer) => void;
  fileName: string | null;
  onClear: () => void;
  onFileName: (name: string) => void;
}

export default function FileUploadZone({ onFileLoaded, fileName, onClear, onFileName }: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    onFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) onFileLoaded(e.target.result as ArrayBuffer);
    };
    reader.readAsArrayBuffer(file);
  }, [onFileLoaded, onFileName]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  if (fileName) {
    return (
      <div className="flex h-11 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4">
        <FileSpreadsheet className="h-5 w-5 text-slate-500" />
        <span className="truncate text-sm font-bold text-slate-800">{fileName}</span>
        <button onClick={onClear} className="ml-auto text-slate-400 transition-colors hover:text-slate-900">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      className={`relative flex h-11 cursor-pointer flex-row items-center justify-center gap-2 rounded-lg border border-dashed px-4 transition-colors ${
        isDragging ? "border-slate-500 bg-slate-100" : "border-slate-300 bg-slate-50 hover:border-slate-400"
      }`}
    >
      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={onInputChange}
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
      <Upload className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="flex items-center gap-1">
        <p className="text-sm font-bold text-slate-800">엑셀 파일 업로드</p>
        <p className="text-xs font-semibold text-slate-400">(.xlsx)</p>
      </div>
    </div>
  );
}
