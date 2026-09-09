-- Make the Kolkata family grid the first product section on Home. The old
-- Trending rail is converted in-place so customers see the new family-card
-- design before any legacy product-card section.

UPDATE section_manifests
SET
  section_type = 'category_product_grid',
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
  AND sort_order = 2;

UPDATE section_manifests
SET visible = false, updated_at = NOW()
WHERE tab_id = '6bd5bbe3-a99c-4fa4-a1b1-07e146ec918e'::uuid
  AND shop_id = '902de7f7-9b5a-40d5-a6f7-100737826e76'::uuid
  AND sort_order = 5
  AND section_type = 'category_product_grid';
