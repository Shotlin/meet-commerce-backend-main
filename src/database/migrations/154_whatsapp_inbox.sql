-- WhatsApp shared inbox (two-way chat) with rolling per-conversation retention.

ALTER TABLE whatsapp_settings
  ADD COLUMN IF NOT EXISTS chat_retention_days INTEGER NOT NULL DEFAULT 3
  CHECK (chat_retention_days BETWEEN 1 AND 90);

-- One row per WhatsApp contact. expires_at = last message time + retention;
-- every new message (in or out) pushes it forward, so an active chat is never
-- deleted and a silent one disappears N days after its last message.
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  jid                  VARCHAR(80) NOT NULL UNIQUE,
  phone                VARCHAR(30),
  display_name         VARCHAR(120),
  last_message_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_preview VARCHAR(200),
  last_direction       VARCHAR(3),
  unread_count         INTEGER NOT NULL DEFAULT 0,
  expires_at           TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_last ON whatsapp_conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_conv_expires ON whatsapp_conversations (expires_at);

CREATE TABLE IF NOT EXISTS whatsapp_chat_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  wa_message_id   VARCHAR(80),
  direction       VARCHAR(3) NOT NULL CHECK (direction IN ('IN','OUT')),
  type            VARCHAR(12) NOT NULL DEFAULT 'text'
                  CHECK (type IN ('text','image','video','audio','document','sticker','other')),
  body            TEXT,
  media_name      VARCHAR(200),
  media_mime      VARCHAR(100),
  media_size      INTEGER,
  has_media       BOOLEAN NOT NULL DEFAULT FALSE,
  source          VARCHAR(10) NOT NULL DEFAULT 'MANUAL',  -- MANUAL | AUTOMATED | CUSTOMER
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_chat_conv_time ON whatsapp_chat_messages (conversation_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_chat_wa_id
  ON whatsapp_chat_messages (conversation_id, wa_message_id) WHERE wa_message_id IS NOT NULL;

-- File bytes live in Postgres so deleting a message/conversation removes the
-- file in the same statement (no orphaned files on disk or in a bucket).
CREATE TABLE IF NOT EXISTS whatsapp_chat_media (
  message_id UUID PRIMARY KEY REFERENCES whatsapp_chat_messages(id) ON DELETE CASCADE,
  data       BYTEA NOT NULL
);
