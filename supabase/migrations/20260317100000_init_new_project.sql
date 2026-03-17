-- =====================================================
-- worksite-radar 전체 테이블 초기화
-- Supabase SQL Editor에서 한 번에 실행하세요
-- =====================================================

-- Drop existing tables if any
DROP TABLE IF EXISTS public.leave_details CASCADE;
DROP TABLE IF EXISTS public.leave_employees CASCADE;
DROP TABLE IF EXISTS public.upload_metadata CASCADE;
DROP TABLE IF EXISTS public.yeoncha_data CASCADE;
DROP TABLE IF EXISTS public.anomaly_data CASCADE;
DROP TABLE IF EXISTS public.attendance_data CASCADE;

-- ── 근태 데이터 ─────────────────────────────────────

CREATE TABLE public.attendance_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  team TEXT NOT NULL,
  job TEXT NOT NULL DEFAULT '',
  year INT NOT NULL,
  month INT NOT NULL,
  days_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_attendance_unique ON public.attendance_data (name, team, year, month);

CREATE TABLE public.anomaly_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  year INT NOT NULL,
  month INT NOT NULL,
  mita INT NOT NULL DEFAULT 0,
  jigak INT NOT NULL DEFAULT 0,
  gyeol INT NOT NULL DEFAULT 0,
  bansa INT NOT NULL DEFAULT 0,
  yeoncha INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_anomaly_unique ON public.anomaly_data (name, year, month);

CREATE TABLE public.yeoncha_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  year INT NOT NULL,
  month INT NOT NULL,
  day INT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_yeoncha_unique ON public.yeoncha_data (name, year, month, day);

CREATE TABLE public.upload_metadata (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  file_name TEXT,
  record_count INT NOT NULL DEFAULT 0
);

-- ── 연차 데이터 ─────────────────────────────────────

-- 연차_현채직: 직원별 발생·사용·잔여 연차 요약
CREATE TABLE public.leave_employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT NOT NULL DEFAULT '',
  hire_date TEXT NOT NULL DEFAULT '',
  accrued NUMERIC NOT NULL DEFAULT 0,
  total_used NUMERIC NOT NULL DEFAULT 0,
  remaining NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_leave_employees_unique ON public.leave_employees (name);

-- 연차_상세: 연차 사용 내역 (이름·날짜·일수·비고)
CREATE TABLE public.leave_details (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  year INT NOT NULL,
  month INT NOT NULL,
  day INT NOT NULL,
  days NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_leave_details_unique ON public.leave_details (name, year, month, day);

-- ── RLS 활성화 ───────────────────────────────────────

ALTER TABLE public.attendance_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anomaly_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yeoncha_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_details ENABLE ROW LEVEL SECURITY;

-- ── 정책 (인증 없이 읽기·쓰기 허용) ────────────────

CREATE POLICY "anon read"   ON public.attendance_data FOR SELECT USING (true);
CREATE POLICY "anon insert" ON public.attendance_data FOR INSERT WITH CHECK (true);
CREATE POLICY "anon delete" ON public.attendance_data FOR DELETE USING (true);
CREATE POLICY "anon update" ON public.attendance_data FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon read"   ON public.anomaly_data FOR SELECT USING (true);
CREATE POLICY "anon insert" ON public.anomaly_data FOR INSERT WITH CHECK (true);
CREATE POLICY "anon delete" ON public.anomaly_data FOR DELETE USING (true);
CREATE POLICY "anon update" ON public.anomaly_data FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon read"   ON public.yeoncha_data FOR SELECT USING (true);
CREATE POLICY "anon insert" ON public.yeoncha_data FOR INSERT WITH CHECK (true);
CREATE POLICY "anon delete" ON public.yeoncha_data FOR DELETE USING (true);
CREATE POLICY "anon update" ON public.yeoncha_data FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon read"   ON public.upload_metadata FOR SELECT USING (true);
CREATE POLICY "anon insert" ON public.upload_metadata FOR INSERT WITH CHECK (true);
CREATE POLICY "anon delete" ON public.upload_metadata FOR DELETE USING (true);
CREATE POLICY "anon update" ON public.upload_metadata FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon read"   ON public.leave_employees FOR SELECT USING (true);
CREATE POLICY "anon insert" ON public.leave_employees FOR INSERT WITH CHECK (true);
CREATE POLICY "anon delete" ON public.leave_employees FOR DELETE USING (true);
CREATE POLICY "anon update" ON public.leave_employees FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon read"   ON public.leave_details FOR SELECT USING (true);
CREATE POLICY "anon insert" ON public.leave_details FOR INSERT WITH CHECK (true);
CREATE POLICY "anon delete" ON public.leave_details FOR DELETE USING (true);
CREATE POLICY "anon update" ON public.leave_details FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
