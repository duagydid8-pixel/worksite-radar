
CREATE POLICY "Anyone can update attendance_data" ON attendance_data FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can update anomaly_data" ON anomaly_data FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can update yeoncha_data" ON yeoncha_data FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can update upload_metadata" ON upload_metadata FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
