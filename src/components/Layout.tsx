import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  Home,
  ClipboardList,
  CalendarDays,
  GitBranch,
  Database,
  CalendarRange,
  Users,
  Calculator,
  Scissors,
  LogOut,
  KeyRound,
  Lock,
} from "lucide-react";
import { useUI } from "@/hooks/useUI";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";

interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  path: string;
  adminOnly: boolean;
}

const NAV_PUBLIC: NavItem[] = [
  { key: "홈", label: "홈", icon: <Home className="h-4 w-4" />, path: "/", adminOnly: false },
  { key: "근태보고", label: "근태보고", icon: <ClipboardList className="h-4 w-4" />, path: "/attendance", adminOnly: false },
  { key: "연차관리", label: "연차관리", icon: <CalendarDays className="h-4 w-4" />, path: "/leave", adminOnly: false },
  { key: "조직도", label: "조직도", icon: <GitBranch className="h-4 w-4" />, path: "/org-chart", adminOnly: false },
];

const NAV_SEMI_PUBLIC: NavItem[] = [
  { key: "XERP&PMIS", label: "XERP & PMIS", icon: <Database className="h-4 w-4" />, path: "/xerp", adminOnly: false },
];

const NAV_ADMIN: NavItem[] = [
  { key: "주간일정", label: "주간일정", icon: <CalendarRange className="h-4 w-4" />, path: "/weekly-schedule", adminOnly: true },
  { key: "신규자명단", label: "기술인 및 관리자 명단", icon: <Users className="h-4 w-4" />, path: "/new-employees", adminOnly: true },
  { key: "XERP공수반영", label: "XERP 공수 반영", icon: <Calculator className="h-4 w-4" />, path: "/xerp-reflection", adminOnly: true },
  { key: "PDF분리", label: "PDF 분리 도구", icon: <Scissors className="h-4 w-4" />, path: "/pdf-splitter", adminOnly: true },
];

