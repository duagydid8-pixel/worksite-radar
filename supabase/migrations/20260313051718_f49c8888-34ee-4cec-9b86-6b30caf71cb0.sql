
-- Create attendance_data table
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

-- Create anomaly_data table
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

-- Create yeoncha_data table
CREATE TABLE public.yeoncha_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  year INT NOT NULL,
  month INT NOT NULL,
  day INT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create upload_metadata table for tracking last upload time
CREATE TABLE public.upload_metadata (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  file_name TEXT,
  record_count INT NOT NULL DEFAULT 0
);

-- Enable RLS on all tables
ALTER TABLE public.attendance_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anomaly_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yeoncha_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_metadata ENABLE ROW LEVEL SECURITY;

-- Allow public read access (viewers can see data without auth)
CREATE POLICY "Anyone can read attendance_data" ON public.attendance_data FOR SELECT USING (true);
CREATE POLICY "Anyone can read anomaly_data" ON public.anomaly_data FOR SELECT USING (true);
CREATE POLICY "Anyone can read yeoncha_data" ON public.yeoncha_data FOR SELECT USING (true);
CREATE POLICY "Anyone can read upload_metadata" ON public.upload_metadata FOR SELECT USING (true);

-- Allow public insert/delete (no auth required for this internal tool)
CREATE POLICY "Anyone can insert attendance_data" ON public.attendance_data FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete attendance_data" ON public.attendance_data FOR DELETE USING (true);
CREATE POLICY "Anyone can insert anomaly_data" ON public.anomaly_data FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete anomaly_data" ON public.anomaly_data FOR DELETE USING (true);
CREATE POLICY "Anyone can insert yeoncha_data" ON public.yeoncha_data FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete yeoncha_data" ON public.yeoncha_data FOR DELETE USING (true);
CREATE POLICY "Anyone can insert upload_metadata" ON public.upload_metadata FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete upload_metadata" ON public.upload_metadata FOR DELETE USING (true);

-- Add unique constraints to prevent duplicates
CREATE UNIQUE INDEX idx_attendance_unique ON public.attendance_data (name, team, year, month);
CREATE UNIQUE INDEX idx_anomaly_unique ON public.anomaly_data (name, year, month);
CREATE UNIQUE INDEX idx_yeoncha_unique ON public.yeoncha_data (name, year, month, day);
