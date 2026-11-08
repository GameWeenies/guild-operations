-- Existing pre-release Raid rows retain their history; obsolete eligibility is discarded.
ALTER TABLE raid_events DROP COLUMN IF EXISTS eligibility;

-- Existing Discord installations retain signup behavior until operators disable it.
ALTER TABLE discord_integration_configuration
  ADD COLUMN IF NOT EXISTS allow_raid_signups boolean NOT NULL DEFAULT true;
