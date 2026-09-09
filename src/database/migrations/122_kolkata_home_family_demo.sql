-- Kolkata-only Home family cards. Each option remains a normal product and
-- is listed only in FreshCuts Kolkata's shop_products inventory.

WITH family_input(slug, name, category_id, description) AS (
  VALUES
    ('kolkata-chicken-breast-family', 'Chicken Breast (Boneless)', 'fb05e302-cb2b-4cb5-b41d-328cac29226b'::uuid, 'Lean, high-protein chicken breast cuts.'),
    ('kolkata-mutton-curry-family', 'Mutton Curry Cut (Bone-in)', 'ebe770d2-395d-4775-92e7-0ea61e6008d1'::uuid, 'Tender bone-in mutton curry cuts.'),
    ('kolkata-salmon-steak-family', 'Salmon Steak', 'b3e3de5a-c80e-4405-9525-4264602c9df4'::uuid, 'Ocean-fresh salmon steaks.'),
    ('kolkata-farm-eggs-family', 'Farm Fresh Eggs', 'f9047a50-003b-4ef2-8397-d7a983b422b2'::uuid, 'Antibiotic-free farm fresh eggs.')
),
families AS (
  INSERT INTO product_families (slug, name, category_id, description, is_active)
  SELECT slug, name, category_id, description, true FROM family_input
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name,
        category_id = EXCLUDED.category_id,
        description = EXCLUDED.description,
        is_active = true,
        updated_at = NOW()
  RETURNING id, slug
),
product_input(
  slug, name, description, price, sale_price, category_id, unit,
  thumbnail_url, family_slug, option_label, option_sort_order,
  is_default_option, food_type, highlights
) AS (
  VALUES
    ('kolkata-demo-chicken-breast-500g', 'Chicken Breast Boneless (500 g)', 'Freshly trimmed boneless chicken breast.', 210.00, 180.00, 'fb05e302-cb2b-4cb5-b41d-328cac29226b'::uuid, 'pack', 'https://res.cloudinary.com/h9sgzkie/image/upload/dpr_auto,f_auto,q_auto/v1788610067/meet-commerce/products/gshfoxjxdj1gjhyiily8?_a=BAMAOGkS0', 'kolkata-chicken-breast-family', '500 g', 1, true, 'NON_VEG', jsonb_build_object('subtitle', 'Lean • High Protein', 'image_label', 'Naturally Lean', 'quality_badge', 'Fresh Cut', 'option_labels', jsonb_build_array('500 g', '1 kg'))),
    ('kolkata-demo-chicken-breast-1kg', 'Chicken Breast Boneless (1 kg)', 'Freshly trimmed boneless chicken breast.', 390.00, 350.00, 'fb05e302-cb2b-4cb5-b41d-328cac29226b'::uuid, 'pack', 'https://res.cloudinary.com/h9sgzkie/image/upload/dpr_auto,f_auto,q_auto/v1788610067/meet-commerce/products/gshfoxjxdj1gjhyiily8?_a=BAMAOGkS0', 'kolkata-chicken-breast-family', '1 kg', 2, false, 'NON_VEG', jsonb_build_object('subtitle', 'Lean • High Protein', 'image_label', 'Naturally Lean', 'quality_badge', 'Fresh Cut', 'option_labels', jsonb_build_array('500 g', '1 kg'))),
    ('kolkata-demo-mutton-curry-500g', 'Mutton Curry Cut (Bone-in) (500 g)', 'Tender, juicy bone-in mutton curry cut.', 620.00, 560.00, 'ebe770d2-395d-4775-92e7-0ea61e6008d1'::uuid, 'pack', 'https://res.cloudinary.com/h9sgzkie/image/upload/dpr_auto,f_auto,q_auto/v1788610129/meet-commerce/products/wzefww1b8oyoi9dwavls?_a=BAMAOGkS0', 'kolkata-mutton-curry-family', '500 g', 1, true, 'NON_VEG', jsonb_build_object('subtitle', 'Tender • Juicy', 'image_label', 'Rich in Flavour', 'quality_badge', 'Premium Cut', 'option_labels', jsonb_build_array('500 g', '1 kg'))),
    ('kolkata-demo-mutton-curry-1kg', 'Mutton Curry Cut (Bone-in) (1 kg)', 'Tender, juicy bone-in mutton curry cut.', 1180.00, 1060.00, 'ebe770d2-395d-4775-92e7-0ea61e6008d1'::uuid, 'pack', 'https://res.cloudinary.com/h9sgzkie/image/upload/dpr_auto,f_auto,q_auto/v1788610129/meet-commerce/products/wzefww1b8oyoi9dwavls?_a=BAMAOGkS0', 'kolkata-mutton-curry-family', '1 kg', 2, false, 'NON_VEG', jsonb_build_object('subtitle', 'Tender • Juicy', 'image_label', 'Rich in Flavour', 'quality_badge', 'Premium Cut', 'option_labels', jsonb_build_array('500 g', '1 kg'))),
    ('kolkata-demo-salmon-steak-250g', 'Salmon Steak (250 g)', 'Ocean-fresh salmon steak, carefully portioned.', 480.00, 420.00, 'b3e3de5a-c80e-4405-9525-4264602c9df4'::uuid, 'pack', 'https://res.cloudinary.com/h9sgzkie/image/upload/dpr_auto,f_auto,q_auto/v1788613001/meet-commerce/products/qx9bkk5jlwzac3n7rd9d?_a=BAMAOGkS0', 'kolkata-salmon-steak-family', '250 g', 1, true, 'NON_VEG', jsonb_build_object('subtitle', 'Rich in Omega 3', 'image_label', 'Ocean Fresh', 'quality_badge', 'Wild Catch', 'option_labels', jsonb_build_array('250 g', '500 g'))),
    ('kolkata-demo-salmon-steak-500g', 'Salmon Steak (500 g)', 'Ocean-fresh salmon steak, carefully portioned.', 900.00, 800.00, 'b3e3de5a-c80e-4405-9525-4264602c9df4'::uuid, 'pack', 'https://res.cloudinary.com/h9sgzkie/image/upload/dpr_auto,f_auto,q_auto/v1788613001/meet-commerce/products/qx9bkk5jlwzac3n7rd9d?_a=BAMAOGkS0', 'kolkata-salmon-steak-family', '500 g', 2, false, 'NON_VEG', jsonb_build_object('subtitle', 'Rich in Omega 3', 'image_label', 'Ocean Fresh', 'quality_badge', 'Wild Catch', 'option_labels', jsonb_build_array('250 g', '500 g'))),
    ('kolkata-demo-farm-eggs-6', 'Farm Fresh Eggs (Pack of 6)', 'Farm fresh, antibiotic-free eggs.', 110.00, 90.00, 'f9047a50-003b-4ef2-8397-d7a983b422b2'::uuid, 'pack', 'https://res.cloudinary.com/h9sgzkie/image/upload/dpr_auto,f_auto,q_auto/v1788609888/meet-commerce/products/l8zvnd8rboti3dhntcqw?_a=BAMAOGkS0', 'kolkata-farm-eggs-family', 'Pack of 6', 1, true, 'EGG', jsonb_build_object('subtitle', 'Nutritious • Healthy', 'image_label', 'Farm Fresh', 'quality_badge', 'Antibiotic Free', 'option_labels', jsonb_build_array('Pack of 6', 'Pack of 12'))),
    ('kolkata-demo-farm-eggs-12', 'Farm Fresh Eggs (Pack of 12)', 'Farm fresh, antibiotic-free eggs.', 210.00, 172.00, 'f9047a50-003b-4ef2-8397-d7a983b422b2'::uuid, 'pack', 'https://res.cloudinary.com/h9sgzkie/image/upload/dpr_auto,f_auto,q_auto/v1788609805/meet-commerce/products/ylgixs0goclno8m6ofvm?_a=BAMAOGkS0', 'kolkata-farm-eggs-family', 'Pack of 12', 2, false, 'EGG', jsonb_build_object('subtitle', 'Nutritious • Healthy', 'image_label', 'Farm Fresh', 'quality_badge', 'Antibiotic Free', 'option_labels', jsonb_build_array('Pack of 6', 'Pack of 12')))
),
demo_products AS (
  INSERT INTO products (
    slug, name, description, price, sale_price, cost_price, category_id,
    stock_quantity, unit, thumbnail_url, images, tags, is_active, is_featured,
    product_family_id, option_label, option_sort_order, is_default_option,
    food_type, custom_badges, display_delivery_minutes, highlights, net_quantity
  )
  SELECT
    i.slug, i.name, i.description, i.price, i.sale_price, i.sale_price * .72,
    i.category_id, 100, i.unit, i.thumbnail_url, jsonb_build_array(i.thumbnail_url),
    ARRAY['kolkata', 'home-family', 'freshcuts'], true, true,
    f.id, i.option_label, i.option_sort_order, i.is_default_option,
    i.food_type, jsonb_build_array(i.highlights->>'quality_badge'), 30,
    i.highlights, i.option_label
  FROM product_input i
  JOIN families f ON f.slug = i.family_slug
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        sale_price = EXCLUDED.sale_price,
        category_id = EXCLUDED.category_id,
        stock_quantity = EXCLUDED.stock_quantity,
        unit = EXCLUDED.unit,
        thumbnail_url = EXCLUDED.thumbnail_url,
        images = EXCLUDED.images,
        tags = EXCLUDED.tags,
        is_active = true,
        is_featured = true,
        product_family_id = EXCLUDED.product_family_id,
        option_label = EXCLUDED.option_label,
        option_sort_order = EXCLUDED.option_sort_order,
        is_default_option = EXCLUDED.is_default_option,
        food_type = EXCLUDED.food_type,
        custom_badges = EXCLUDED.custom_badges,
        display_delivery_minutes = EXCLUDED.display_delivery_minutes,
        highlights = EXCLUDED.highlights,
        net_quantity = EXCLUDED.net_quantity,
        updated_at = NOW()
  RETURNING id, slug
),
listing_input(slug, price, sale_price, wholesale_price, stock_quantity) AS (
  VALUES
    ('kolkata-demo-chicken-breast-500g', 210.00, 180.00, 165.00, 60),
    ('kolkata-demo-chicken-breast-1kg', 390.00, 350.00, 325.00, 40),
    ('kolkata-demo-mutton-curry-500g', 620.00, 560.00, 520.00, 35),
    ('kolkata-demo-mutton-curry-1kg', 1180.00, 1060.00, 990.00, 25),
    ('kolkata-demo-salmon-steak-250g', 480.00, 420.00, 390.00, 24),
    ('kolkata-demo-salmon-steak-500g', 900.00, 800.00, 740.00, 18),
    ('kolkata-demo-farm-eggs-6', 110.00, 90.00, 84.00, 100),
    ('kolkata-demo-farm-eggs-12', 210.00, 172.00, 160.00, 70)
)
INSERT INTO shop_products (
  shop_id, product_id, price, sale_price, wholesale_price, cost_price,
  stock_quantity, low_stock_threshold, max_order_qty, is_available, is_featured,
  approval_status
)
SELECT
  '902de7f7-9b5a-40d5-a6f7-100737826e76'::uuid, p.id,
  i.price, i.sale_price, i.wholesale_price, i.sale_price * .72,
  i.stock_quantity, 5, 10, true, true, 'APPROVED'
