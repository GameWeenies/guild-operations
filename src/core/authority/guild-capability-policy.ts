import type { PoolClient } from "pg";
import { requireOperationalInstallationGuildBinding } from "../installation/guild-binding.js";
import { pool, withTransaction } from "../../db.js";
import {
  GUILD_REFRESH_CAPABILITY,
  GUILD_REFRESH_SCHEDULE_CONFIGURE_CAPABILITY,
  GUILD_PRESENTATION_CONFIGURE_CAPABILITY,
  ARTICLE_PUBLISH_CAPABILITY,
  ARTICLE_REMOVE_CAPABILITY,
  MODULES_CONFIGURE_CAPABILITY,
  DISCORD_CONFIGURE_CAPABILITY,
  OPERATIONS_INSPECT_CAPABILITY,
  THEME_CONFIGURE_CAPABILITY,
  type GuildCapability,
  effectiveGuildAuthority,
  identityHasGuildCapability,
} from "./guild-permissions.js";
import { registerGuildRefreshObserver } from "../guild/guild-refresh-observers.js";
import { hasDevelopmentGuildMasterAuthority } from "./operator-authority.js";

export type GuildCapabilityDefinition = {
  key: GuildCapability;
  namespace: string;
  namespaceLabel: string;
  label: string;
  description?: string;
  defaultPermittedRanks?: readonly number[];
};
export type GuildRankOption = { rankIndex: number; displayName: string; active: boolean };
export type GuildCapabilityPolicy = Omit<GuildCapabilityDefinition, "defaultPermittedRanks"> & { permittedRanks: number[] };
export type GuildCapabilityPolicySet = { ranks: GuildRankOption[]; capabilities: GuildCapabilityPolicy[] };

const definitions = new Map<GuildCapability, GuildCapabilityDefinition>();
let observerRegistered = false;

export function registerGuildCapabilityDefinitions(contributed: readonly GuildCapabilityDefinition[]): void {
  for (const definition of contributed) {
    const existing = definitions.get(definition.key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(definition)) throw new Error(`Guild capability definition already registered: ${definition.key}`);
    definitions.set(definition.key, { ...definition, defaultPermittedRanks: definition.defaultPermittedRanks?.filter((rankIndex) => rankIndex !== 0) });
  }
}

export function registerGlobalGuildCapabilityDefinitions(): void {
  registerGuildCapabilityDefinitions([
    { key: GUILD_REFRESH_CAPABILITY, namespace: "global", namespaceLabel: "Global", label: "Refresh guild", description: "Perform an immediate reconciliation of current guild membership and rank authority from Blizzard.", defaultPermittedRanks: [1, 2] },
    { key: GUILD_REFRESH_SCHEDULE_CONFIGURE_CAPABILITY, namespace: "global", namespaceLabel: "Global", label: "Configure guild refresh schedule", description: "Configure automatic guild synchronization policy.", defaultPermittedRanks: [1, 2] },
    { key: MODULES_CONFIGURE_CAPABILITY, namespace: "global", namespaceLabel: "Global", label: "Configure add-ons", description: "Enable or disable optional Guild Operations capabilities.", defaultPermittedRanks: [] },
    { key: DISCORD_CONFIGURE_CAPABILITY, namespace: "global", namespaceLabel: "Global", label: "Configure Discord", description: "Configure and operate the guild Discord Integration.", defaultPermittedRanks: [] },
    { key: THEME_CONFIGURE_CAPABILITY, namespace: "global", namespaceLabel: "Global", label: "Configure theme", description: "Select the visual theme used by Guild Operations for this guild.", defaultPermittedRanks: [] },
    { key: GUILD_PRESENTATION_CONFIGURE_CAPABILITY, namespace: "global", namespaceLabel: "Global", label: "Configure guild presentation", description: "Configure the guild homepage and optional presentation destinations.", defaultPermittedRanks: [] },
    { key: OPERATIONS_INSPECT_CAPABILITY, namespace: "global", namespaceLabel: "Global", label: "Inspect operations", description: "Inspect operational history and recorded failures.", defaultPermittedRanks: [1, 2] },
    { key: ARTICLE_PUBLISH_CAPABILITY, namespace: "articles", namespaceLabel: "Articles", label: "Publish Articles", description: "Create, edit, publish, and remove your own guild Articles.", defaultPermittedRanks: [] },
    { key: ARTICLE_REMOVE_CAPABILITY, namespace: "articles", namespaceLabel: "Articles", label: "Remove Articles", description: "Remove guild Articles authored by another member.", defaultPermittedRanks: [] },
  ]);
}

