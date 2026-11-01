-- ADR-0046 step 1: voice conversation. A second provider brand for speech, a usage ledger of its
-- own (kept apart from model_invocations so the cost of voice is never lost in the text cost),
-- the optional stored recordings of an administrator, and each administrator's chosen mode.
ALTER TYPE provider_kind ADD VALUE IF NOT EXISTS 'elevenlabs';
--> statement-breakpoint
CREATE TABLE voice_invocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 connection_id uuid REFERENCES provider_connections(id) ON DELETE SET NULL,
 provider provider_kind NOT NULL,
 kind text NOT NULL CHECK(kind IN ('stt','tts')),
 model text NOT NULL,
 voice_id text,
 -- Whose account the call counts for (ADR-0042).
 actor_id uuid,
 conversation_kind text CHECK(conversation_kind IN ('smart','stage','analysis','settings')),
 conversation_id uuid,
 message_id uuid,
 status invocation_status NOT NULL,
 -- Speech to text is measured in seconds of audio, text to speech in characters.
 audio_seconds real CHECK(audio_seconds >= 0),
 characters integer CHECK(characters >= 0),
 input_tokens integer NOT NULL DEFAULT 0,
 output_tokens integer NOT NULL DEFAULT 0,
 cost_usd real,
 price_id uuid,
 latency_ms integer,
 provider_request_id text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voice_invocations_workspace_idx ON voice_invocations (workspace_id, created_at);
CREATE INDEX voice_invocations_actor_idx ON voice_invocations (actor_id, created_at) WHERE actor_id IS NOT NULL;
--> statement-breakpoint
-- Price per unit of voice: seconds for speech to text, characters for text to speech, and tokens
-- where a model reports them. A call without a matching price is shown as unpriced, never as free.
CREATE TABLE voice_prices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 provider provider_kind NOT NULL,
 model text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('stt','tts')),
 per_minute real CHECK(per_minute >= 0),
 per_1k_characters real CHECK(per_1k_characters >= 0),
 input_per_million real CHECK(input_per_million >= 0),
 output_per_million real CHECK(output_per_million >= 0),
 effective_from timestamptz NOT NULL,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voice_prices_lookup_idx ON voice_prices (workspace_id, provider, model, kind, effective_from DESC);
--> statement-breakpoint
-- The recording of one administrator message, stored only when the setting voice.store_admin_audio
-- is on. The bytes live in the object store; the transcript is always the message itself.
CREATE TABLE conversation_audio (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 conversation_kind text NOT NULL CHECK(conversation_kind IN ('smart','stage','analysis')),
 conversation_id uuid NOT NULL,
 message_id uuid,
 object_key text NOT NULL,
 mime text NOT NULL CHECK(char_length(mime) <= 100),
 bytes integer NOT NULL CHECK(bytes > 0),
 duration_ms integer NOT NULL CHECK(duration_ms >= 0),
 expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(object_key)
);
CREATE INDEX conversation_audio_conversation_idx ON conversation_audio (user_id, conversation_kind, conversation_id);
CREATE INDEX conversation_audio_expiry_idx ON conversation_audio (expires_at) WHERE expires_at IS NOT NULL;
--> statement-breakpoint
-- What an administrator chose for new chats: how they speak (input) and how Docoo answers (output).
CREATE TABLE voice_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 input_mode text NOT NULL DEFAULT 'text' CHECK(input_mode IN ('text','voice')),
 output_mode text NOT NULL DEFAULT 'text' CHECK(output_mode IN ('text','voice')),
 -- When true a transcript is sent at once; otherwise it waits in the message box to be checked.
 auto_send boolean NOT NULL DEFAULT false,
 volume real NOT NULL DEFAULT 1 CHECK(volume BETWEEN 0 AND 1),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE voice_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_invocations FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_prices FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_audio ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_audio FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON voice_invocations, voice_prices, conversation_audio, voice_preferences FROM PUBLIC, docoo_app;
--> statement-breakpoint
-- The ledger and the prices are history: read and append, never edited or deleted.
CREATE POLICY voice_invocations_read ON voice_invocations
 FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY voice_invocations_append ON voice_invocations
 FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id()
  AND (actor_id IS NULL OR actor_id = app.current_actor_id()));
