import { pool } from "../../db.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { canManageGuildRoster } from "../authority/guild-capability-policy.js";
import { effectiveGuildRosterSql } from "./effective-roster.js";

export async function rosterMembersView(actorIdentityId: string) {
  const { guildId } = await requireOperationalInstallationGuildBinding();
  if (!await canManageGuildRoster(actorIdentityId, guildId)) throw new Error("roster_management_forbidden");
  const management = await pool.query<{mode: "manual" | "blizzard_sync"; manual_initialized_at: Date | null}>(
    "SELECT mode, manual_initialized_at FROM guild_roster_management WHERE guild_id = $1", [guildId]);
  const mode = management.rows[0]?.mode ?? "manual";
  const initialized = management.rows[0]?.manual_initialized_at != null;
  const result = await pool.query<{character_record_id: string; name: string; realm: string | null; level: number | null; rank_index: number; rank_display_name: string | null; observed_rank: number | null}>(
    `SELECT effective.character_record_id, cr.name, cr.realm_slug AS realm, cr.level,
            effective.rank_index, ranks.display_name AS rank_display_name, observed.rank_index AS observed_rank
       FROM ${effectiveGuildRosterSql} effective
       JOIN character_roster cr ON cr.character_record_id = effective.character_record_id
       LEFT JOIN guild_rank_definitions ranks ON ranks.guild_id = effective.guild_id AND ranks.rank_index = effective.rank_index
       LEFT JOIN guild_roster observed ON observed.guild_id = effective.guild_id
         AND observed.character_record_id = effective.character_record_id AND observed.currently_present = true
      WHERE effective.guild_id = $1
      ORDER BY lower(cr.name), lower(coalesce(cr.realm_slug, '')), effective.character_record_id`, [guildId]);
  return { mode, initialized, members: result.rows.map(row => ({
    characterRecordId: row.character_record_id, name: row.name, realm: row.realm,
    level: row.level, rankIndex: row.rank_index, rankDisplayName: row.rank_display_name,
    observedRank: row.observed_rank,
    discrepancy: mode === "manual" && row.observed_rank !== row.rank_index,
  })) };
}