export function registerGuildCapabilityPolicyObserver(): void {
  if (observerRegistered) return;
  observerRegistered = true;
  registerGuildRefreshObserver(async ({ guildId }) => { await ensureGuildCapabilityPolicies(guildId); });
}
export function registeredGuildCapabilityDefinitions(): GuildCapabilityDefinition[] { return [...definitions.values()]; }

async function hasGlobalPermissionAdministration(identityId: string, guildId: string): Promise<boolean> {
  if (hasDevelopmentGuildMasterAuthority(identityId)) return true;
  const authority = await effectiveGuildAuthority(identityId, guildId);
  return authority?.rankIndex === 0;
}

async function canAdministerCapabilityDefinition(identityId: string, definition: GuildCapabilityDefinition, guildId: string): Promise<boolean> {
  if (await hasGlobalPermissionAdministration(identityId, guildId)) return true;
  if (definition.namespace === "global") return false;
  return identityHasGuildCapability(identityId, `${definition.namespace}.permissions`, guildId);
}

export async function canAdministerGuildCapability(identityId: string, capability: GuildCapability, guildId?: string): Promise<boolean> {
  const resolvedGuildId = guildId ?? (await requireOperationalInstallationGuildBinding()).guildId;
  const definition = definitions.get(capability);
  return definition ? canAdministerCapabilityDefinition(identityId, definition, resolvedGuildId) : false;
}

/** Roster membership and rank assignment are global guild authority operations.
 * Namespace-specific permission administrators must not gain membership control.
 */
export async function canManageGuildRoster(identityId: string, guildId?: string): Promise<boolean> {
  const resolvedGuildId = guildId ?? (await requireOperationalInstallationGuildBinding()).guildId;
  return hasGlobalPermissionAdministration(identityId, resolvedGuildId);
}

export async function canAdministerGuildPermissions(identityId: string, guildId?: string): Promise<boolean> {
  const resolvedGuildId = guildId ?? (await requireOperationalInstallationGuildBinding()).guildId;
  if (await hasGlobalPermissionAdministration(identityId, resolvedGuildId)) return true;
  const namespaces = [...new Set(registeredGuildCapabilityDefinitions().map((definition) => definition.namespace).filter((namespace) => namespace !== "global"))];
  const checks = await Promise.all(namespaces.map((namespace) => identityHasGuildCapability(identityId, `${namespace}.permissions`, resolvedGuildId)));
  return checks.some(Boolean);
}
export async function requireGuildPermissionAdministration(identityId: string, guildId?: string): Promise<void> {
  if (!await canAdministerGuildPermissions(identityId, guildId)) throw new Error("Identity cannot administer guild permissions");
}

function configurableRanks(permittedRanks: readonly number[]): number[] {
  return [...new Set(permittedRanks.filter((rankIndex) => rankIndex !== 0))].sort((a, b) => a - b);
}

async function replaceCapabilityProjection(client: PoolClient, guildId: string, capability: string, permittedRanks: readonly number[]): Promise<void> {
  await client.query(`DELETE FROM guild_rank_capabilities WHERE guild_id = $1 AND capability = $2`, [guildId, capability]);
  for (const rankIndex of configurableRanks(permittedRanks)) await client.query(`INSERT INTO guild_rank_capabilities (guild_id, rank_index, capability) VALUES ($1, $2, $3) ON CONFLICT (guild_id, rank_index, capability) DO NOTHING`, [guildId, rankIndex, capability]);
}

