-- Retention of the Smart error log (docs/01-product/06-smart.md). Closed errors (`fixed`,
-- `ignored`) that were last seen long ago are removed by the retention purge, the only path
-- that may delete from app_errors; an open error is never deleted.
CREATE FUNCTION app.app_error_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.retention_purge', true) = 'on' AND OLD.status IN ('fixed', 'ignored') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'an error entry is removed only by the retention purge, once it is closed';
END
$$;
CREATE TRIGGER app_errors_delete_guard
  BEFORE DELETE ON app_errors
  FOR EACH ROW EXECUTE FUNCTION app.app_error_delete_guard();
--> statement-breakpoint
GRANT DELETE ON app_errors TO docoo_app;
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
  ('retention.app_errors_days', '{"type":"integer","minimum":7,"maximum":3650}', '90',
   '{workspace}', false,
   'چند روز پس از آخرین رخداد، خطاهای بسته‌شدهٔ خطایاب (رفع‌شده یا نادیده) با پاک‌سازی نگهداری حذف می‌شوند',
   'Days after the last occurrence when closed (fixed or ignored) entries of the error log are removed by the retention purge');
