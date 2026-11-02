import { pool } from "../db.js";
import { installationGuildBinding } from "../core/installation/guild-binding.js";
import { guildRankDefinitions } from "../core/guild/guild-ranks.js";
import { controlledGuildMemberCharacters } from "../core/guild/guild-characters.js";
import { controlledCharacterRecordIdsForIdentity } from "../core/identity/controlled-characters.js";
import { characterRepresentationForIdentity } from "../core/identity/main-character.js";
import { identityPresentation } from "../core/identity/identity-presentation.js";
import { characterProjections } from "../core/identity/character-projection.js";
import { authenticatedIdentity } from "../auth.js";
import { guildTheme } from "../core/presentation/guild-theme.js";
import { guildPresentation } from "../core/presentation/guild-presentation.js";
import {
  GUILD_REFRESH_CAPABILITY,
  GUILD_PRESENTATION_CONFIGURE_CAPABILITY,
  OPERATIONS_INSPECT_CAPABILITY,
  effectiveGuildAuthority,
  identityHasGuildCapability,
} from "../core/authority/guild-permissions.js";
import { administrationAvailabilityForIdentity } from "./administration.js";
import { webPresentationContributionsForIdentity } from "./presentation-contributions.js";
import type { WebViewer } from "./render.js";
import { specializationProfileIconUrl } from "../wow-iconography.js";

export async function viewerForRequest(sessionToken: string | undefined): Promise<WebViewer> {
  const [identity, theme, presentation] = await Promise.all([authenticatedIdentity(sessionToken), guildTheme(), guildPresentation()]);

  if (!identity) {
    return {
      authenticated: false,
      theme,
      guildPresentation: presentation,
      presentationContributions: await webPresentationContributionsForIdentity(null),
    };
  }

  const [controlledCharacterRecordIds, guildMemberCharacters, selectedMain, identityDisplay, guildAuthority, administration, canRefreshGuild, canConfigureGuildPresentation, canInspectOperations, presentationContributions] = await Promise.all([
    controlledCharacterRecordIdsForIdentity(identity.identityId),
    controlledGuildMemberCharacters(identity.identityId),
    characterRepresentationForIdentity(identity.identityId),
    identityPresentation(identity.identityId),
    effectiveGuildAuthority(identity.identityId),
    administrationAvailabilityForIdentity(identity.identityId),
    identityHasGuildCapability(identity.identityId, GUILD_REFRESH_CAPABILITY),
    identityHasGuildCapability(identity.identityId, GUILD_PRESENTATION_CONFIGURE_CAPABILITY),
    identityHasGuildCapability(identity.identityId, OPERATIONS_INSPECT_CAPABILITY),
    webPresentationContributionsForIdentity(identity.identityId),
  ]);

  const binding = !administration.available && !canRefreshGuild && !canInspectOperations ? await installationGuildBinding() : null;
  const bootstrap = binding?.authorizationKind === "guild_master" && binding.authorizedByIdentityId === identity.identityId
    ? (await pool.query<{ pending: boolean }>("SELECT (mode = 'manual' AND manual_initialized_at IS NULL) AS pending FROM guild_roster_management WHERE guild_id = $1", [binding.guildId])).rows[0]?.pending === true
    : false;

  const [controlledCharacters, characters, identityProfileIconUrl, rankDefinitions] = await Promise.all([
    characterProjections(controlledCharacterRecordIds),
    characterProjections(guildMemberCharacters.map((character) => character.characterRecordId)),
    identityDisplay.profileIconKey ? specializationProfileIconUrl(identityDisplay.profileIconKey) : Promise.resolve(null),
    guildRankDefinitions(),
  ]);
  const rankNames = new Map(rankDefinitions.map((rank) => [rank.rankIndex, rank.displayName]));
  const guildMembershipByCharacterRecordId = new Map(guildMemberCharacters.map((character) => [character.characterRecordId, character]));

  return {
    authenticated: true,
    theme,
    guildPresentation: presentation,
    presentationContributions,
    administrationAvailable: administration.available || canRefreshGuild || canInspectOperations || bootstrap,
    administrationDestinations: administration.available || canRefreshGuild || canInspectOperations || bootstrap
      ? [
          { label: "Guild Operations Settings", href: "/admin" },
          ...(administration.canConfigureDiscord ? [{ label: "Discord", href: "/admin/discord" }] : []),
        ]
      : [],
    operationsAvailable: false,
    canConfigureGuildPresentation,
    identityLabel: identityDisplay.label,
    identityDisplayName: identityDisplay.displayName,
    identityProfileIconKey: identityDisplay.profileIconKey,
    identityProfileIconUrl,
    guildRankDisplayName: guildAuthority?.rankDisplayName ?? null,
    guildRankIndex: guildAuthority?.rankIndex ?? null,
    mainCharacter: selectedMain
      ? {
          characterId: selectedMain.characterId,
          realmId: selectedMain.realmId,
          name: selectedMain.name,
          realmName: selectedMain.realmName,
          rankIndex: selectedMain.rankIndex,
          rankDisplayName: selectedMain.rankIndex === null ? null : rankNames.get(selectedMain.rankIndex) ?? `Rank ${selectedMain.rankIndex}`,
          level: characters.find((character) => character.realmId === selectedMain.realmId && character.characterId === selectedMain.characterId)?.level ?? null,
          className: characters.find((character) => character.realmId === selectedMain.realmId && character.characterId === selectedMain.characterId)?.className ?? null,
          activeSpecName: characters.find((character) => character.realmId === selectedMain.realmId && character.characterId === selectedMain.characterId)?.activeSpecName ?? null,
          avatarUrl: selectedMain.avatarUrl,
        }
      : null,
    controlledCharacters: controlledCharacters.map((character) => ({
      characterId: character.characterId,
      realmId: character.realmId,
      name: character.name,
      realmName: character.realmName,
      guildMember: guildMembershipByCharacterRecordId.has(character.characterRecordId),
      rankIndex: guildMembershipByCharacterRecordId.get(character.characterRecordId)?.rankIndex ?? null,
      rankDisplayName: rankNames.get(guildMembershipByCharacterRecordId.get(character.characterRecordId)?.rankIndex ?? -1) ?? null,
      level: character.level,
      className: character.className,
      raceName: character.raceName,
      activeSpecName: character.activeSpecName,
      avatarUrl: character.avatarUrl,
    })),
    characters: characters.map((character) => ({
      characterId: character.characterId,
      realmId: character.realmId,
      name: character.name,
      realmName: character.realmName,
      guildMember: true,
      rankIndex: guildMembershipByCharacterRecordId.get(character.characterRecordId)!.rankIndex,
      rankDisplayName: rankNames.get(guildMembershipByCharacterRecordId.get(character.characterRecordId)!.rankIndex) ?? null,
      level: character.level,
      className: character.className,
      raceName: character.raceName,
      activeSpecName: character.activeSpecName,
      avatarUrl: character.avatarUrl,
    })),
  };
}
