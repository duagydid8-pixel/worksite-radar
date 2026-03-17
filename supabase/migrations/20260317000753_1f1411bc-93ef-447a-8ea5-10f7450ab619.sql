
CREATE TABLE public.leave_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  dept text NOT NULL DEFAULT '',
  hire_date text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(name)
);

ALTER TABLE public.leave_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read leave_employees" ON public.leave_employees FOR SELECT USING (true);
CREATE POLICY "Anyone can insert leave_employees" ON public.leave_employees FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update leave_employees" ON public.leave_employees FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete leave_employees" ON public.leave_employees FOR DELETE USING (true);

CREATE TABLE public.leave_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL,
  day integer NOT NULL,
  days numeric NOT NULL DEFAULT 1,
  reason text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(name, year, month, day)
);

ALTER TABLE public.leave_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read leave_details" ON public.leave_details FOR SELECT USING (true);
CREATE POLICY "Anyone can insert leave_details" ON public.leave_details FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update leave_details" ON public.leave_details FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete leave_details" ON public.leave_details FOR DELETE USING (true);