export async function ensureGuildCapabilityPolicies(guildId?: string): Promise<void> {
  const resolvedGuildId = guildId ?? (await requireOperationalInstallationGuildBinding()).guildId;
  const capabilityDefinitions = registeredGuildCapabilityDefinitions();
  if (capabilityDefinitions.length === 0) return;
  await withTransaction(async (client) => {
    const ranksResult = await client.query<{ rank_index: number }>(`SELECT rank_index FROM guild_rank_definitions WHERE guild_id = $1`, [resolvedGuildId]);
    const knownRanks = new Set(ranksResult.rows.map((row) => row.rank_index));
    for (const definition of capabilityDefinitions) {
      const configured = await client.query<{ permitted_ranks: number[] }>(`SELECT permitted_ranks FROM guild_capability_policy_configuration WHERE guild_id = $1 AND capability = $2`, [resolvedGuildId, definition.key]);
      let permittedRanks = configured.rows[0]?.permitted_ranks;
      if (!permittedRanks) {
        const existing = await client.query<{ rank_index: number }>(`SELECT rank_index FROM guild_rank_capabilities WHERE guild_id = $1 AND capability = $2 ORDER BY rank_index`, [resolvedGuildId, definition.key]);
        permittedRanks = existing.rows.length > 0 ? existing.rows.map((row) => row.rank_index) : [...(definition.defaultPermittedRanks ?? [])].filter((rankIndex) => knownRanks.has(rankIndex));
      }
      permittedRanks = configurableRanks(permittedRanks).filter((rankIndex) => knownRanks.has(rankIndex));
      await client.query(`INSERT INTO guild_capability_policy_configuration (guild_id, capability, permitted_ranks, updated_at) VALUES ($1, $2, $3::integer[], now()) ON CONFLICT (guild_id, capability) DO UPDATE SET permitted_ranks = EXCLUDED.permitted_ranks, updated_at = CASE WHEN guild_capability_policy_configuration.permitted_ranks IS DISTINCT FROM EXCLUDED.permitted_ranks THEN now() ELSE guild_capability_policy_configuration.updated_at END`, [resolvedGuildId, definition.key, permittedRanks]);
      await replaceCapabilityProjection(client, resolvedGuildId, definition.key, permittedRanks);
    }
  });
}

export async function guildCapabilityPolicies(guildId?: string): Promise<GuildCapabilityPolicySet> {
  const resolvedGuildId = guildId ?? (await requireOperationalInstallationGuildBinding()).guildId;
  await ensureGuildCapabilityPolicies(resolvedGuildId);
  const capabilityDefinitions = registeredGuildCapabilityDefinitions();
  const [ranksResult, policiesResult] = await Promise.all([
    pool.query<{ rank_index: number; display_name: string | null; active: boolean }>(`SELECT rank_index, display_name, active FROM guild_rank_definitions WHERE guild_id = $1 ORDER BY rank_index`, [resolvedGuildId]),
    pool.query<{ capability: string; permitted_ranks: number[] }>(`SELECT capability, permitted_ranks FROM guild_capability_policy_configuration WHERE guild_id = $1 AND capability = ANY($2::text[])`, [resolvedGuildId, capabilityDefinitions.map((definition) => definition.key)]),
  ]);
  const configured = new Map(policiesResult.rows.map((row) => [row.capability, configurableRanks(row.permitted_ranks)]));
  return {
    ranks: ranksResult.rows.map((rank) => ({ rankIndex: rank.rank_index, displayName: rank.display_name ?? `Rank ${rank.rank_index}`, active: rank.active })),
    capabilities: capabilityDefinitions.map(({ defaultPermittedRanks: _defaults, ...definition }) => ({ ...definition, permittedRanks: configured.get(definition.key) ?? [] })),
  };
}

