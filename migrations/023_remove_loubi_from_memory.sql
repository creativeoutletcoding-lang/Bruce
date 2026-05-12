-- Remove "Loubi" nickname from all memory records.
-- Laurianne's name is Laurianne everywhere — in the UI, in Bruce's context,
-- and in his responses. These records were generated before that was enforced
-- and were the source of Bruce occasionally addressing her by the wrong name.

-- Update: strip the nickname, preserve the underlying factual content.

UPDATE memory
SET content = 'Jake Johnson''s wife is named Laurianne.'
WHERE id = '14079b3a-b514-4cba-a7de-77685662264b';

UPDATE memory
SET content = 'Jake Johnson is planning a 10th wedding anniversary trip in July with his wife Laurianne, three kids (Elliot, age 8, and twins Henry and Violette, age 5), and Nana.'
WHERE id = '6317778d-37ea-4076-9893-3c28275ffdf3';

UPDATE memory
SET content = 'Laurianne Johnson is Jake''s wife.'
WHERE id = '9c8b5784-3bb8-4f3f-ab42-d486efbbe4f6';

UPDATE memory
SET content = 'Jake Johnson''s wife Laurianne is originally from Quebec City, Canada and is a native French speaker.'
WHERE id = '89292b7a-1c22-47b4-a294-079890190a84';

UPDATE memory
SET content = 'Jake Johnson''s wife is named Laurianne.'
WHERE id = '495e6dac-b7a1-4eca-a78b-590cb75ae473';

UPDATE memory
SET content = 'Jake Johnson is planning a 10th wedding anniversary trip in July with his wife Laurianne, three kids, and Nana.'
WHERE id = '8a7c8c7b-f44a-4866-aad4-76dbb67b2a96';

-- Delete: content is solely about the Loubi nickname with nothing to preserve.

DELETE FROM memory WHERE id = '4b24add6-b7a1-4eca-a78b-590cb75ae473';
DELETE FROM memory WHERE id = '4b24add6-28de-4eed-8595-eb37d8b13a02';
DELETE FROM memory WHERE id = 'b914f177-ab8e-4332-b09b-29e4518d91f0';
DELETE FROM memory WHERE id = 'ae4813c2-c409-422e-8a67-3d6ecdf526d1';
