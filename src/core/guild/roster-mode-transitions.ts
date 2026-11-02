import { loadReconciliationRows, reconciliationVersion } from "./roster-reconciliation.js";
import { validCharacterRecordId } from "./manual-roster-operations.js";
import { withTransaction } from "../../db.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { canManageGuildRoster } from "../authority/guild-capability-policy.js";
import { publishEmission, deliverEmission } from "../../emissions/registry.js";
import { publishGuildRefreshObservation } from "./guild-refresh-observers.js";
import { effectiveGuildRosterSql } from "./effective-roster.js";
import { guildieRosterTransitions, type GuildieRosterState } from "./guildie-roster-transitions.js";
import type { PoolClient } from "pg";

export class RosterModeTransitionError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function effectiveGuildies(client: PoolClient, guildId: string) {
  const result = await client.query<{ identity_id: string; rank_index: number }>(
    "SELECT ccr.identity_id, MIN(gr.rank_index)::integer AS rank_index FROM controlled_character_roster ccr JOIN " +
      effectiveGuildRosterSql +
      " gr ON gr.character_record_id = ccr.character_record_id WHERE ccr.currently_controlled = true AND gr.guild_id = $1 GROUP BY ccr.identity_id",
    [guildId],
  );
  return new Map<string, GuildieRosterState>(result.rows.map((row) => [
    row.identity_id, { identityId: row.identity_id, rankIndex: row.rank_index },
  ]));
}

export async function activateBlizzardSync(actorIdentityId: string, acknowledged: boolean) {
  if (acknowledged !== true) throw new RosterModeTransitionError("risk_acknowledgment_required");
  const { guildId } = await requireOperationalInstallationGuildBinding();
  if (!await canManageGuildRoster(actorIdentityId, guildId)) {
    throw new RosterModeTransitionError("roster_management_forbidden");
  }
  const result = await withTransaction(async (client) => {
    await client.query("SELECT guild_id FROM guilds WHERE guild_id = $1 FOR UPDATE", [guildId]);
    const state = await client.query<{ mode: string; manual_initialized_at: Date | null }>(
      "SELECT mode, manual_initialized_at FROM guild_roster_management WHERE guild_id = $1 FOR UPDATE", [guildId],
    );
    if (state.rows[0]?.mode !== "manual" || !state.rows[0].manual_initialized_at) {
      throw new RosterModeTransitionError("manual_roster_not_active");
    }
    const observation = await client.query(
      "SELECT 1 FROM guild_roster_observation_state WHERE guild_id = $1", [guildId],
    );
    if (!observation.rowCount) throw new RosterModeTransitionError("blizzard_snapshot_missing");
    const before = await effectiveGuildies(client, guildId);
    await client.query(
      "UPDATE guild_roster_management SET mode = 'blizzard_sync', updated_at = now() WHERE guild_id = $1",
      [guildId],
    );
    const after = await effectiveGuildies(client, guildId);
    const transitions = guildieRosterTransitions(before, after);
    const publications = [];
    for (const transition of transitions) {
      publications.push(await publishEmission(client, { code: transition.code, subject: transition.identityId }));
    }
    return { transitions, publications };
  });
  for (const publication of result.publications) await deliverEmission(publication);
  await publishGuildRefreshObservation({
    guildId, changedIdentityIds: result.transitions.map((transition) => transition.identityId),
  });
  return { guildId, mode: "blizzard_sync", effectiveTransitions: result.transitions.length };
}

/** Apply only selected current discrepancies and switch authority in one transaction. */
export async function activateManualWithReconciliation(
  actorIdentityId: string,
  reviewedSnapshotVersion: string,
  selectedCharacterRecordIds: readonly string[],
) {
  if (!/^[a-f0-9]{64}$/.test(reviewedSnapshotVersion) ||
      new Set(selectedCharacterRecordIds).size !== selectedCharacterRecordIds.length ||
      selectedCharacterRecordIds.some((id) => !validCharacterRecordId(id))) {
    throw new RosterModeTransitionError("invalid_reconciliation_selection");
  }
  const { guildId } = await requireOperationalInstallationGuildBinding();
  if (!await canManageGuildRoster(actorIdentityId, guildId)) {
    throw new RosterModeTransitionError("roster_management_forbidden");
  }
  const result = await withTransaction(async (client) => {
    await client.query("SELECT guild_id FROM guilds WHERE guild_id = $1 FOR UPDATE", [guildId]);
    const state = await client.query<{ mode: string; manual_initialized_at: Date | null }>(
      "SELECT mode, manual_initialized_at FROM guild_roster_management WHERE guild_id = $1 FOR UPDATE", [guildId],
    );
    if (state.rows[0]?.mode !== "blizzard_sync" || !state.rows[0].manual_initialized_at) {
      throw new RosterModeTransitionError("blizzard_sync_not_active");
    }
    const rows = await loadReconciliationRows(client, guildId);
    if (reconciliationVersion(rows) !== reviewedSnapshotVersion) {
      throw new RosterModeTransitionError("roster_snapshot_changed");
    }
    const differences = new Map(rows.filter((row) => row.declared_rank !== row.observed_rank)
      .map((row) => [row.character_record_id, row]));
    if (selectedCharacterRecordIds.some((id) => !differences.has(id))) {
      throw new RosterModeTransitionError("invalid_reconciliation_selection");
    }
    const before = await effectiveGuildies(client, guildId);
    for (const characterId of selectedCharacterRecordIds) {
      const observedRank = differences.get(characterId)!.observed_rank;
      if (observedRank === null) {
        await client.query(
          "DELETE FROM guild_declared_roster WHERE guild_id = $1 AND character_record_id = $2",
          [guildId, characterId],
        );
      } else {
        const rank = await client.query(
          "SELECT 1 FROM guild_rank_definitions WHERE guild_id = $1 AND rank_index = $2 AND active = true",
          [guildId, observedRank],
        );
        if (!rank.rowCount) throw new RosterModeTransitionError("observed_rank_unavailable");
        await client.query(
          "INSERT INTO guild_declared_roster (guild_id, character_record_id, rank_index) VALUES ($1,$2,$3) ON CONFLICT (guild_id, character_record_id) DO UPDATE SET rank_index = EXCLUDED.rank_index, updated_at = now()",
          [guildId, characterId, observedRank],
        );
      }
    }
    await client.query(
      "UPDATE guild_roster_management SET mode = 'manual', updated_at = now() WHERE guild_id = $1",
      [guildId],
    );
    const after = await effectiveGuildies(client, guildId);
    const transitions = guildieRosterTransitions(before, after);
    const publications = [];
    for (const transition of transitions) {
      publications.push(await publishEmission(client, { code: transition.code, subject: transition.identityId }));
    }
    return { transitions, publications };
  });
  for (const publication of result.publications) await deliverEmission(publication);
  await publishGuildRefreshObservation({
    guildId, changedIdentityIds: result.transitions.map((transition) => transition.identityId),
  });
  return { guildId, mode: "manual", applied: selectedCharacterRecordIds.length, effectiveTransitions: result.transitions.length };
}