CREATE POLICY voice_prices_read ON voice_prices
 FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY voice_prices_append ON voice_prices
 FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id());
GRANT SELECT, INSERT ON voice_invocations, voice_prices TO docoo_app;
CREATE TRIGGER voice_invocations_append_only BEFORE UPDATE OR DELETE ON voice_invocations
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER voice_prices_append_only BEFORE UPDATE OR DELETE ON voice_prices
 FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
-- A recording belongs to the administrator who made it; nobody else reads or deletes it through
-- the application. Removing it (and the row) is the delete button and the retention sweep.
CREATE POLICY conversation_audio_owner ON conversation_audio
 USING (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id())
 WITH CHECK (workspace_id = app.current_workspace_id() AND user_id = app.current_actor_id());
GRANT SELECT, INSERT, DELETE ON conversation_audio TO docoo_app;
CREATE POLICY voice_preferences_owner ON voice_preferences
 USING (user_id = app.current_actor_id())
 WITH CHECK (user_id = app.current_actor_id());
GRANT SELECT, INSERT, UPDATE ON voice_preferences TO docoo_app;
--> statement-breakpoint
INSERT INTO setting_definitions (key, value_schema, default_value, allowed_scopes, sensitive, description_fa, description_en) VALUES
 ('voice.enabled', '{"type":"boolean"}', 'false', '{workspace}', false,
  'گفتگوی صوتی (ضبط صدا و پاسخ صوتی) در سامانه فعال باشد',
  'Voice conversation (recording and spoken replies) is on'),
 ('voice.provider', '{"type":"string","enum":["openai","elevenlabs"]}', '"openai"', '{workspace}', false,
  'برند سرویس‌دهندهٔ صوتی',
  'Brand of the voice provider'),
 ('voice.connection_id', '{"type":"string","pattern":"^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$"}', '""', '{workspace}', false,
  'اتصال ارائه‌دهنده‌ای که برای صدا به کار می‌رود',
  'Provider connection used for voice'),
 ('voice.stt_model', '{"type":"string","maxLength":200}', '""', '{workspace}', false,
  'نسخهٔ مدل تبدیل گفتار به متن از کاتالوگ سرویس‌دهنده',
  'Speech to text model version from the provider catalog'),
 ('voice.tts_model', '{"type":"string","maxLength":200}', '""', '{workspace}', false,
  'نسخهٔ مدل تبدیل متن به گفتار از کاتالوگ سرویس‌دهنده',
  'Text to speech model version from the provider catalog'),
 ('voice.voice_id', '{"type":"string","maxLength":200}', '""', '{workspace}', false,
  'صدای پاسخ از میان صداهای سرویس‌دهنده',
  'Voice of the replies, from the voices of the provider'),
 ('voice.speed', '{"type":"number","minimum":0.7,"maximum":1.25}', '1', '{workspace}', false,
  'سرعت پخش پاسخ صوتی',
  'Playback speed of spoken replies'),
 ('voice.language_hint', '{"type":"string","enum":["auto","fa","en"]}', '"auto"', '{workspace}', false,
  'زبان گفتار برای بهبود دقت (خودکار: زبان رابط)',
  'Spoken language hint to improve accuracy (auto: interface language)'),
 ('voice.max_record_s', '{"type":"integer","minimum":5,"maximum":600}', '120', '{workspace}', false,
  'حداکثر مدت یک ضبط به ثانیه',
  'Maximum length of one recording in seconds'),
 ('voice.max_tts_chars', '{"type":"integer","minimum":200,"maximum":20000}', '4000', '{workspace}', false,
  'حداکثر نویسه‌ای که در یک پخش خوانده می‌شود',
  'Maximum characters read aloud in one playback'),
 ('voice.store_admin_audio', '{"type":"boolean"}', 'false', '{workspace}', false,
  'صدای ادمین در هر گفتگو ذخیره شود',
  'Store the administrator voice in each conversation'),
 ('voice.audio_retention_days', '{"type":"integer","minimum":0,"maximum":3650}', '30', '{workspace}', false,
  'مدت نگهداری صدای ذخیره‌شده به روز (۰: تا حذف دستی)',
  'Days a stored recording is kept (0: until deleted by hand)');
