import type { PoolClient } from "pg";
import { publishEmission, deliverEmission } from "../../emissions/registry.js";
import { effectiveGuildRosterSql } from "./effective-roster.js";
import { guildieRosterTransitions, type GuildieRosterState } from "./guildie-roster-transitions.js";
import { publishGuildRefreshObservation } from "./guild-refresh-observers.js";
import { withTransaction } from "../../db.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { canManageGuildRoster } from "../authority/guild-capability-policy.js";

export class ManualRosterOperationError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function validRosterRank(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 9;
}

export function validCharacterRecordId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function effectiveGuildies(client: PoolClient, guildId: string): Promise<Map<string, GuildieRosterState>> {
  const result = await client.query<{ identity_id: string; rank_index: number }>(
    `SELECT ccr.identity_id, MIN(gr.rank_index)::integer AS rank_index
       FROM controlled_character_roster ccr
       JOIN ${effectiveGuildRosterSql} gr ON gr.character_record_id = ccr.character_record_id
      WHERE ccr.currently_controlled = true AND gr.guild_id = $1
      GROUP BY ccr.identity_id`,
    [guildId],
  );
  return new Map(result.rows.map((row) => [row.identity_id, {
    identityId: row.identity_id, rankIndex: row.rank_index,
  }]));
}

/** Operates only on declared membership. Blizzard observations are never modified. */
export async function changeManualRosterMember(input: {
  actorIdentityId: string;
  characterRecordId: string;
  action: "add" | "remove" | "rank";
  rankIndex?: number;
}): Promise<{ guildId: string; characterRecordId: string; action: string }> {
  const binding = await requireOperationalInstallationGuildBinding();
  if (!await canManageGuildRoster(input.actorIdentityId, binding.guildId)) {
    throw new ManualRosterOperationError("roster_management_forbidden");
  }
  if (!validCharacterRecordId(input.characterRecordId) ||
    (input.action !== "remove" && !validRosterRank(input.rankIndex))) {
    throw new ManualRosterOperationError("invalid_roster_member_operation");
  }
  const result = await withTransaction(async (client) => {
    await client.query("SELECT guild_id FROM guilds WHERE guild_id = $1 FOR UPDATE", [binding.guildId]);
    const state = await client.query<{ mode: string; manual_initialized_at: Date | null }>(
      "SELECT mode, manual_initialized_at FROM guild_roster_management WHERE guild_id = $1 FOR UPDATE",
      [binding.guildId],
    );
    if (state.rows[0]?.mode !== "manual" || !state.rows[0].manual_initialized_at) {
      throw new ManualRosterOperationError("manual_roster_not_active");
    }
    const before = await effectiveGuildies(client, binding.guildId);
    if (input.action !== "remove") {
      const rank = await client.query(
        "SELECT 1 FROM guild_rank_definitions WHERE guild_id = $1 AND rank_index = $2 AND active = true",
        [binding.guildId, input.rankIndex],
      );
      if (!rank.rowCount) throw new ManualRosterOperationError("unknown_guild_rank");
    }
    if (input.action === "add") {
      const character = await client.query(
        "SELECT 1 FROM character_roster WHERE character_record_id = $1",
        [input.characterRecordId],
      );
      if (!character.rowCount) throw new ManualRosterOperationError("unknown_character");
      const result = await client.query(
        "INSERT INTO guild_declared_roster (guild_id, character_record_id, rank_index) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [binding.guildId, input.characterRecordId, input.rankIndex],
      );
      if (!result.rowCount) throw new ManualRosterOperationError("member_already_declared");
    } else if (input.action === "remove") {
      const result = await client.query(
        "DELETE FROM guild_declared_roster WHERE guild_id = $1 AND character_record_id = $2",
        [binding.guildId, input.characterRecordId],
      );
      if (!result.rowCount) throw new ManualRosterOperationError("member_not_declared");
    } else {
      const result = await client.query(
        "UPDATE guild_declared_roster SET rank_index = $3, updated_at = now() WHERE guild_id = $1 AND character_record_id = $2",
        [binding.guildId, input.characterRecordId, input.rankIndex],
      );
      if (!result.rowCount) throw new ManualRosterOperationError("member_not_declared");
    }
    const after = await effectiveGuildies(client, binding.guildId);
    const transitions = guildieRosterTransitions(before, after);
    const publications = [];
    for (const transition of transitions) {
      publications.push(await publishEmission(client, {
        code: transition.code, subject: transition.identityId,
      }));
    }
    return { transitions, publications };
  });
  for (const publication of result.publications) await deliverEmission(publication);
  await publishGuildRefreshObservation({
    guildId: binding.guildId,
    changedIdentityIds: result.transitions.map((transition) => transition.identityId),
  });
  return { guildId: binding.guildId, characterRecordId: input.characterRecordId, action: input.action };
}
