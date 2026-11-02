-- Preserve the specific rank-zero character used to verify installation ownership.
-- A later Blizzard roster refresh may no longer list that character.
ALTER TABLE installation_guild_binding
  ADD COLUMN verified_gm_character_record_id uuid REFERENCES character_roster(character_record_id) ON DELETE RESTRICT;

COMMENT ON COLUMN installation_guild_binding.verified_gm_character_record_id IS
  'Character whose observed rank zero established installation GM verification; used once to seed initial Manual operational authority.';
