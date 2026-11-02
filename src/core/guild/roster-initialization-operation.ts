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
    // Preserve the verified GM's operational authority even if the latest
    // Blizzard observation omits the character that proved rank zero.
    const verified = await client.query<{ verified_gm_character_record_id: string | null }>(
      `SELECT verified_gm_character_record_id FROM installation_guild_binding
        WHERE singleton = true AND guild_id = $1 AND authorization_kind = 'guild_master'
          AND authorized_by_identity_id = $2 FOR UPDATE`,
      [guildId, identityId],
    );
    let gmCharacterId = verified.rows[0]?.verified_gm_character_record_id ?? null;
    // Existing installations verified before the character was recorded can
    // recover it from their still-observed rank-zero character.
    if (!gmCharacterId && verified.rowCount) {
      const legacy = await client.query<{ character_record_id: string }>(
        `SELECT gr.character_record_id FROM guild_roster gr
          JOIN controlled_character_roster ccr ON ccr.character_record_id = gr.character_record_id
         WHERE gr.guild_id = $1 AND gr.rank_index = 0 AND gr.currently_present = true
           AND ccr.identity_id = $2 AND ccr.currently_controlled = true
         ORDER BY gr.character_record_id LIMIT 1`, [guildId, identityId],
      );
      gmCharacterId = legacy.rows[0]?.character_record_id ?? null;
    }
    if (!gmCharacterId) throw new Error("verified_gm_character_unavailable");
    const control = await client.query(
      `SELECT 1 FROM controlled_character_roster WHERE character_record_id = $1
        AND identity_id = $2 AND currently_controlled = true`, [gmCharacterId, identityId],
    );
    if (!control.rowCount) throw new Error("verified_gm_character_not_controlled");
    const imported = await initializeManualRosterFromReviewedSnapshot(client, guildId, selectedCharacterRecordIds);
    await client.query(
      `INSERT INTO guild_declared_roster (guild_id, character_record_id, rank_index)
       VALUES ($1, $2, 0) ON CONFLICT (guild_id, character_record_id)
       DO UPDATE SET rank_index = 0, updated_at = now()`, [guildId, gmCharacterId],
    );
    return { guildId, imported };
  });
}
