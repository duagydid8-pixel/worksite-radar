import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Component, lazy, Suspense, type ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import { Loader2 } from "lucide-react";
import { UIProvider } from "@/contexts/UIContext";
import { AttendanceProvider } from "@/contexts/AttendanceContext";
import { useAttendance } from "@/hooks/useAttendance";
import Layout from "@/components/Layout";

const HomePage = lazy(() => import("@/pages/HomePage"));
const AttendancePage = lazy(() => import("@/pages/AttendancePage"));
const LeavePage = lazy(() => import("@/pages/LeavePage"));
const OrgChartPage = lazy(() => import("@/pages/OrgChartPage"));
const XerpPage = lazy(() => import("@/pages/XerpPage"));
const WeeklySchedulePage = lazy(() => import("@/pages/WeeklySchedulePage"));
const NewEmployeePage = lazy(() => import("@/pages/NewEmployeePage"));
const XerpReflectionPage = lazy(() => import("@/pages/XerpReflectionPage"));
const PdfSplitterPage = lazy(() => import("@/pages/PdfSplitterPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <div className="max-w-lg w-full text-center space-y-4">
            <p className="text-2xl font-bold text-foreground">오류가 발생했습니다</p>
            <p className="text-sm text-muted-foreground break-all">{(this.state.error as Error).message}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-6 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function LoadingGate({ children }: { children: ReactNode }) {
  const { isLoading } = useAttendance();
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">데이터 로딩 중...</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <UIProvider>
          <AttendanceProvider>
            <BrowserRouter>
              <LoadingGate>
                <Layout>
                  <Suspense fallback={
                    <div className="min-h-screen bg-background flex items-center justify-center">
                      <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    </div>
                  }>
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/attendance" element={<AttendancePage />} />
                      <Route path="/leave" element={<LeavePage />} />
                      <Route path="/org-chart" element={<OrgChartPage />} />
                      <Route path="/xerp" element={<XerpPage />} />
                      <Route path="/weekly-schedule" element={<WeeklySchedulePage />} />
                      <Route path="/new-employees" element={<NewEmployeePage />} />
                      <Route path="/xerp-reflection" element={<XerpReflectionPage />} />
                      <Route path="/pdf-splitter" element={<PdfSplitterPage />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </Layout>
              </LoadingGate>
            </BrowserRouter>
          </AttendanceProvider>
        </UIProvider>
        <Analytics />
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
