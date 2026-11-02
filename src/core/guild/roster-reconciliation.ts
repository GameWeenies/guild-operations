import { createHash } from "node:crypto";
import { pool } from "../../db.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { canManageGuildRoster } from "../authority/guild-capability-policy.js";

export type RosterDiscrepancy = {
  characterRecordId: string;
  name: string;
  realm: string | null;
  level: number | null;
  declaredRank: number | null;
  observedRank: number | null;
  kind: "declared_only" | "observed_only" | "rank_mismatch";
};

export function compareRosterEntries(
  declared: ReadonlyMap<string, number>,
  observed: ReadonlyMap<string, number>,
): Array<{ characterRecordId: string; declaredRank: number | null; observedRank: number | null; kind: RosterDiscrepancy["kind"] }> {
  const differences: Array<{ characterRecordId: string; declaredRank: number | null; observedRank: number | null; kind: RosterDiscrepancy["kind"] }> = [];
  for (const id of [...new Set([...declared.keys(), ...observed.keys()])].sort()) {
    const d = declared.get(id) ?? null;
    const o = observed.get(id) ?? null;
    if (d === o) continue;
    differences.push({ characterRecordId: id, declaredRank: d, observedRank: o,
      kind: d === null ? "observed_only" : o === null ? "declared_only" : "rank_mismatch" });
  }
  return differences;
}

/** Read-only comparison. Neither roster nor management mode is modified. */
export async function rosterReconciliationPreview(actorIdentityId: string) {
  const { guildId } = await requireOperationalInstallationGuildBinding();
  if (!await canManageGuildRoster(actorIdentityId, guildId)) {
    throw new Error("roster_management_forbidden");
  }
  const state = await pool.query<{ mode: string; manual_initialized_at: Date | null; acquired_at: Date | null; source_last_modified_at: Date | null }>(
    `SELECT m.mode, m.manual_initialized_at, o.acquired_at, o.source_last_modified_at
       FROM guild_roster_management m
       LEFT JOIN guild_roster_observation_state o ON o.guild_id = m.guild_id
      WHERE m.guild_id = $1`, [guildId],
  );
  if (!state.rowCount) throw new Error("roster_management_missing");
  const entries = await pool.query<{
    character_record_id: string; name: string; realm_slug: string | null; level: number | null;
    declared_rank: number | null; observed_rank: number | null;
  }>(
    `SELECT cr.character_record_id, cr.name, cr.realm_slug, cr.level,
            d.rank_index AS declared_rank, o.rank_index AS observed_rank
       FROM character_roster cr
       JOIN (
         SELECT character_record_id FROM guild_declared_roster WHERE guild_id = $1
         UNION
         SELECT character_record_id FROM guild_roster WHERE guild_id = $1 AND currently_present = true
       ) members ON members.character_record_id = cr.character_record_id
       LEFT JOIN guild_declared_roster d ON d.guild_id = $1 AND d.character_record_id = cr.character_record_id
       LEFT JOIN guild_roster o ON o.guild_id = $1 AND o.character_record_id = cr.character_record_id AND o.currently_present = true
      ORDER BY cr.character_record_id`, [guildId],
  );
  const declared = new Map<string, number>();
  const observed = new Map<string, number>();
  for (const row of entries.rows) {
    if (row.declared_rank !== null) declared.set(row.character_record_id, row.declared_rank);
    if (row.observed_rank !== null) observed.set(row.character_record_id, row.observed_rank);
  }
  const details = new Map(entries.rows.map((row) => [row.character_record_id, row]));
  const differences: RosterDiscrepancy[] = compareRosterEntries(declared, observed).map((difference) => {
    const row = details.get(difference.characterRecordId)!;
    return { ...difference, name: row.name, realm: row.realm_slug, level: row.level };
  });
  const snapshotVersion = createHash("sha256").update(JSON.stringify(
    entries.rows.map((row) => [row.character_record_id, row.declared_rank, row.observed_rank]),
  )).digest("hex");
  return {
    guildId, mode: state.rows[0].mode,
    manualInitialized: state.rows[0].manual_initialized_at !== null,
    observationAcquiredAt: state.rows[0].acquired_at,
    sourceLastModifiedAt: state.rows[0].source_last_modified_at,
    snapshotVersion, differences,
  };
}
