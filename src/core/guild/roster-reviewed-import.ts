import type { PoolClient } from "pg";

/**
 * An explicit operator-reviewed initial import. The caller must authenticate
 * the installation's verified GM and present the current snapshot for review
 * before invoking this transaction-bound operation.
 *
 * Character IDs are selected from the currently observed Blizzard snapshot,
 * not accepted as arbitrary client-supplied rank assignments.
 */
export async function initializeManualRosterFromReviewedSnapshot(
  client: PoolClient,
  guildId: string,
  selectedCharacterRecordIds: readonly string[],
): Promise<number> {
  if (new Set(selectedCharacterRecordIds).size !== selectedCharacterRecordIds.length) {
    throw new Error("Reviewed roster selection contains duplicate characters");
  }

  const state = await client.query<{ mode: string; manual_initialized_at: Date | null }>(
    `SELECT mode, manual_initialized_at
       FROM guild_roster_management
      WHERE guild_id = $1 FOR UPDATE`,
    [guildId],
  );
  if (!state.rows[0] || state.rows[0].mode !== "manual" || state.rows[0].manual_initialized_at) {
    throw new Error("Manual roster is not awaiting initialization");
  }

  const snapshot = await client.query<{ character_record_id: string; rank_index: number }>(
    `SELECT character_record_id, rank_index FROM guild_roster
      WHERE guild_id = $1 AND currently_present = true
      FOR UPDATE`,
    [guildId],
  );
  const observed = new Map(snapshot.rows.map((row) => [row.character_record_id, row.rank_index]));
  if (selectedCharacterRecordIds.some((id) => !observed.has(id))) {
    throw new Error("Reviewed roster selection includes a character absent from the Blizzard snapshot");
  }

  for (const characterRecordId of selectedCharacterRecordIds) {
    const rankIndex = observed.get(characterRecordId)!;
    await client.query(
      `INSERT INTO guild_declared_roster (guild_id, character_record_id, rank_index)
       VALUES ($1, $2, $3)`,
      [guildId, characterRecordId, rankIndex],
    );
  }

  await client.query(
    `UPDATE guild_roster_management SET manual_initialized_at = now(), updated_at = now()
      WHERE guild_id = $1 AND manual_initialized_at IS NULL`,
    [guildId],
  );
  return selectedCharacterRecordIds.length;
}