FROM demo_products p
JOIN listing_input i ON i.slug = p.slug
ON CONFLICT (shop_id, product_id) DO UPDATE
  SET price = EXCLUDED.price,
      sale_price = EXCLUDED.sale_price,
      wholesale_price = EXCLUDED.wholesale_price,
      cost_price = EXCLUDED.cost_price,
      stock_quantity = EXCLUDED.stock_quantity,
      is_available = true,
      is_featured = true,
      approval_status = 'APPROVED',
      deleted_at = NULL,
      updated_at = NOW();

-- A scoped layout means this visual Home section is shown only for the
-- Kolkata fulfilment shop. Clone every existing All-tab section first so
-- selecting the scoped layout cannot hide the rest of the Home page.
INSERT INTO section_manifests (
  tab_id, section_type, sort_order, visible, config, merch_binding, shop_id
)
SELECT
  source.tab_id, source.section_type, source.sort_order, source.visible,
  source.config, source.merch_binding,
  '902de7f7-9b5a-40d5-a6f7-100737826e76'::uuid
FROM section_manifests source
WHERE source.tab_id = '6bd5bbe3-a99c-4fa4-a1b1-07e146ec918e'::uuid
  AND source.shop_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM section_manifests scoped
    WHERE scoped.tab_id = source.tab_id
      AND scoped.shop_id = '902de7f7-9b5a-40d5-a6f7-100737826e76'::uuid
  );

