import { useState } from "react";
import { Clipboard, MessageSquare, NotebookText } from "lucide-react";
import { INQUIRY_MENU_OPTIONS, type InquiryMenu } from "@/lib/inquirySupport";

interface InquirySupportProps {
  activeMenu?: InquiryMenu;
  onMenuChange?: (menu: InquiryMenu) => void;
}

export default function InquirySupport({ activeMenu: controlledActiveMenu, onMenuChange }: InquirySupportProps) {
  const [internalActiveMenu, setInternalActiveMenu] = useState<InquiryMenu>("kakao");
  const activeMenu = controlledActiveMenu ?? internalActiveMenu;
  const showInternalMenu = controlledActiveMenu === undefined;

  const handleMenuChange = (menu: InquiryMenu) => {
    if (onMenuChange) onMenuChange(menu);
    else setInternalActiveMenu(menu);
  };

  return (
    <div className="space-y-4">
      {showInternalMenu && (
        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="grid grid-cols-2 gap-1 sm:w-[320px]">
            {INQUIRY_MENU_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleMenuChange(option.value)}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-extrabold transition-colors ${
                  activeMenu === option.value
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeMenu === "kakao" ? <KakaoInquiryPanel /> : <ManualInquiryPanel />}
    </div>
  );
}

function KakaoInquiryPanel() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-100 text-yellow-700">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-slate-950">카카오톡 문의</h2>
          <p className="text-sm font-semibold text-slate-400">카톡 문의 내용을 붙여넣고 답장 문구를 정리하는 공간입니다.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <textarea
          className="min-h-[320px] rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-400 focus:bg-white"
          placeholder="카카오톡으로 온 문의 내용을 여기에 붙여넣으세요."
        />
        <div className="min-h-[320px] rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-700">
            <Clipboard className="h-4 w-4" />
            답장 복붙 영역
          </div>
          <p className="text-sm font-semibold leading-6 text-slate-400">
            다음 단계에서 문의 정리, 답장 생성, 복사 버튼을 이 영역에 붙입니다.
          </p>
        </div>
      </div>
    </section>
  );
}

function ManualInquiryPanel() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          <NotebookText className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-slate-950">메뉴얼</h2>
          <p className="text-sm font-semibold text-slate-400">자주 오는 문의와 표준 답변을 정리하는 공간입니다.</p>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm font-semibold leading-6 text-slate-400">
        자주 쓰는 답변 양식과 현장별 안내 문구를 이 메뉴에 모을 수 있습니다.
      </div>
    </section>
  );
}
