-- row_order: 드래그앤드롭 순서 저장
CREATE TABLE IF NOT EXISTS public.row_order (
  context TEXT NOT NULL PRIMARY KEY,
  names   JSONB NOT NULL DEFAULT '[]'
);

ALTER TABLE public.row_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read"   ON public.row_order FOR SELECT USING (true);
CREATE POLICY "anon insert" ON public.row_order FOR INSERT WITH CHECK (true);
CREATE POLICY "anon update" ON public.row_order FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon delete" ON public.row_order FOR DELETE USING (true);
