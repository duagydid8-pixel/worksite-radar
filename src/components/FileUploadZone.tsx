import { useCallback, useState } from "react";
import { Upload, FileSpreadsheet, X } from "lucide-react";

interface FileUploadZoneProps {
  onFileLoaded: (buffer: ArrayBuffer) => void;
  fileName: string | null;
  onClear: () => void;
  onFileName: (name: string) => void;
}

export default function FileUploadZone({ onFileLoaded, fileName, onClear }: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) onFileLoaded(e.target.result as ArrayBuffer);
    };
    reader.readAsArrayBuffer(file);
  }, [onFileLoaded]);

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
      <div className="flex items-center gap-3 rounded-lg bg-card px-4 py-3">
        <FileSpreadsheet className="h-5 w-5 text-primary" />
        <span className="text-sm text-foreground font-medium">{fileName}</span>
        <button onClick={onClear} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
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
      className={`relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-10 transition-colors cursor-pointer ${
        isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"
      }`}
    >
      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={onInputChange}
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
      <Upload className="h-8 w-8 text-muted-foreground" />
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">엑셀 파일을 드래그하거나 클릭하여 업로드</p>
        <p className="text-xs text-muted-foreground mt-1">.xlsx 파일만 지원</p>
      </div>
    </div>
  );
}
