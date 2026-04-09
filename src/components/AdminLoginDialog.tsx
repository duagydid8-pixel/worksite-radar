import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LogIn, LogOut, Lock } from "lucide-react";
import { toast } from "sonner";

const ADMIN_ID = "duagydid";
const ADMIN_PW = "1234";
const STORAGE_KEY = "admin_logged_in";

export function useAdminAuth() {
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem(STORAGE_KEY) === "true");

  const login = (id: string, pw: string): boolean => {
    if (id === ADMIN_ID && pw === ADMIN_PW) {
      sessionStorage.setItem(STORAGE_KEY, "true");
      setIsAdmin(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setIsAdmin(false);
  };

  return { isAdmin, login, logout };
}

interface Props {
  isAdmin: boolean;
  onLogin: (id: string, pw: string) => boolean;
  onLogout: () => void;
}

export default function AdminLoginButton({ isAdmin, onLogin, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onLogin(id, pw)) {
      toast.success("관리자로 로그인되었습니다.");
      setOpen(false);
      setId("");
      setPw("");
    } else {
      toast.error("아이디 또는 비밀번호가 올바르지 않습니다.");
    }
  };

  if (isAdmin) {
    return (
      <button
        onClick={() => { onLogout(); toast.info("로그아웃 되었습니다."); }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <LogOut className="h-3.5 w-3.5" />
        로그아웃
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <LogIn className="h-3.5 w-3.5" />
        관리자
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-primary" />
              관리자 로그인
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3 pt-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">아이디</label>
              <input
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">비밀번호</label>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
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
    </>
  );
}