const MOBILE_NAV: NavItem[] = [
  { key: "홈", label: "홈", icon: <Home className="h-5 w-5" />, path: "/", adminOnly: false },
  { key: "근태보고", label: "근태보고", icon: <ClipboardList className="h-5 w-5" />, path: "/attendance", adminOnly: false },
  { key: "연차관리", label: "연차", icon: <CalendarDays className="h-5 w-5" />, path: "/leave", adminOnly: false },
  { key: "조직도", label: "조직도", icon: <GitBranch className="h-5 w-5" />, path: "/org-chart", adminOnly: false },
  { key: "XERP&PMIS", label: "XERP", icon: <Database className="h-5 w-5" />, path: "/xerp", adminOnly: false },
];

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { isAdmin, loginDialogOpen, setLoginDialogOpen, login, logout } = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");

  const handleNavClick = (path: string, adminOnly: boolean) => {
    if (adminOnly && !isAdmin) {
      toast.error("관리자 로그인이 필요합니다.");
      return;
    }
    navigate(path);
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (login(loginId, loginPw)) {
      toast.success("관리자로 로그인되었습니다.");
      setLoginDialogOpen(false);
      setLoginId("");
      setLoginPw("");
    } else {
      toast.error("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
  };

  const handleLogout = () => {
    logout();
    toast.info("로그아웃 되었습니다.");
    navigate("/");
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-[#F0F3FA]">
      {/* 관리자 로그인 다이얼로그 */}
      <Dialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen}>
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-primary" />
              관리자 로그인
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLoginSubmit} className="space-y-3 pt-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">아이디</label>
              <input
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">비밀번호</label>
              <input
                type="password"
                value={loginPw}
                onChange={(e) => setLoginPw(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              로그인
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── 모바일 상단 헤더 (md 이하) ───────────── */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 shrink-0 z-30 shadow-sm">
        <div onClick={() => navigate("/")} className="cursor-pointer">
          <div
            className="text-lg font-extrabold leading-tight tracking-tight"
            style={{ background: "linear-gradient(135deg, #2563eb, #7c3aed)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
          >
            한성크린텍
          </div>
          <div className="text-[10px] text-gray-400 font-medium">현장 관리 시스템</div>
        </div>
        {isAdmin ? (
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-medium text-gray-500"
          >
            <LogOut className="h-3.5 w-3.5" /> 로그아웃
          </button>
        ) : (
          <button
            onClick={() => setLoginDialogOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#c8d8f8] text-xs font-semibold text-[#4a6aaa] bg-[#f0f4ff]"
          >
            <KeyRound className="h-3.5 w-3.5" /> 관리자
          </button>
        )}
      </header>

      {/* ── 데스크탑 레이아웃 ────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── SIDEBAR (md 이상) ─────────────────── */}
        <aside className="hidden md:flex w-56 shrink-0 bg-white flex-col shadow-[2px_0_12px_rgba(0,0,0,0.06)] z-20">

          {/* 로고 */}
          <div
            className="px-5 py-5 border-b border-gray-100 cursor-pointer shrink-0"
            onClick={() => navigate("/")}
          >
            <div
              className="text-2xl font-extrabold leading-tight tracking-tight"
              style={{ background: "linear-gradient(135deg, #2563eb, #7c3aed)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
            >
              한성크린텍
            </div>
            <div className="text-[13px] text-gray-400 font-medium mt-1">현장 관리 시스템</div>
          </div>

          {/* 네비게이션 */}
          <nav className="flex-1 py-4 px-3 overflow-y-auto space-y-0.5">
            {[...NAV_PUBLIC, ...NAV_SEMI_PUBLIC].map(({ key, label, icon, path }) => {
              const isActive = location.pathname === path;
              return (
                <button
                  key={key}
                  onClick={() => handleNavClick(path, false)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                    isActive ? "text-[#2d3a8a] font-semibold shadow-[0_2px_8px_rgba(168,200,248,0.35)]" : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  }`}
                  style={isActive ? { background: "linear-gradient(135deg,#a8c8f8,#c8b4f8)" } : {}}
                >
                  <span className="shrink-0">{icon}</span>
                  <span>{label}</span>
                </button>
              );
            })}

            {/* 관리자 전용 구분선 */}
            <div className="flex items-center gap-2 px-2 pt-4 pb-1">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-[10px] text-gray-300 font-semibold uppercase tracking-wider whitespace-nowrap">관리자 전용</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            {NAV_ADMIN.map(({ key, label, icon, path, adminOnly }) => {
              const isActive = location.pathname === path;
              const locked = !isAdmin;
              return (
                <button
                  key={key}
                  onClick={() => handleNavClick(path, adminOnly)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                    isActive
                      ? "text-[#2d3a8a] font-semibold shadow-[0_2px_8px_rgba(168,200,248,0.35)]"
                      : locked
                        ? "text-gray-300 hover:bg-gray-50"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  }`}
                  style={isActive ? { background: "linear-gradient(135deg,#a8c8f8,#c8b4f8)" } : {}}
                >
                  <span className="shrink-0">{icon}</span>
                  <span className="flex-1">{label}</span>
                  {locked && <Lock className="h-3 w-3 opacity-30 shrink-0" />}
                </button>
              );
            })}
          </nav>

          {/* 하단 로그인/로그아웃 */}
          <div className="px-4 py-4 border-t border-gray-100 shrink-0">
            {isAdmin ? (
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                로그아웃
              </button>
            ) : (
              <button
                onClick={() => setLoginDialogOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#c8d8f8] text-sm font-semibold text-[#4a6aaa] hover:bg-[#f0f4ff] transition-colors"
              >
                <KeyRound className="h-4 w-4" />
                관리자 로그인
              </button>
            )}
          </div>
        </aside>

        {/* ── MAIN ──────────────────────────────── */}
        <main className="flex-1 overflow-auto pb-16 md:pb-0">
          {children}
        </main>
      </div>

      {/* ── 모바일 하단 네비게이션 (md 이하) ──────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] z-30 flex items-stretch">
        {MOBILE_NAV.map(({ key, label, icon, path }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={key}
              onClick={() => handleNavClick(path, false)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors ${
                isActive ? "text-primary" : "text-gray-400"
              }`}
            >
              <span className={`transition-transform ${isActive ? "scale-110" : ""}`}>{icon}</span>
              <span>{label}</span>
              {isActive && <span className="absolute bottom-0 w-8 h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
