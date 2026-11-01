/**
 * Effective character membership/rank, selected by the persisted guild roster mode.
 *
 * Manual remains empty until explicitly initialized. Blizzard observations never
 * become a fallback for an uninitialized Manual roster.
 * This is a read contract, not a writable roster or a second persisted authority.
 */
export const effectiveGuildRosterSql = `(
  SELECT declared.guild_id, declared.character_record_id, declared.rank_index
    FROM guild_roster_management management
    JOIN guild_declared_roster declared ON declared.guild_id = management.guild_id
   WHERE management.mode = 'manual'
     AND management.manual_initialized_at IS NOT NULL
  UNION ALL
  SELECT observed.guild_id, observed.character_record_id, observed.rank_index
    FROM guild_roster_management management
    JOIN guild_roster observed ON observed.guild_id = management.guild_id
   WHERE management.mode = 'blizzard_sync'
     AND observed.currently_present = true
)`;
