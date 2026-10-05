-- The analyst's eight required dimensions (FR-ANL-004) always stay required; an administrator may
-- also require the two optional ones before the analyst can say "enough".
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('analysis.require_risk_dimension', '{"type":"boolean"}', 'false',
   '{workspace,topic,project}', false,
   'تحلیلگر پیش از «کافی است» باید دست‌کم یک سؤال دربارهٔ ریسک‌ها هم پرسیده باشد',
   'The analyst must also have asked at least one question about risks before it can say enough'),
  ('analysis.require_out_of_scope_dimension', '{"type":"boolean"}', 'false',
   '{workspace,topic,project}', false,
   'تحلیلگر پیش از «کافی است» باید دست‌کم یک سؤال دربارهٔ خارج از دامنه هم پرسیده باشد',
   'The analyst must also have asked at least one question about what is out of scope before it can say enough');
