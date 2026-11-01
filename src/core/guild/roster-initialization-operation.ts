import { createHash } from "node:crypto";
import { pool, withTransaction } from "../../db.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { initializeManualRosterFromReviewedSnapshot } from "./roster-reviewed-import.js";

export class RosterInitializationConflict extends Error {
  constructor() { super("roster_initialization_conflict"); }
}

type ObservedMember = {
  characterRecordId: string;
  name: string;
  realm: string;
  level: number | null;
  rankIndex: number;
};

async function observedMembers(guildId: string): Promise<ObservedMember[]> {
  const result = await pool.query<{
    character_record_id: string; name: string; realm: string; level: number | null; rank_index: number;
  }>(
    `SELECT gr.character_record_id, cr.name, cr.realm_slug AS realm,
            cr.level, gr.rank_index
       FROM guild_roster gr
       JOIN character_roster cr ON cr.character_record_id = gr.character_record_id
      WHERE gr.guild_id = $1 AND gr.currently_present = true
      ORDER BY gr.character_record_id`,
    [guildId],
  );
  return result.rows.map((row) => ({
    characterRecordId: row.character_record_id,
    name: row.name, realm: row.realm, level: row.level, rankIndex: row.rank_index,
  }));
}

function snapshotVersion(members: readonly ObservedMember[]): string {
  return createHash("sha256").update(JSON.stringify(members)).digest("hex");
}

/** A verified installation GM, not a rank-derived GO capability, owns bootstrap. */
async function requireInitializationOperator(identityId: string): Promise<string> {
  const binding = await requireOperationalInstallationGuildBinding();
  if (binding.authorizationKind !== "guild_master" || binding.authorizedByIdentityId !== identityId) {
    throw new Error("roster_initialization_forbidden");
  }
  return binding.guildId;
}

export async function manualRosterInitializationPreview(identityId: string) {
  const guildId = await requireInitializationOperator(identityId);
  const state = await pool.query<{ mode: string; manual_initialized_at: Date | null }>(
    "SELECT mode, manual_initialized_at FROM guild_roster_management WHERE guild_id = $1",
    [guildId],
  );
  const members = await observedMembers(guildId);
  return {
    guildId,
    mode: state.rows[0]?.mode ?? null,
    initialized: state.rows[0]?.manual_initialized_at != null,
    snapshotVersion: snapshotVersion(members),
    members,
  };
}

export async function commitManualRosterInitialization(
  identityId: string,
  reviewedSnapshotVersion: string,
  selectedCharacterRecordIds: readonly string[],
) {
  const guildId = await requireInitializationOperator(identityId);
  return withTransaction(async (client) => {
    // Serialize snapshot refresh/import on this guild before comparing the
    // operator-reviewed preview to current observed membership and ranks.
    await client.query("SELECT guild_id FROM guilds WHERE guild_id = $1 FOR UPDATE", [guildId]);
    const result = await client.query<{
      character_record_id: string; name: string; realm: string; level: number | null; rank_index: number;
    }>(
      `SELECT gr.character_record_id, cr.name, cr.realm_slug AS realm,
              cr.level, gr.rank_index
         FROM guild_roster gr
         JOIN character_roster cr ON cr.character_record_id = gr.character_record_id
        WHERE gr.guild_id = $1 AND gr.currently_present = true
        ORDER BY gr.character_record_id FOR UPDATE OF gr`,
      [guildId],
    );
    const members = result.rows.map((row) => ({
      characterRecordId: row.character_record_id,
      name: row.name, realm: row.realm, level: row.level, rankIndex: row.rank_index,
    }));
    if (snapshotVersion(members) !== reviewedSnapshotVersion) throw new RosterInitializationConflict();
    const imported = await initializeManualRosterFromReviewedSnapshot(client, guildId, selectedCharacterRecordIds);
    return { guildId, imported };
  });
}
