import { effectiveGuildRosterSql } from "./effective-roster.js";
import type { PoolClient } from "pg";
import { acquireGuildAuthorityByReference, type BlizzardGuildProfile, type BlizzardGuildRoster } from "../../blizzard.js";
import type { Region } from "../../config.js";
import { pool, withTransaction } from "../../db.js";
import { deliverEmission, publishEmission } from "../../emissions/registry.js";
import {
  GUILD_REFRESH_CAPABILITY,
  GUILD_REFRESH_SCHEDULE_CONFIGURE_CAPABILITY,
  OPERATIONS_INSPECT_CAPABILITY,
} from "../authority/guild-permissions.js";
import { publishGuildRefreshObservation } from "./guild-refresh-observers.js";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import {
  enrichGuildCharacters,
  guildCharactersNeedingEnrichment,
  type GuildCharacterCoordinate,
} from "./guild-character-enrichment.js";

function factionValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const typed = value as { type?: unknown; name?: unknown };
    if (typeof typed.type === "string") return typed.type;
    if (typeof typed.name === "string") return typed.name;
  }
  return null;
}

function localizedValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const localized = value as Record<string, unknown>;
    if (typeof localized.en_US === "string") return localized.en_US;
    const first = Object.values(localized).find((candidate) => typeof candidate === "string");
    return typeof first === "string" ? first : null;
  }
  return null;
}

function coordinateKey(character: GuildCharacterCoordinate): string {
  return `${character.region}:${character.realmId}:${character.characterId}`;
}

type GuildieRosterState = {
  identityId: string;
  rankIndex: number;
};

async function guildieRosterState(client: PoolClient, guildId: string): Promise<Map<string, GuildieRosterState>> {
  const result = await client.query<{ identity_id: string; rank_index: number }>(
    `SELECT ccr.identity_id AS identity_id, MIN(gr.rank_index)::integer AS rank_index
       FROM controlled_character_roster ccr
       JOIN ${effectiveGuildRosterSql} gr
         ON gr.character_record_id = ccr.character_record_id
      WHERE ccr.currently_controlled = true
        AND gr.guild_id = $1
      GROUP BY ccr.identity_id`,
    [guildId],
  );

  return new Map(result.rows.map((row) => [row.identity_id, {
    identityId: row.identity_id,
    rankIndex: row.rank_index,
  }]));
}

type GuildieRosterTransition = {
  code: "guildie.joined" | "guildie.left" | "guildie.rank.modified";
  identityId: string;
};

function guildieRosterTransitions(
  before: Map<string, GuildieRosterState>,
  after: Map<string, GuildieRosterState>,
): GuildieRosterTransition[] {
  const transitions: GuildieRosterTransition[] = [];

  for (const [identityId, afterState] of after) {
    const beforeState = before.get(identityId);
    if (!beforeState) {
      transitions.push({ code: "guildie.joined", identityId });
    } else if (beforeState.rankIndex !== afterState.rankIndex) {
      transitions.push({ code: "guildie.rank.modified", identityId });
    }
  }

  for (const identityId of before.keys()) {
    if (!after.has(identityId)) transitions.push({ code: "guildie.left", identityId });
  }

  return transitions;
}

async function persistGuild(
  client: PoolClient,
  region: Region,
  profile: BlizzardGuildProfile,
): Promise<string> {
  const guildId = String(profile.id);
  const realmId = String(profile.realm.id);
  const realmName = localizedValue(profile.realm.name);
  const realmSlug = profile.realm.slug;

  if (!profile.name || !realmSlug) {
    throw new Error("Blizzard guild profile omitted required presentation coordinates");
  }

  await client.query(
    `INSERT INTO guilds (
       guild_id, region, realm_id, name, realm_name, realm_slug, faction, created_timestamp
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (guild_id) DO UPDATE SET
       region = EXCLUDED.region,
       realm_id = EXCLUDED.realm_id,
       name = EXCLUDED.name,
       realm_name = EXCLUDED.realm_name,
       realm_slug = EXCLUDED.realm_slug,
       faction = EXCLUDED.faction,
       created_timestamp = EXCLUDED.created_timestamp,
       last_seen_at = now()`,
    [guildId, region, realmId, profile.name, realmName, realmSlug, factionValue(profile.faction), profile.created_timestamp ?? null],
  );

  return guildId;
}

