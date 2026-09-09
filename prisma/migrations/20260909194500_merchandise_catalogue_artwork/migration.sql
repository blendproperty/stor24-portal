UPDATE "Product"
SET "imageUrl" = CASE "name"
  WHEN '70mm Disc Padlock' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/disc-padlock.png'
  WHEN 'Archive Box' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/archive-box.png'
  WHEN 'Bubble Wrap 1.2m x 1m' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/bubble-wrap-1m.png'
  WHEN 'Bubble Wrap 1.2m x 5m' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/bubble-wrap-5m.png'
  WHEN 'Fragile Sticker' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/fragile-sticker.png'
  WHEN 'Jumbo Goods Protector' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/jumbo-goods-protector.png'
  WHEN 'Large Goods Protector' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/large-goods-protector.png'
  WHEN 'Large Moving Box' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/large-moving-box.png'
  WHEN 'Medium Moving Box' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/medium-moving-box.png'
  WHEN 'Packing Tape 100m' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/packing-tape-100m.png'
  WHEN 'Pallet Wrap 450mm x 400m' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/pallet-wrap.png'
  WHEN 'Permanent Marker' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/permanent-marker.png'
  WHEN 'Small Moving Box' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/small-moving-box.png'
  WHEN 'TV Moving Box' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/tv-moving-box.png'
  WHEN 'Tape Dispenser' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/tape-dispenser.png'
  WHEN 'Wardrobe Box' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/wardrobe-box.png'
  WHEN 'Weather-Protected Padlock' THEN 'https://stor4.srv938083.hstgr.cloud/images/merchandise/products/weather-protected-padlock.png'
  ELSE "imageUrl"
END
WHERE "name" IN (
  '70mm Disc Padlock',
  'Archive Box',
  'Bubble Wrap 1.2m x 1m',
  'Bubble Wrap 1.2m x 5m',
  'Fragile Sticker',
  'Jumbo Goods Protector',
  'Large Goods Protector',
  'Large Moving Box',
  'Medium Moving Box',
  'Packing Tape 100m',
  'Pallet Wrap 450mm x 400m',
  'Permanent Marker',
  'Small Moving Box',
  'TV Moving Box',
  'Tape Dispenser',
  'Wardrobe Box',
  'Weather-Protected Padlock'
);
