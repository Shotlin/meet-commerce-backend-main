-- WhatsApp (unofficial, Baileys) order messaging.
-- Auth state lives in Postgres so a container restart never forces a re-scan.

CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
  id         TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Singleton settings row (same unique-index-on-constant pattern as ola_maps_settings).
CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  singleton            BOOLEAN NOT NULL DEFAULT TRUE,
  enabled              BOOLEAN NOT NULL DEFAULT FALSE,
  country_code         VARCHAR(5) NOT NULL DEFAULT '91',
  -- human-like pacing
  send_delay_min_sec   INTEGER NOT NULL DEFAULT 8,
  send_delay_max_sec   INTEGER NOT NULL DEFAULT 45,
  min_gap_sec          INTEGER NOT NULL DEFAULT 12,
  max_gap_sec          INTEGER NOT NULL DEFAULT 40,
  typing_simulation    BOOLEAN NOT NULL DEFAULT TRUE,
  -- volume guards
  hourly_cap           INTEGER NOT NULL DEFAULT 30,
  daily_cap            INTEGER NOT NULL DEFAULT 150,
  warmup_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  -- quiet hours, minutes after midnight, Asia/Kolkata
  quiet_hours_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_start_min      INTEGER NOT NULL DEFAULT 1320,
  quiet_end_min        INTEGER NOT NULL DEFAULT 480,
  -- connection facts (written by the manager)
  connected_phone      VARCHAR(30),
  connected_name       VARCHAR(120),
  first_connected_at   TIMESTAMPTZ,
  last_connected_at    TIMESTAMPTZ,
  updated_by           UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_settings_singleton ON whatsapp_settings (singleton);
INSERT INTO whatsapp_settings (singleton) VALUES (TRUE) ON CONFLICT DO NOTHING;

-- Overrides only: a missing row means "use the built-in default for this event".
CREATE TABLE IF NOT EXISTS whatsapp_event_templates (
  event_key  VARCHAR(40) PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  variants   JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID,
  user_id       UUID,
  phone         VARCHAR(30) NOT NULL,
  event_key     VARCHAR(40) NOT NULL,
  body          TEXT NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'QUEUED'
                CHECK (status IN ('QUEUED','SENDING','SENT','FAILED','SKIPPED')),
  skip_reason   VARCHAR(60),
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  wa_message_id VARCHAR(80),
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One WhatsApp message per (order, event): makes every hook idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_order_event
  ON whatsapp_messages (order_id, event_key) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_queue
  ON whatsapp_messages (scheduled_at) WHERE status = 'QUEUED';
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sent_at
  ON whatsapp_messages (sent_at) WHERE status = 'SENT';
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created
  ON whatsapp_messages (created_at DESC);

-- Customers who replied STOP — never messaged again.
CREATE TABLE IF NOT EXISTS whatsapp_opt_outs (
  phone      VARCHAR(30) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
