
-- Create org chart teams table
CREATE TABLE public.org_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#2563eb',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read org_teams" ON public.org_teams FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert org_teams" ON public.org_teams FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can update org_teams" ON public.org_teams FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete org_teams" ON public.org_teams FOR DELETE TO public USING (true);

-- Create org chart members table
CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.org_teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  position text NOT NULL DEFAULT '담당자',
  rank text NOT NULL DEFAULT '사원',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  photo_url text NOT NULL DEFAULT '',
  is_leader boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read org_members" ON public.org_members FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert org_members" ON public.org_members FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can update org_members" ON public.org_members FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete org_members" ON public.org_members FOR DELETE TO public USING (true);

-- Create storage bucket for org photos
INSERT INTO storage.buckets (id, name, public) VALUES ('org-photos', 'org-photos', true);

CREATE POLICY "Anyone can read org photos" ON storage.objects FOR SELECT TO public USING (bucket_id = 'org-photos');
CREATE POLICY "Anyone can upload org photos" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'org-photos');
CREATE POLICY "Anyone can update org photos" ON storage.objects FOR UPDATE TO public USING (bucket_id = 'org-photos') WITH CHECK (bucket_id = 'org-photos');
CREATE POLICY "Anyone can delete org photos" ON storage.objects FOR DELETE TO public USING (bucket_id = 'org-photos');

-- Insert default teams
INSERT INTO public.org_teams (name, color, sort_order) VALUES
  ('공사팀', '#2563eb', 0),
  ('공무팀', '#7c3aed', 1),
  ('품질팀', '#059669', 2),
  ('안전팀', '#dc2626', 3),
  ('설계팀', '#d97706', 4);
