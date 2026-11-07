import { controlledCharacterRecordIdsForIdentity } from "../../core/identity/controlled-characters.js";
import { controlledGuildMemberCharacters } from "../../core/guild/guild-characters.js";
import { characterProjections } from "../../core/identity/character-projection.js";
import { identityRepresentations } from "../../core/identity/guildie-attribution.js";
import { activityParticipationOffersForActivity } from "../../core/activity/participation.js";
import { pool } from "../../db.js";
import { specHasTrait, specsForClass } from "../../wow-traits/registry.js";
import { raidEventFacts, type RaidEventFacts } from "./application.js";
import type { RaidOfferedSpec, RaidRole } from "./domain.js";

export type RaidParticipationCharacter = {
  region: string;
  realmId: string;
  characterId: string;
  name: string;
  realmName: string | null;
  className: string;
  specs: readonly string[];
  roles: readonly RaidRole[];
};

export type RaidSignupView = {
  signupRowId: string;
  participationOfferId: string;
  actorKind: "native" | "external";
  actorReference: string;
  displayName: string;
  offeredSpecs: RaidOfferedSpec[];
  willingRoles: RaidRole[];
  assignmentId: string | null;
  selectedClass: string | null;
  selectedSpec: string | null;
  selectedRole: RaidRole | null;
  deniedAtUnix: number | null;
  deniedByGuildieId: string | null;
  withdrawnAtUnix: number | null;
};

function rolesForSpecs(specs: readonly RaidOfferedSpec[]): RaidRole[] {
  const roles: RaidRole[] = [];
  if (specs.some((spec) => specHasTrait(spec.className, spec.specName, "role.tank"))) roles.push("tank");
  if (specs.some((spec) => specHasTrait(spec.className, spec.specName, "role.healer"))) roles.push("healer");
  if (specs.some((spec) => specHasTrait(spec.className, spec.specName, "role.damage"))) roles.push("damage");
  return roles;
}

export async function raidParticipationCharacters(
  raidId: string,
  guildieId: string,
): Promise<{ raid: RaidEventFacts; characters: RaidParticipationCharacter[] }> {
  const raid = await raidEventFacts(raidId);
  if (!raid) throw new Error("Raid not found");

  const controlled = await characterProjections(await controlledCharacterRecordIdsForIdentity(guildieId));
  const eligible = controlled.filter((character) => character.className !== null);

  return {
    raid,
    characters: eligible.map((character) => {
      const className = character.className!;
      const specs = specsForClass(className);
      return {
        region: character.region,
        realmId: character.realmId,
        characterId: character.characterId,
        name: character.name,
        realmName: character.realmName,
        className,
        specs,
        roles: rolesForSpecs(specs.map((specName) => ({ className, specName }))),
      };
    }),
  };
}