async function ensureObservedRankDefinition(client: PoolClient, guildId: string, rankIndex: number): Promise<void> {
  await client.query(
    `INSERT INTO guild_rank_definitions (guild_id, rank_index, display_name, active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (guild_id, rank_index) DO UPDATE SET active = true, updated_at = now()`,
    [guildId, rankIndex, `Rank ${rankIndex}`],
  );

  if (rankIndex === 0 || rankIndex === 1 || rankIndex === 2) {
    for (const capability of [
      GUILD_REFRESH_CAPABILITY,
      GUILD_REFRESH_SCHEDULE_CONFIGURE_CAPABILITY,
      OPERATIONS_INSPECT_CAPABILITY,
    ]) {
      await client.query(
        `INSERT INTO guild_rank_capabilities (guild_id, rank_index, capability)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, rank_index, capability) DO NOTHING`,
        [guildId, rankIndex, capability],
      );
    }
  }
}

export async function persistGuildRoster(client: PoolClient, guildId: string, region: Region, roster: BlizzardGuildRoster): Promise<{
  observed: number;
  changedPresentationCoordinates: GuildCharacterCoordinate[];
}> {
  const existingResult = await client.query<{
    character_record_id: string; region: Region; realm_id: string; character_id: string;
    name: string; realm_name: string | null; realm_slug: string | null; currently_present: boolean;
  }>(
    `SELECT cr.character_record_id, cr.region, cr.realm_id, cr.character_id,
            cr.name, cr.realm_name, cr.realm_slug, gr.currently_present
       FROM guild_roster gr
       JOIN character_roster cr ON cr.character_record_id = gr.character_record_id
      WHERE gr.guild_id = $1`, [guildId],
  );
  const existing = new Map(existingResult.rows.map((row) => [
    coordinateKey({ region: row.region, realmId: row.realm_id, characterId: row.character_id }), row,
  ]));

  await client.query(`UPDATE guild_roster SET currently_present = false WHERE guild_id = $1 AND currently_present = true`, [guildId]);

  const observedRanks = new Set<number>();
  const changedPresentationCoordinates: GuildCharacterCoordinate[] = [];
  let observed = 0;

  for (const member of roster.members ?? []) {
    const character = member.character;
    if (!character?.id || !character.realm?.id || !character.name || !Number.isInteger(member.rank)) {
      throw new Error("Blizzard guild roster member omitted a required canonical coordinate or rank");
    }

    const coordinate: GuildCharacterCoordinate = { region, realmId: String(character.realm.id), characterId: String(character.id) };
    const realmName = localizedValue(character.realm.name);
    const realmSlug = character.realm.slug ?? null;
    const previous = existing.get(coordinateKey(coordinate));

    if (!previous || !previous.currently_present || previous.name !== character.name || previous.realm_name !== realmName || previous.realm_slug !== realmSlug) {
      changedPresentationCoordinates.push(coordinate);
    }

    const observedCharacter = await client.query<{ character_record_id: string }>(
      `INSERT INTO character_roster (
         region, realm_id, character_id, name, realm_name, realm_slug
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (region, realm_id, character_id) DO UPDATE SET
         name = EXCLUDED.name,
         realm_name = EXCLUDED.realm_name,
         realm_slug = EXCLUDED.realm_slug,
         last_seen_at = now()
       RETURNING character_record_id`,
      [region, coordinate.realmId, coordinate.characterId, character.name, realmName, realmSlug],
    );
    const characterRecordId = observedCharacter.rows[0]?.character_record_id;
    if (!characterRecordId) throw new Error("Guild roster Character observation was not persisted");

    await client.query(
      `INSERT INTO guild_roster (guild_id, character_record_id, rank_index)
       VALUES ($1,$2,$3)
       ON CONFLICT (guild_id, character_record_id) DO UPDATE SET
         rank_index = EXCLUDED.rank_index,
         last_seen_at = now(),
         currently_present = true`,
      [guildId, characterRecordId, member.rank],
    );
    observedRanks.add(member.rank);
    observed += 1;
  }

  for (const rankIndex of observedRanks) await ensureObservedRankDefinition(client, guildId, rankIndex);
  return { observed, changedPresentationCoordinates };
}

