import { createHash } from "node:crypto";
import { pool } from "../../db.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { canManageGuildRoster } from "../authority/guild-capability-policy.js";

export type RosterDifference = {
  characterRecordId: string;
  name: string;
  realm: string | null;
  level: number | null;
  declaredRankIndex: number | null;
  observedRankIndex: number | null;
  kind: "declared_only" | "observed_only" | "rank_mismatch";
};

type RosterRow = {
  character_record_id: string;
  name: string;
  realm: string | null;
  level: number | null;
  declared_rank_index: number | null;
  observed_rank_index: number | null;
};

/** Compare independent roster sources without modifying either one. */
export function rosterDifferences(rows: readonly RosterRow[]): RosterDifference[] {
  return rows.flatMap((row) => {
    const declared = row.declared_rank_index;
    const observed = row.observed_rank_index;
    if (declared === observed) return [];
    return [{
      characterRecordId: row.character_record_id,
      name: row.name,
      realm: row.realm,
      level: row.level,
      declaredRankIndex: declared,
      observedRankIndex: observed,
      kind: declared === null ? "observed_only" : observed === null ? "declared_only" : "rank_mismatch",
    }];
  });
}

export async function rosterReconciliationPreview(actorIdentityId: string) {
  const { guildId } = await requireOperationalInstallationGuildBinding();
  if (!await canManageGuildRoster(actorIdentityId, guildId)) {
    throw new Error("roster_management_forbidden");
  }
  const [management, observations, roster] = await Promise.all([
    pool.query<{ mode: string; manual_initialized_at: Date | null }>(
      "SELECT mode, manual_initialized_at FROM guild_roster_management WHERE guild_id = $1", [guildId],
    ),
    pool.query<{ acquired_at: Date; source_last_modified_at: Date | null }>(
      "SELECT acquired_at, source_last_modified_at FROM guild_roster_observation_state WHERE guild_id = $1", [guildId],
    ),
    pool.query<RosterRow>(
      `SELECT cr.character_record_id, cr.name, cr.realm_slug AS realm, cr.level,
              declared.rank_index AS declared_rank_index, observed.rank_index AS observed_rank_index
         FROM character_roster cr
         LEFT JOIN guild_declared_roster declared
           ON declared.character_record_id = cr.character_record_id AND declared.guild_id = $1
         LEFT JOIN guild_roster observed
           ON observed.character_record_id = cr.character_record_id
          AND observed.guild_id = $1 AND observed.currently_present = true
        WHERE declared.character_record_id IS NOT NULL OR observed.character_record_id IS NOT NULL
        ORDER BY cr.name, cr.realm_slug, cr.character_record_id`,
      [guildId],
    ),
  ]);
  const differences = rosterDifferences(roster.rows);
  // Version covers both sources, not merely the latest observation timestamp.
  const snapshotVersion = createHash("sha256").update(JSON.stringify(
    roster.rows.map((row) => [row.character_record_id, row.declared_rank_index, row.observed_rank_index]),
  )).digest("hex");
  return {
    guildId,
    mode: management.rows[0]?.mode ?? null,
    manualInitialized: management.rows[0]?.manual_initialized_at != null,
    observedAcquiredAt: observations.rows[0]?.acquired_at ?? null,
    observedSourceLastModifiedAt: observations.rows[0]?.source_last_modified_at ?? null,
    snapshotVersion,
    differences,
  };
}
