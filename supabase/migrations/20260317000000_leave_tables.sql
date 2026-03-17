
-- Create leave_employees table (연차_현채직 시트)
CREATE TABLE public.leave_employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT NOT NULL DEFAULT '',
  hire_date TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create leave_details table (연차_상세 시트)
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

-- Enable RLS
ALTER TABLE public.leave_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_details ENABLE ROW LEVEL SECURITY;

-- Allow public read
CREATE POLICY "Anyone can read leave_employees" ON public.leave_employees FOR SELECT USING (true);
CREATE POLICY "Anyone can read leave_details" ON public.leave_details FOR SELECT USING (true);

-- Allow public insert/delete/update
CREATE POLICY "Anyone can insert leave_employees" ON public.leave_employees FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete leave_employees" ON public.leave_employees FOR DELETE USING (true);
CREATE POLICY "Anyone can update leave_employees" ON public.leave_employees FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can insert leave_details" ON public.leave_details FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete leave_details" ON public.leave_details FOR DELETE USING (true);
CREATE POLICY "Anyone can update leave_details" ON public.leave_details FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Unique constraints to prevent duplicates
CREATE UNIQUE INDEX idx_leave_employees_unique ON public.leave_employees (name);
CREATE UNIQUE INDEX idx_leave_details_unique ON public.leave_details (name, year, month, day);