export type GuildRefreshResult = {
  guildId: string;
  rosterCount: number;
  reconciliation: {
    charactersTargeted: number;
    profilesUpdated: number;
    mediaUpdated: number;
    failedProfiles: number;
    failedMedia: number;
    apiCalls: number;
    failures: Array<{
      characterId: string;
      realmId: string;
      name: string;
      stage: "profile" | "media";
      error: string;
    }>;
  };
};

export async function refreshGuildAuthority(): Promise<GuildRefreshResult> {
  const binding = await requireOperationalInstallationGuildBinding();
  const guildResult = await pool.query<{ region: Region; blizzard_reference_href: string | null }>(
    "SELECT region, blizzard_reference_href FROM guilds WHERE guild_id = $1",
    [binding.guildId],
  );
  const guild = guildResult.rows[0];
  if (!guild) throw new Error("Bound guild is not persisted");
  if (!guild.blizzard_reference_href) throw new Error("Bound guild does not have a persisted Blizzard reference");

  const authority = await acquireGuildAuthorityByReference({
    region: guild.region,
    referenceHref: guild.blizzard_reference_href,
  });
  if (String(authority.profile.id) !== binding.guildId) throw new Error(`Persisted guild locator resolved unexpected Blizzard guild id ${String(authority.profile.id)}`);
  if (String(authority.roster.guild.id) !== binding.guildId) throw new Error("Blizzard guild roster does not corroborate the bound guild id");

  const persisted = await withTransaction(async (client) => {
    await client.query("SELECT guild_id FROM guilds WHERE guild_id = $1 FOR UPDATE", [binding.guildId]);
    const guildId = await persistGuild(client, guild.region, authority.profile);
    const beforeGuildies = await guildieRosterState(client, guildId);
    const roster = await persistGuildRoster(client, guildId, guild.region, authority.roster);
    await client.query(
      "INSERT INTO guild_roster_observation_state (guild_id, acquired_at, source_last_modified_at) VALUES ($1, now(), NULL) ON CONFLICT (guild_id) DO UPDATE SET acquired_at = EXCLUDED.acquired_at, source_last_modified_at = NULL, updated_at = now()",
      [guildId],
    );
    const afterGuildies = await guildieRosterState(client, guildId);
    const guildieTransitions = guildieRosterTransitions(beforeGuildies, afterGuildies);
    const publications = [];
    for (const transition of guildieTransitions) {
      publications.push(await publishEmission(client, {
        code: transition.code,
        subject: transition.identityId,
      }));
    }
    return {
      guildId,
      roster,
      guildieTransitions,
      publications,
    };
  });

  for (const publication of persisted.publications) {
    await deliverEmission(publication);
  }

  await publishGuildRefreshObservation({
    guildId: persisted.guildId,
    changedIdentityIds: persisted.guildieTransitions.map((transition) => transition.identityId),
  });

  const targets = await guildCharactersNeedingEnrichment(persisted.guildId, persisted.roster.changedPresentationCoordinates);
  const enrichment = await enrichGuildCharacters({ guildId: persisted.guildId, targets });

  return {
    guildId: persisted.guildId,
    rosterCount: persisted.roster.observed,
    reconciliation: {
      charactersTargeted: enrichment.attempted,
      profilesUpdated: enrichment.profilesUpdated,
      mediaUpdated: enrichment.mediaUpdated,
      failedProfiles: enrichment.failedProfiles,
      failedMedia: enrichment.failedMedia,
      apiCalls: enrichment.apiCalls,
      failures: enrichment.failures,
    },
  };
}
