-- ADR-0057: ElevenLabs zero retention (enable_logging=false) may be limited to some plans. The owner
-- can now switch it off, knowingly; it stays on by default. Equal to liveAssistantSettingDefaults.
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('live_assistant.zero_retention', '{"type":"boolean"}', 'true', '{workspace}', false,
  'ElevenLabs: درخواست حالت بدون نگه‌داری داده (enable_logging=false)؛ خاموش‌کردنش یعنی ElevenLabs صدا و متن را در حساب شما ثبت می‌کند',
  'ElevenLabs: ask for zero retention (enable_logging=false); turning it off lets ElevenLabs log audio and text in your account');
