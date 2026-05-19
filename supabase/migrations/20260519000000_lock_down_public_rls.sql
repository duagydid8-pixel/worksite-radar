-- Lock down previously public policies. The app's primary data store is Firebase;
-- Supabase tables must not remain anonymously readable or writable.

drop policy if exists "Anyone can read attendance_data" on public.attendance_data;
drop policy if exists "Anyone can insert attendance_data" on public.attendance_data;
drop policy if exists "Anyone can delete attendance_data" on public.attendance_data;
drop policy if exists "Anyone can update attendance_data" on public.attendance_data;
drop policy if exists "anon read" on public.attendance_data;
drop policy if exists "anon insert" on public.attendance_data;
drop policy if exists "anon delete" on public.attendance_data;
drop policy if exists "anon update" on public.attendance_data;

drop policy if exists "Anyone can read anomaly_data" on public.anomaly_data;
drop policy if exists "Anyone can insert anomaly_data" on public.anomaly_data;
drop policy if exists "Anyone can delete anomaly_data" on public.anomaly_data;
drop policy if exists "Anyone can update anomaly_data" on public.anomaly_data;
drop policy if exists "anon read" on public.anomaly_data;
drop policy if exists "anon insert" on public.anomaly_data;
drop policy if exists "anon delete" on public.anomaly_data;
drop policy if exists "anon update" on public.anomaly_data;

drop policy if exists "Anyone can read yeoncha_data" on public.yeoncha_data;
drop policy if exists "Anyone can insert yeoncha_data" on public.yeoncha_data;
drop policy if exists "Anyone can delete yeoncha_data" on public.yeoncha_data;
drop policy if exists "Anyone can update yeoncha_data" on public.yeoncha_data;
drop policy if exists "anon read" on public.yeoncha_data;
drop policy if exists "anon insert" on public.yeoncha_data;
drop policy if exists "anon delete" on public.yeoncha_data;
drop policy if exists "anon update" on public.yeoncha_data;

drop policy if exists "Anyone can read upload_metadata" on public.upload_metadata;
drop policy if exists "Anyone can insert upload_metadata" on public.upload_metadata;
drop policy if exists "Anyone can delete upload_metadata" on public.upload_metadata;
drop policy if exists "Anyone can update upload_metadata" on public.upload_metadata;
drop policy if exists "anon read" on public.upload_metadata;
drop policy if exists "anon insert" on public.upload_metadata;
drop policy if exists "anon delete" on public.upload_metadata;
drop policy if exists "anon update" on public.upload_metadata;

drop policy if exists "Anyone can read leave_employees" on public.leave_employees;
drop policy if exists "Anyone can insert leave_employees" on public.leave_employees;
drop policy if exists "Anyone can delete leave_employees" on public.leave_employees;
drop policy if exists "Anyone can update leave_employees" on public.leave_employees;
drop policy if exists "anon read" on public.leave_employees;
drop policy if exists "anon insert" on public.leave_employees;
drop policy if exists "anon delete" on public.leave_employees;
drop policy if exists "anon update" on public.leave_employees;

drop policy if exists "Anyone can read leave_details" on public.leave_details;
drop policy if exists "Anyone can insert leave_details" on public.leave_details;
drop policy if exists "Anyone can delete leave_details" on public.leave_details;
drop policy if exists "Anyone can update leave_details" on public.leave_details;
drop policy if exists "anon read" on public.leave_details;
drop policy if exists "anon insert" on public.leave_details;
drop policy if exists "anon delete" on public.leave_details;
drop policy if exists "anon update" on public.leave_details;

drop policy if exists "anon read" on public.row_order;
drop policy if exists "anon insert" on public.row_order;
drop policy if exists "anon update" on public.row_order;
drop policy if exists "anon delete" on public.row_order;

drop policy if exists "Anyone can read org_teams" on public.org_teams;
drop policy if exists "Anyone can insert org_teams" on public.org_teams;
drop policy if exists "Anyone can update org_teams" on public.org_teams;
drop policy if exists "Anyone can delete org_teams" on public.org_teams;

drop policy if exists "Anyone can read org_members" on public.org_members;
drop policy if exists "Anyone can insert org_members" on public.org_members;
drop policy if exists "Anyone can update org_members" on public.org_members;
drop policy if exists "Anyone can delete org_members" on public.org_members;

drop policy if exists "Anyone can read org photos" on storage.objects;
drop policy if exists "Anyone can upload org photos" on storage.objects;
drop policy if exists "Anyone can update org photos" on storage.objects;
drop policy if exists "Anyone can delete org photos" on storage.objects;

alter table if exists public.attendance_data enable row level security;
alter table if exists public.anomaly_data enable row level security;
alter table if exists public.yeoncha_data enable row level security;
alter table if exists public.upload_metadata enable row level security;
alter table if exists public.leave_employees enable row level security;
alter table if exists public.leave_details enable row level security;
alter table if exists public.row_order enable row level security;
alter table if exists public.org_teams enable row level security;
alter table if exists public.org_members enable row level security;

create policy "authenticated read attendance_data" on public.attendance_data for select to authenticated using (true);
create policy "authenticated read anomaly_data" on public.anomaly_data for select to authenticated using (true);
create policy "authenticated read yeoncha_data" on public.yeoncha_data for select to authenticated using (true);
create policy "authenticated read upload_metadata" on public.upload_metadata for select to authenticated using (true);
create policy "authenticated read leave_employees" on public.leave_employees for select to authenticated using (true);
create policy "authenticated read leave_details" on public.leave_details for select to authenticated using (true);
create policy "authenticated read row_order" on public.row_order for select to authenticated using (true);
create policy "authenticated read org_teams" on public.org_teams for select to authenticated using (true);
create policy "authenticated read org_members" on public.org_members for select to authenticated using (true);
