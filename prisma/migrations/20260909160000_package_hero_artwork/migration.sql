-- Populate empty starter-package artwork while preserving operator uploads.
UPDATE "StoragePackage"
SET "imageUrl" = 'https://stor4.srv938083.hstgr.cloud/images/merchandise/stor24-package-hero.png'
WHERE ("imageUrl" IS NULL OR "imageUrl" = '')
  AND "name" IN ('Box Basics', 'Compact Move', 'Move Ready', 'Home Move', 'Family Move', 'Business Move');
