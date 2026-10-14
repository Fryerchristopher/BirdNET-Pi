-- Only for databases created before 2026-10-14. Fresh installs get these columns from schema.sql.
ALTER TABLE species_images ADD COLUMN author_name TEXT NOT NULL DEFAULT '';
ALTER TABLE species_images ADD COLUMN license_name TEXT NOT NULL DEFAULT '';