async function raidSignupRows(raidId: string, includeWithdrawn: boolean): Promise<RaidSignupView[]> {
  const result = await pool.query<{
    signup_row_id: string;
    assignment_id: string | null;
    selected_class: string | null;
    selected_spec: string | null;
    selected_role: RaidRole | null;
    denied_at_unix: string | number | null;
    denied_by_identity_id: string | null;
    withdrawn_at_unix: string | number | null;
  }>(
    `SELECT
       rr.signup_row_id,
       ras.assignment_id,
       ras.selected_class,
       ras.selected_spec,
       ras.selected_role,
       rsd.denied_at_unix,
       rsd.denied_by_identity_id,
       rr.withdrawn_at_unix
     FROM raid_signup_rows rr
     LEFT JOIN raid_assignments ras ON ras.signup_row_id = rr.signup_row_id
     LEFT JOIN raid_signup_denials rsd ON rsd.raid_id = rr.raid_id AND rsd.signup_row_id = rr.signup_row_id
     WHERE rr.raid_id = $1
       AND ($2::boolean OR rr.withdrawn_at_unix IS NULL)
     ORDER BY rr.created_at_unix ASC, rr.signup_row_id ASC`,
    [raidId, includeWithdrawn],
  );

  const client = await pool.connect();
  let offers;
  try {
    offers = await activityParticipationOffersForActivity(client, {
      activityKind: "raid",
      activityId: raidId,
      procedureReferences: result.rows.map((row) => row.signup_row_id),
    });
  } finally {
    client.release();
  }
  const offerByReference = new Map(offers.map((offer) => [offer.procedureReference, offer]));
  const guildieIds = offers.flatMap((offer) => offer.actor.kind === "native" ? [offer.actor.reference] : []);
  const attributions = await identityRepresentations(guildieIds);
  const externalIds = [...new Set(offers.flatMap((offer) => offer.actor.kind === "external" ? [offer.actor.reference] : []))];
  const externalNames = new Map<string, string>();
  if (externalIds.length) {
    const discord = await pool.query<{ identity_id: string; username: string | null; discord_user_id: string }>(
      "SELECT identity_id, username, discord_user_id FROM discord_identities WHERE identity_id = ANY($1::uuid[])",
      [externalIds],
    );
    for (const identity of discord.rows) {
      externalNames.set(identity.identity_id, identity.username || `Discord user ${identity.discord_user_id}`);
    }
  }

  return result.rows.map((row) => {
    const offer = offerByReference.get(row.signup_row_id);
    if (!offer) throw new Error("Raid signup Participation Offer not found");
    const component = offer.context.find((value) => value.name === "offered_specs");
    if (!Array.isArray(component?.value) || !component.value.length || component.value.some((value) => value.type !== "wow_spec")) {
      throw new Error("Raid signup Participation Offer does not contain valid specialization choices");
    }
    const offeredSpecs = component.value.flatMap((value) =>
      value.type === "wow_spec" ? [{ className: value.value.className, specName: value.value.specName }] : []
    );
    const attribution = offer.actor.kind === "native" ? attributions.get(offer.actor.reference) : null;
    return {
      signupRowId: row.signup_row_id,
      participationOfferId: offer.participationOfferId,
      actorKind: offer.actor.kind,
      actorReference: offer.actor.reference,
      displayName: attribution?.displayName ?? (offer.actor.kind === "external" ? (externalNames.get(offer.actor.reference) ?? "Discord participant") : `Identity ${offer.actor.reference.slice(0, 8)}`),
      offeredSpecs,
      willingRoles: rolesForSpecs(offeredSpecs),
      assignmentId: row.assignment_id,
      selectedClass: row.selected_class,
      selectedSpec: row.selected_spec,
      selectedRole: row.selected_role,
      deniedAtUnix: row.denied_at_unix === null ? null : Number(row.denied_at_unix),
      deniedByGuildieId: row.denied_by_identity_id,
      withdrawnAtUnix: row.withdrawn_at_unix === null ? null : Number(row.withdrawn_at_unix),
    };
  });
}

export async function raidSignups(raidId: string): Promise<RaidSignupView[]> {
  return raidSignupRows(raidId, false);
}

export async function raidSignup(raidId: string, signupRowId: string): Promise<RaidSignupView | null> {
  return (await raidSignupRows(raidId, true)).find((row) => row.signupRowId === signupRowId) ?? null;
}

export async function raidAssignment(raidId: string, signupRowId: string): Promise<Pick<RaidSignupView, "assignmentId" | "selectedClass" | "selectedSpec" | "selectedRole"> | null> {
  const signup = await raidSignup(raidId, signupRowId);
  if (!signup?.assignmentId) return null;
  return {
    assignmentId: signup.assignmentId,
    selectedClass: signup.selectedClass,
    selectedSpec: signup.selectedSpec,
    selectedRole: signup.selectedRole,
  };
}

export async function raidSignupsForGuildie(raidId: string, guildieId: string): Promise<RaidSignupView[]> {
  return (await raidSignups(raidId)).filter(
    (row) => row.actorKind === "native" && row.actorReference === guildieId,
  );
}

export async function activeRaidSignups(raidId: string): Promise<RaidSignupView[]> {
  return (await raidSignupRows(raidId, false)).filter((row) => row.deniedAtUnix === null);
}
