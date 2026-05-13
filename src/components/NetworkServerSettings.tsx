import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Save, RotateCcw } from "lucide-react";

interface Props {
  label: string;
  defaultUrl: string;
  currentUrl: string;
  port: number;
  onSave: (url: string) => void;
}

export default function NetworkServerSettings({ label, defaultUrl, currentUrl, port, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [inputUrl, setInputUrl] = useState(currentUrl !== defaultUrl ? currentUrl : "");

  const isCustom = currentUrl !== defaultUrl;

  const handleSave = () => {
    const url = inputUrl.trim().replace(/\/$/, "") || defaultUrl;
    onSave(url);
  };

  const handleReset = () => {
    setInputUrl("");
    onSave(defaultUrl);
  };

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-extrabold text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
      >
        <span className="flex items-center gap-1.5">
          다른 PC에서 사용하기
          {isCustom && (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-black text-blue-700">
              원격 서버
            </span>
          )}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="border-t border-slate-200 px-3 py-3 space-y-3">
          <div className="rounded-md bg-blue-50 border border-blue-200 p-2.5 text-xs font-semibold text-blue-900 space-y-1">
            <p className="font-extrabold">주 PC에서 먼저 실행:</p>
            <code className="block rounded bg-blue-100 px-2 py-1 font-mono">npm run dev:network</code>
            <p className="font-extrabold mt-2">그 다음 이 PC에서:</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-800">
              <li>
                터미널에 표시된{" "}
                <span className="font-black">
                  https://주PC_IP:{port}/status
                </span>{" "}
                를 새 탭에서 열고
              </li>
              <li>
                <span className="font-black">고급 → 계속 진행</span>을 클릭해 인증서 수락
              </li>
              <li>아래에 주소 입력 후 저장</li>
            </ol>
          </div>

          <div>
            <label className="block text-xs font-extrabold text-slate-500 mb-1">
              {label} 서버 주소
            </label>
            <div className="flex gap-2">
              <input
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder={`https://192.168.x.x:${port}`}
                className="flex-1 h-8 rounded border border-slate-200 bg-white px-2 text-xs font-mono text-slate-900 outline-none focus:border-blue-500"
              />
              {inputUrl && (
                <a
                  href={`${inputUrl.trim()}/status`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-xs font-extrabold text-slate-600 hover:bg-slate-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  열기
                </a>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-blue-600 px-3 text-xs font-extrabold text-white hover:bg-blue-700"
            >
              <Save className="h-3.5 w-3.5" />
              저장
            </button>
            {isCustom && (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                로컬로 되돌리기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
