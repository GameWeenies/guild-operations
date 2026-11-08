import { identityHasGuildCapabilityOrOperator } from "../../core/authority/guild-permissions.js";
import {
  registerActivity,
  type ActivityOccurrenceAttribute,
} from "../../core/activity/registry.js";
import {
  raidEventFactsIncludingCancelled,
} from "./application.js";
import { raidListingParticipationSummary } from "./listing-view.js";
import { RAID_ASSIGN_CAPABILITY, RAID_CAPABILITY_DEFINITIONS, RAID_MODIFY_CAPABILITY, RAID_STAGE_CAPABILITY } from "./permissions.js";
import type { RaidDifficulty } from "./domain.js";
import { raidsForOperation } from "./operation-view.js";
import { raidSignup, raidSignups } from "./participation-view.js";

function difficultyLabel(value: RaidDifficulty): string {
  return value[0].toUpperCase() + value.slice(1);
}

async function raidOccurrence(raidId: string) {
  const raid = await raidEventFactsIncludingCancelled(raidId);
  if (!raid) return null;

  const participation = await raidListingParticipationSummary(raidId);

  const attributes: ActivityOccurrenceAttribute[] = [
    { kind: "difficulty", label: "Difficulty", provenance: "declared", value: { type: "string", value: difficultyLabel(raid.difficulty) } },
    ...raid.requirements.map((requirement) => ({
      kind: "requirement",
      label: requirement.label,
      provenance: "declared" as const,
      value: { type: "string" as const, value: requirement.value },
    })),
    { kind: "signed_up", label: "Signed up", provenance: "derived", value: { type: "integer", value: participation.signedUp } },
  ];

  return {
    occursAt: raid.cancelledAtUnix === null
      ? { start: raid.occursAt[0], end: raid.occursAt.length === 2 ? raid.occursAt[1] : null }
      : null,
    title: raid.label,
    description: raid.description,
    phase: raid.cancelledAtUnix === null && raid.concludedAtUnix === null ? "active" as const : "record" as const,
    attributes,
    interactions: raid.cancelledAtUnix !== null || raid.concludedAtUnix !== null
      ? []
      : [
          { kind: "participate" as const, label: "Sign up" },
          { kind: "operate" as const, label: "Manage raid" },
        ],
  };
}

async function raidAssignmentWorkspace(raidId: string) {
  const raid = await raidEventFactsIncludingCancelled(raidId);
  if (!raid || raid.cancelledAtUnix !== null) return null;

  const rows = await raidSignups(raidId);
  const assigned = rows.filter((row) => row.assignmentId !== null);
  const available = rows.filter((row) =>
    row.assignmentId === null
    && row.deniedAtUnix === null
    && !rows.some((candidate) =>
      candidate.actorKind === row.actorKind
      && candidate.actorReference === row.actorReference
      && candidate.assignmentId !== null
    )
  );
  const visible = [...available, ...assigned];

  return {
    kind: "raid_assignment",
    objects: visible.map((row) => ({
      id: row.signupRowId,
      value: { type: "participation_offer" as const, value: row.participationOfferId },
      presentation: "raid_participant_card" as const,
      attributes: [
        {
          kind: "offered_specs",
          label: "Willing to play",
          provenance: "declared" as const,
          value: row.offeredSpecs.map((spec) => ({ type: "wow_spec" as const, value: spec })),
        },
      ],
    })),
    positions: [
      { id: "available", label: "Available", presentation: "raid_participant_pool" as const },
      ...(["tank", "healer", "damage"] as const).map((role) => ({
        id: role,
        label: role === "damage" ? "Damage" : role === "healer" ? "Healer" : "Tank",
        value: { type: "wow_role" as const, value: role },
        presentation: "raid_role_lane" as const,
      })),
    ],
    placements: visible.map((row) => ({
      objectId: row.signupRowId,
      positionId: row.selectedRole ?? "available",
      attributes: row.selectedClass && row.selectedSpec
        ? [{
            kind: "selected_spec",
            label: "Assigned spec",
            provenance: "derived" as const,
            value: { type: "wow_spec" as const, value: { className: row.selectedClass, specName: row.selectedSpec } },
          }]
        : [],
    })),
    constraints: [{
      kind: "wow_spec_supports_role" as const,
      objectAttributeKind: "offered_specs",
      positionValueType: "wow_role" as const,
    }],
  };
}

export function registerRaidActivityIntegration(): void {
  registerActivity({
    kind: "raid",
    administration: { capabilities: RAID_CAPABILITY_DEFINITIONS },
    discovery: {
      title: "Raid",
      tagline: "Organized guild raiding and roster participation.",
      destination: "/activities/raid",
    },
    kindInteraction: {
      label() { return "Create Raid"; },
      destination() { return "/activities/raid/manage?create=1"; },
      async availableTo(_kind, guildieId) {
        return guildieId ? identityHasGuildCapabilityOrOperator(guildieId, RAID_MODIFY_CAPABILITY) : false;
      },
    },
    occurrence: {
      resolve: raidOccurrence,
      async list() {
        return (await raidsForOperation())
          .filter((raid) => raid.concludedAtUnix === null)
          .map((raid) => raid.raidId);
      },
    },
    assignment: {
      async project(activityId) {
        return (await raidSignups(activityId))
          .filter((signup) => signup.assignmentId !== null && signup.selectedRole !== null)
          .map((signup) => ({
            participationOfferId: signup.participationOfferId,
            attributes: [
              { kind: "assigned_role", label: "Assigned role", provenance: "derived" as const, value: { type: "wow_role" as const, value: signup.selectedRole! } },
              ...(signup.selectedClass && signup.selectedSpec ? [{
                kind: "assigned_spec",
                label: "Assigned spec",
                provenance: "derived" as const,
                value: { type: "wow_spec" as const, value: { className: signup.selectedClass, specName: signup.selectedSpec } },
              }] : []),
            ],
          }));
      },
    },
    workspace: {
      project: raidAssignmentWorkspace,
    },
    participation: {
      async project(activityId, procedureReference) {
        const signup = await raidSignup(activityId, procedureReference);
        if (!signup) return null;
        return {
          title: signup.displayName,
          attributes: [
            { kind: "offered_specs", label: "Willing to play", provenance: "declared", value: signup.offeredSpecs.map((spec) => ({ type: "wow_spec" as const, value: spec })) },
            ...(signup.assignmentId === null ? [] : [
              ...(signup.selectedSpec && signup.selectedClass ? [{ kind: "assigned_spec", label: "Assigned spec", provenance: "derived" as const, value: { type: "wow_spec" as const, value: { className: signup.selectedClass!, specName: signup.selectedSpec } } }] : []),
              ...(signup.selectedRole ? [{ kind: "assigned_role", label: "Assigned role", provenance: "derived" as const, value: { type: "wow_role" as const, value: signup.selectedRole } }] : []),
            ]),
          ],
        };
      },
    },
    interaction: {
      async availableTo(kind, _activityId, guildieId) {
        if (kind !== "operate") return true;
        if (!guildieId) return false;
        const permitted = await Promise.all([
          RAID_MODIFY_CAPABILITY,
          RAID_STAGE_CAPABILITY,
          RAID_ASSIGN_CAPABILITY,
        ].map((capability) => identityHasGuildCapabilityOrOperator(guildieId, capability)));
        return permitted.some(Boolean);
      },
      destination(kind, activityId) {
        const id = encodeURIComponent(activityId);
        if (kind === "participate") return `/activities/raid/${id}/participation`;
        if (kind === "operate") return `/activities/raid/${id}/manage`;
        return null;
      },
    },
  });
}