export async function guildCapabilityPoliciesForDefinitions(definitionsInput: readonly GuildCapabilityDefinition[], guildId?: string): Promise<GuildCapabilityPolicySet> {
  const resolvedGuildId = guildId ?? (await requireOperationalInstallationGuildBinding()).guildId;
  await ensureGuildCapabilityPolicies(resolvedGuildId);
  const keys = definitionsInput.map((definition) => definition.key);
  const [ranksResult, policiesResult] = await Promise.all([
    pool.query<{ rank_index:number; display_name:string|null; active:boolean }>(`SELECT rank_index, display_name, active FROM guild_rank_definitions WHERE guild_id=$1 ORDER BY rank_index`, [resolvedGuildId]),
    keys.length ? pool.query<{ capability:string; permitted_ranks:number[] }>(`SELECT capability, permitted_ranks FROM guild_capability_policy_configuration WHERE guild_id=$1 AND capability=ANY($2::text[])`, [resolvedGuildId, keys]) : Promise.resolve({ rows: [] }),
  ]);
  const configured = new Map(policiesResult.rows.map((row) => [row.capability, configurableRanks(row.permitted_ranks)]));
  return { ranks: ranksResult.rows.map((rank) => ({ rankIndex:rank.rank_index, displayName:rank.display_name ?? `Rank ${rank.rank_index}`, active:rank.active })), capabilities: definitionsInput.map(({defaultPermittedRanks:_defaults,...definition}) => ({...definition, permittedRanks:configured.get(definition.key) ?? []})) };
}

export async function guildCapabilityPoliciesForActor(identityId: string, guildId?: string): Promise<GuildCapabilityPolicySet> {
  const resolvedGuildId = guildId ?? (await requireOperationalInstallationGuildBinding()).guildId;
  const policies = await guildCapabilityPolicies(resolvedGuildId);
  if (await hasGlobalPermissionAdministration(identityId, resolvedGuildId)) return policies;
  const allowedNamespaces = new Set<string>();
  for (const capability of policies.capabilities) {
    if (capability.namespace === "global" || allowedNamespaces.has(capability.namespace)) continue;
    if (await identityHasGuildCapability(identityId, `${capability.namespace}.permissions`, resolvedGuildId)) allowedNamespaces.add(capability.namespace);
  }
  return { ranks: policies.ranks, capabilities: policies.capabilities.filter((capability) => allowedNamespaces.has(capability.namespace)) };
}

export async function permittedGuildRanksForCapability(capability: GuildCapability, guildId?: string): Promise<number[]> {
  const resolvedGuildId = guildId ?? (await requireOperationalInstallationGuildBinding()).guildId;
  await ensureGuildCapabilityPolicies(resolvedGuildId);
  const result = await pool.query<{ permitted_ranks: number[] }>(`SELECT permitted_ranks FROM guild_capability_policy_configuration WHERE guild_id = $1 AND capability = $2`, [resolvedGuildId, capability]);
  return configurableRanks(result.rows[0]?.permitted_ranks ?? []);
}

export async function setGuildCapabilityPermittedRanks(actorIdentityId: string, capability: GuildCapability, permittedRanks: readonly number[], guildId?: string): Promise<number[]> {
  const resolvedGuildId = guildId ?? (await requireOperationalInstallationGuildBinding()).guildId;
  const definition = definitions.get(capability);
  if (!definition) throw new Error("Unknown configurable guild capability");
  if (!await canAdministerCapabilityDefinition(actorIdentityId, definition, resolvedGuildId)) throw new Error("Identity cannot administer guild permissions");
  if (permittedRanks.some((rankIndex) => !Number.isInteger(rankIndex) || rankIndex < 0)) throw new Error("Guild permission rank is invalid");
  const normalized = configurableRanks(permittedRanks);
  await withTransaction(async (client) => {
    const rankResult = await client.query<{ rank_index: number }>(`SELECT rank_index FROM guild_rank_definitions WHERE guild_id = $1`, [resolvedGuildId]);
    const knownRanks = new Set(rankResult.rows.map((row) => row.rank_index));
    if (normalized.some((rankIndex) => !knownRanks.has(rankIndex))) throw new Error("Guild permission update referenced an unknown guild rank");
    await client.query(`INSERT INTO guild_capability_policy_configuration (guild_id, capability, permitted_ranks, updated_at) VALUES ($1, $2, $3::integer[], now()) ON CONFLICT (guild_id, capability) DO UPDATE SET permitted_ranks = EXCLUDED.permitted_ranks, updated_at = now()`, [resolvedGuildId, capability, normalized]);
    await replaceCapabilityProjection(client, resolvedGuildId, capability, normalized);
  });
  return normalized;
}
