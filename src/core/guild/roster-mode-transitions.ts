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
