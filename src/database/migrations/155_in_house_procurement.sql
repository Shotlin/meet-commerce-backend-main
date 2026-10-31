-- 155_in_house_procurement.sql
-- In-house procurement alongside the existing vendor flow.
--
-- An in-house purchase is a real supply order with no vendor and no
-- procurement request: source_type = 'IN_HOUSE', vendor_id = NULL,
-- request_id = NULL. It reuses the existing supply items, evidence, receipt
-- and inventory bridge unchanged. Vendor rows keep source_type = 'VENDOR'.
--
-- Evidence for in-house orders has no vendor; an external link also has no
-- Cloudinary public id, so both columns become nullable. attachment_source
-- distinguishes an uploaded Cloudinary asset from a direct video URL.

ALTER TABLE procurement_supply_orders
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'VENDOR',
  ADD COLUMN IF NOT EXISTS in_house_supplier_name VARCHAR(200);

ALTER TABLE procurement_supply_orders
  ALTER COLUMN vendor_id DROP NOT NULL,
  ALTER COLUMN request_id DROP NOT NULL;

ALTER TABLE procurement_supply_orders
  DROP CONSTRAINT IF EXISTS procurement_supply_orders_source_mode_check;

ALTER TABLE procurement_supply_orders
  ADD CONSTRAINT procurement_supply_orders_source_mode_check
  CHECK (source_mode IN ('FIXED_OFFER', 'RFQ', 'IN_HOUSE'));

ALTER TABLE procurement_supply_orders
  DROP CONSTRAINT IF EXISTS procurement_supply_orders_source_type_check;

ALTER TABLE procurement_supply_orders
  ADD CONSTRAINT procurement_supply_orders_source_type_check
  CHECK (source_type IN ('VENDOR', 'IN_HOUSE'));

-- A vendor supply must still point at its request and vendor. An in-house
-- supply must not pretend to have either.
ALTER TABLE procurement_supply_orders
  DROP CONSTRAINT IF EXISTS chk_procurement_supply_source;

ALTER TABLE procurement_supply_orders
  ADD CONSTRAINT chk_procurement_supply_source
  CHECK (
    (source_type = 'VENDOR' AND vendor_id IS NOT NULL AND request_id IS NOT NULL)
    OR
    (source_type = 'IN_HOUSE' AND vendor_id IS NULL AND request_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_procurement_supply_orders_source
  ON procurement_supply_orders (source_type, status);

ALTER TABLE procurement_evidence
  ALTER COLUMN vendor_id DROP NOT NULL,
  ALTER COLUMN media_public_id DROP NOT NULL;

ALTER TABLE procurement_evidence
  ADD COLUMN IF NOT EXISTS attachment_source TEXT NOT NULL DEFAULT 'UPLOAD';

ALTER TABLE procurement_evidence
  DROP CONSTRAINT IF EXISTS procurement_evidence_attachment_source_check;

ALTER TABLE procurement_evidence
  ADD CONSTRAINT procurement_evidence_attachment_source_check
  CHECK (attachment_source IN ('UPLOAD', 'EXTERNAL_LINK'));
