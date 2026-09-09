-- Give FreshCuts Kolkata its own active category themes.
--
-- The original Chicken/Fish/Mutton/Eggs rows were global themes.  A global
-- row is a useful fallback, but it means editing a category in the Kolkata
-- builder also changes every other store.  Clone each active global category
-- theme once, retaining its own colours/assets, so the public tab manifest
-- selects the Kolkata row first and each store can evolve independently.

INSERT INTO app_themes (
  name,
  is_active,
  theme_data,
  tab_id,
  tab_key,
  tab_label,
  tab_icon_url,
  tab_order,
  status,
  ab_variant,
  ab_split_percent,
  version,
  etag,
  shop_id
)
SELECT
  'FreshCuts Kolkata — ' || source.name,
  false,
  source.theme_data,
  source.tab_id,
  source.tab_key,
  source.tab_label,
  source.tab_icon_url,
  source.tab_order,
  'active',
  source.ab_variant,
  source.ab_split_percent,
  source.version,
  source.etag,
  kolkata.id
FROM app_themes source
JOIN shops kolkata
  ON kolkata.id = '902de7f7-9b5a-40d5-a6f7-100737826e76'::uuid
WHERE source.shop_id IS NULL
  AND source.status = 'active'
  AND source.ab_variant = 'A'
  AND source.tab_key IN ('navratri', 'fresh', 'fashion', 'electronics')
  AND NOT EXISTS (
    SELECT 1
    FROM app_themes existing
    WHERE existing.shop_id = kolkata.id
      AND existing.tab_id = source.tab_id
      AND existing.ab_variant = source.ab_variant
      AND existing.status = 'active'
  );
