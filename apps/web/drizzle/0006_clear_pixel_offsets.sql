-- Selector offsets switched from absolute pixels (from element top-left) to
-- normalized fractions of the element's width/height (0–1). Existing rows
-- have pixel values which would be misinterpreted as fractions and place the
-- pin far off, so clear the selector + offsets and let those threads fall
-- back to their persisted x/y until they're re-anchored.
UPDATE "thread"
SET "selector" = NULL,
    "offset_x" = NULL,
    "offset_y" = NULL
WHERE "selector" IS NOT NULL;