INSERT INTO section_layout_scopes (tab_id, shop_id)
VALUES (
  '6bd5bbe3-a99c-4fa4-a1b1-07e146ec918e'::uuid,
  '902de7f7-9b5a-40d5-a6f7-100737826e76'::uuid
)
ON CONFLICT (tab_id, shop_id) DO NOTHING;

UPDATE section_manifests
SET
  config = jsonb_build_object(
    'title', 'FreshCuts family favourites',
    'subtitle', 'Fresh cuts, selected for your kitchen',
    'columns', 2,
    'product_card_style', 'PREMIUM_FRESH',
    'card_shape', 'rounded',
    'image_ratio', '1:1',
    'show_quick_add', true
  ),
  merch_binding = jsonb_build_object(
    'source', 'manual',
    'limit', 4,
    'product_ids', jsonb_build_array(
      (SELECT id FROM products WHERE slug = 'kolkata-demo-chicken-breast-500g'),
      (SELECT id FROM products WHERE slug = 'kolkata-demo-mutton-curry-500g'),
      (SELECT id FROM products WHERE slug = 'kolkata-demo-salmon-steak-250g'),
      (SELECT id FROM products WHERE slug = 'kolkata-demo-farm-eggs-6')
    )
  ),
  updated_at = NOW()
WHERE tab_id = '6bd5bbe3-a99c-4fa4-a1b1-07e146ec918e'::uuid
  AND shop_id = '902de7f7-9b5a-40d5-a6f7-100737826e76'::uuid
  AND section_type = 'category_product_grid'
  AND sort_order = 5;
