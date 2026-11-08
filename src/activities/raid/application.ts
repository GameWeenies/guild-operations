import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requireOperationalInstallationGuildBinding } from "../../core/installation/guild-binding.js";
import { activityParticipationOfferByProcedureReference, closeActivityParticipationOffer, closeOutstandingActivityParticipationOffers, constructActivityParticipationOffer, establishActivityParticipation, outstandingActivityParticipationOffersForActor, participationOfferWorkspace, reviseActivityParticipationOffer, revokeActivityParticipationOffer, type ActivityParticipationActor, type ActivityParticipationOffer, type ActivityParticipationOfferContract, type ParticipationOfferWorkspace } from "../../core/activity/participation.js";
import { pool, withTransaction } from "../../db.js";
import { deliverEmission, publishEmission } from "../../emissions/registry.js";
import { publishActivityDeclaration } from "../../core/activity/declarations.js";
import { effectiveGuildAuthority, requireGuildCapabilityOrOperator } from "../../core/authority/guild-permissions.js";
import { RAID_ASSIGN_CAPABILITY, RAID_MODIFY_CAPABILITY, RAID_STAGE_CAPABILITY } from "./permissions.js";

import { positionForSpec, traitsForSpec, type WowTrait } from "../../wow-traits/registry.js";
import {
  normalizedRaidRequirements,
  normalizedStrings,
  rolesForParticipationSpecs,
  validateEstablishRaidInput,
  validateModifyRaidInput,
  validateSelectedConfiguration,
  type EstablishRaidAssignmentInput,
  type ModifyRaidAssignmentInput,
  type DenyRaidSignupInput,
  type EstablishRaidInput,
  type ModifyRaidInput,
  type RaidApplicantAnchor,
  type RaidDifficulty,
  type RaidRequirement,
  type RaidRole,
  type RaidOfferedSpec,
  type EstablishRaidSignupInput,
  type RevokeRaidSignupInput,
} from "./domain.js";

export type RaidEventFacts = {
  raidId: string;
  guildId: string;
  label: string;
  description: string | null;
  occursAt: readonly [number] | readonly [number, number];
  tags: string[];
  difficulty: RaidDifficulty;
  requirements: RaidRequirement[];
  cancelledAtUnix: number | null;
  cancelledByGuildieId: string | null;
  concludedAtUnix: number | null;
  concludedByGuildieId: string | null;
};
export type RaidRosterDiagnostics = { assigned:number; tanks:number; healers:number; damage:number; melee:number; ranged:number };

type RaidAction = "created" | "modified" | "assignment_established" | "assignment_modified" | "assignment_withdrawn" | "signup_denied";

function requireActiveRaid(raid:RaidEventFacts):void { if(raid.concludedAtUnix!==null)throw new Error("Raid is already concluded"); }

function raidPublicDestination(raidId:string):string { return `/activities/raid/${encodeURIComponent(raidId)}`; }
function raidParticipationDestination(raidId:string):string { return `/activities/raid/${encodeURIComponent(raidId)}/participation`; }
function raidManageDestination(raidId:string):string { return `/activities/raid/${encodeURIComponent(raidId)}/manage`; }
export type RaidDestination = { kind: string; label: string; href: string };
export function raidOccurrenceDestinations(raidId:string):readonly RaidDestination[] {
  return [
    { kind:"public", label:"View raid", href:raidPublicDestination(raidId) },
    { kind:"participate", label:"Signups", href:raidParticipationDestination(raidId) },
    { kind:"operate", label:"Manage raid", href:raidManageDestination(raidId) },
  ];
}
async function recordRaidAction(client:PoolClient,raidId:string,action:RaidAction,actorGuildieId:string):Promise<void>{
  await client.query("INSERT INTO raid_action_history (raid_id,action,actor_identity_id) VALUES ($1,$2,$3)",[raidId,action,actorGuildieId]);
}
async function replaceRaidRequirements(client:PoolClient,raidId:string,requirements:readonly RaidRequirement[]):Promise<void>{
  await client.query("DELETE FROM raid_requirements WHERE raid_id=$1",[raidId]);
  for(const [position,requirement] of normalizedRaidRequirements(requirements).entries()){
    await client.query("INSERT INTO raid_requirements (raid_id,position,label,value) VALUES ($1,$2,$3,$4)",[raidId,position,requirement.label,requirement.value]);
  }
}
async function loadRaidEventFacts(raidId:string, client:PoolClient|null, includeCancelled:boolean):Promise<RaidEventFacts|null>{
  const db=client??pool;
  const r=await db.query<any>(`SELECT raid_id,guild_id,label,description,occurs_start_unix,occurs_end_unix,tags,difficulty,cancelled_at_unix,cancelled_by_identity_id,concluded_at_unix,concluded_by_identity_id FROM raid_events WHERE raid_id=$1 AND ($2::boolean OR cancelled_at_unix IS NULL)`,[raidId,includeCancelled]);
  const x=r.rows[0]; if(!x)return null;
  const requirements=await db.query<{label:string;value:string}>("SELECT label,value FROM raid_requirements WHERE raid_id=$1 ORDER BY position",[raidId]);
  const s=Number(x.occurs_start_unix),e=x.occurs_end_unix===null?null:Number(x.occurs_end_unix);
  return {raidId:x.raid_id,guildId:x.guild_id,label:x.label,description:x.description,occursAt:e===null?[s]:[s,e],tags:x.tags,difficulty:x.difficulty,requirements:requirements.rows,cancelledAtUnix:x.cancelled_at_unix===null?null:Number(x.cancelled_at_unix),cancelledByGuildieId:x.cancelled_by_identity_id,concludedAtUnix:x.concluded_at_unix===null?null:Number(x.concluded_at_unix),concludedByGuildieId:x.concluded_by_identity_id};
}
export async function raidEventFacts(raidId:string, client:PoolClient|null=null):Promise<RaidEventFacts|null>{return loadRaidEventFacts(raidId,client,false);}
export async function raidEventFactsIncludingCancelled(raidId:string, client:PoolClient|null=null):Promise<RaidEventFacts|null>{return loadRaidEventFacts(raidId,client,true);}

export async function establishRaid(actorGuildieId:string,input:EstablishRaidInput):Promise<RaidEventFacts>{
  validateEstablishRaidInput(input); await requireGuildCapabilityOrOperator(actorGuildieId,RAID_MODIFY_CAPABILITY); const guildId=(await requireOperationalInstallationGuildBinding()).guildId; const tags=normalizedStrings(input.tags??["raid"]);
  const persisted = await withTransaction(async client=>{
    const r=await client.query<{raid_id:string}>(`INSERT INTO raid_events (guild_id,label,description,occurs_start_unix,occurs_end_unix,tags,difficulty,created_by_identity_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING raid_id`,[guildId,input.label.trim(),input.description?.trim()||null,input.occursAt[0],input.occursAt.length===2?input.occursAt[1]:null,tags,input.difficulty,actorGuildieId]);
    const raidId=r.rows[0].raid_id;
    await replaceRaidRequirements(client,raidId,input.requirements??[]);
    await recordRaidAction(client,raidId,"created",actorGuildieId);
    const facts=await raidEventFacts(raidId,client); if(!facts)throw new Error("Created Raid could not be reloaded");
    const publication=await publishEmission(client,{ code:"raid.established", subject:facts.raidId });
    const activityDeclaration=await publishActivityDeclaration(client,{kind:"temporal-relevance-changed",activityKind:"raid",activityId:facts.raidId});
    return { raid:facts, publication, activityDeclaration };
  });
  await deliverEmission(persisted.publication);
  await deliverEmission(persisted.activityDeclaration);
  return persisted.raid;
}

export async function modifyRaid(actorGuildieId:string,raidId:string,input:ModifyRaidInput):Promise<RaidEventFacts>{
  validateModifyRaidInput(input); await requireGuildCapabilityOrOperator(actorGuildieId,RAID_MODIFY_CAPABILITY);
  const persisted = await withTransaction(async client=>{
    const current=await raidEventFacts(raidId,client); if(!current)throw new Error("Raid not found"); requireActiveRaid(current);
    const occurs=input.occursAt??current.occursAt;
    await client.query(`UPDATE raid_events SET label=$2,description=$3,occurs_start_unix=$4,occurs_end_unix=$5,tags=$6,difficulty=$7,updated_at_unix=extract(epoch FROM now())::bigint WHERE raid_id=$1`,[
      raidId,input.label?.trim()??current.label,input.description===undefined?current.description:(input.description?.trim()||null),occurs[0],occurs.length===2?occurs[1]:null,input.tags===undefined?current.tags:normalizedStrings(input.tags),input.difficulty??current.difficulty]);
    if(input.requirements!==undefined)await replaceRaidRequirements(client,raidId,input.requirements);
    await recordRaidAction(client,raidId,"modified",actorGuildieId);
    const facts=await raidEventFacts(raidId,client); if(!facts)throw new Error("Raid not found");
    const publication=await publishEmission(client,{ code:"raid.modified", subject:facts.raidId });
    const temporalRelevanceChanged = current.occursAt[0] !== facts.occursAt[0] || current.occursAt[1] !== facts.occursAt[1];
    const activityDeclaration=temporalRelevanceChanged?await publishActivityDeclaration(client,{kind:"temporal-relevance-changed",activityKind:"raid",activityId:facts.raidId}):null;
    return { raid:facts, publication, activityDeclaration };
  });
  await deliverEmission(persisted.publication);
  if(persisted.activityDeclaration)await deliverEmission(persisted.activityDeclaration);
  return persisted.raid;
}

export async function cancelRaid(actorGuildieId:string,raidId:string):Promise<void>{
  await requireGuildCapabilityOrOperator(actorGuildieId,RAID_STAGE_CAPABILITY);
  const persisted=await withTransaction(async client=>{const current=await raidEventFacts(raidId,client);if(!current)throw new Error("Raid not found");requireActiveRaid(current);await closeOutstandingActivityParticipationOffers(client,{activityKind:"raid",activityId:raidId});await client.query("UPDATE raid_events SET cancelled_at_unix=extract(epoch FROM now())::bigint,cancelled_by_identity_id=$2,updated_at_unix=extract(epoch FROM now())::bigint WHERE raid_id=$1",[raidId,actorGuildieId]);const publication=await publishEmission(client,{ code:"raid.cancelled", subject:raidId });const activityDeclaration=await publishActivityDeclaration(client,{kind:"temporal-relevance-changed",activityKind:"raid",activityId:raidId});return{publication,activityDeclaration};});
  await deliverEmission(persisted.publication);
  await deliverEmission(persisted.activityDeclaration);
}

function raidSignupOfferContract(): ActivityParticipationOfferContract {
  return {
    context: [{ name: "offered_specs", kind: "wow_spec", allowMultiple: true }],
  };
}

function raidParticipationEligibility() {
  // Raid participation is open to authenticated web actors and permitted Discord actors.
  // Ingress authorization is enforced by the respective adapter, not guild roster facts.
  return { kind: "any" as const };
}

export async function raidParticipationOfferWorkspace(
  raid: RaidEventFacts,
  actor: ActivityParticipationActor,
): Promise<ParticipationOfferWorkspace> {
  return withTransaction(async (client) => {
    const existingOffers = await outstandingActivityParticipationOffersForActor(client, {
      activityKind: "raid",
      activityId: raid.raidId,
      actor,
    });
    if (existingOffers.length > 1) throw new Error("Raid actor has multiple outstanding Participation Offers");
    const workspace = await participationOfferWorkspace({
      actor,
      eligibility: raidParticipationEligibility(),
      contract: raidSignupOfferContract(),
      existingOffer: existingOffers[0] ?? null,
    });
    // Raid offers are declarations, never character-control assertions.
    return { ...workspace, requests: workspace.requests.map((request) => request.acquisition.kind === "wow_spec"
      ? { ...request, acquisition: { ...request.acquisition, characters: [], characterSource: null, allowDeclaredClass: true } }
      : request) };
  });
}

function raidOfferedSpecs(offer: ActivityParticipationOffer): RaidOfferedSpec[] {
  const offeredSpecs = offer.context.find((value) => value.name === "offered_specs");
  if (!Array.isArray(offeredSpecs?.value) || !offeredSpecs.value.length || offeredSpecs.value.some((value) => value.type !== "wow_spec")) {
    throw new Error("Raid Participation Offer does not contain valid specialization choices");
  }
  return offeredSpecs.value.flatMap((value) =>
    value.type === "wow_spec" ? [{ className: value.value.className, specName: value.value.specName }] : []
  );
}

async function establishRaidSignupWithContext(input: {
  raidId: string;
  applicantAnchor: RaidApplicantAnchor;
  context: Readonly<Record<string, unknown>>;
}): Promise<string> {
  const declared = input.context.offered_specs;
  if (Array.isArray(declared) && declared.some((item) => item !== null && typeof item === "object" && "character" in item)) {
    throw new Error("Raid offers must declare class and specialization, not a character");
  }
  const raid = await raidEventFacts(input.raidId);
  if (!raid) throw new Error("Raid not found");
  requireActiveRaid(raid);

  const persisted = await withTransaction(async (client) => {
    const actor = { kind: input.applicantAnchor.kind, reference: input.applicantAnchor.value } as const;
    const existingOffers = await outstandingActivityParticipationOffersForActor(client, {
      activityKind: "raid",
      activityId: input.raidId,
      actor,
    });
    if (existingOffers.length > 1) throw new Error("Raid actor has multiple outstanding Participation Offers");
    const existingOffer = existingOffers[0] ?? null;
    const signupRowId = existingOffer?.procedureReference ?? randomUUID();
    const offerInput = {
      activityKind: "raid",
      activityId: input.raidId,
      actor,
      eligibility: raidParticipationEligibility(),
      contract: raidSignupOfferContract(),
      context: input.context,
      procedureReference: signupRowId,
    };
    const offer = existingOffer
      ? await reviseActivityParticipationOffer(client, offerInput)
      : await constructActivityParticipationOffer(client, offerInput);
    raidOfferedSpecs(offer);

    if (!existingOffer) {
      await client.query(
        `INSERT INTO raid_signup_rows (signup_row_id,raid_id) VALUES ($1,$2)`,
        [signupRowId, input.raidId],
      );
    } else {
      await client.query(
        "UPDATE raid_signup_rows SET updated_at_unix=extract(epoch FROM now())::bigint WHERE raid_id=$1 AND signup_row_id=$2",
        [input.raidId, signupRowId],
      );
      await client.query("DELETE FROM raid_assignments WHERE raid_id=$1 AND signup_row_id=$2", [input.raidId, signupRowId]);
    }

    const publication = await publishEmission(client, { code: "raid.signup.established", subject: input.raidId });
    return { signupRowId, publication };
  });
  await deliverEmission(persisted.publication);
  return persisted.signupRowId;
}

export async function establishRaidSignup(input: EstablishRaidSignupInput): Promise<string> {
  if (!input.offeredSpecs.length) throw new Error("At least one specialization is required");
  return establishRaidSignupWithContext({
    raidId: input.raidId,
    applicantAnchor: input.applicantAnchor,
    context: { offered_specs: input.offeredSpecs },
  });
}

export async function establishRaidSignupFromParticipationContext(input: {
  raidId: string;
  applicantAnchor: RaidApplicantAnchor;
  context: Readonly<Record<string, unknown>>;
}): Promise<string> {
  return establishRaidSignupWithContext(input);
}

export async function revokeRaidSignup(input: RevokeRaidSignupInput): Promise<void> {
  const publication = await withTransaction(async (client) => {
    const raid = await raidEventFacts(input.raidId, client);
    if (!raid) throw new Error("Raid not found");
    requireActiveRaid(raid);
    const row = await client.query<{ signup_row_id: string }>(
      `SELECT rr.signup_row_id
         FROM raid_signup_rows rr
        WHERE rr.raid_id=$1
          AND rr.signup_row_id=$2
          AND rr.withdrawn_at_unix IS NULL
        FOR UPDATE OF rr`,
      [input.raidId, input.signupRowId],
    );
    if (!row.rowCount) throw new Error("Active Raid signup not found for applicant");
    const offer = await activityParticipationOfferByProcedureReference(client, {
      activityKind: "raid",
      activityId: input.raidId,
      procedureReference: input.signupRowId,
    });
    if (
      !offer
      || offer.revokedAtUnix !== null
      || offer.closedAtUnix !== null
      || offer.actor.kind !== input.applicantAnchor.kind
      || offer.actor.reference !== input.applicantAnchor.value
    ) {
      throw new Error("Active Raid signup not found for applicant");
    }

    await client.query("DELETE FROM raid_assignments WHERE raid_id=$1 AND signup_row_id=$2", [input.raidId, input.signupRowId]);
    await client.query(
      "UPDATE raid_signup_rows SET withdrawn_at_unix=extract(epoch FROM now())::bigint,updated_at_unix=extract(epoch FROM now())::bigint WHERE raid_id=$1 AND signup_row_id=$2",
      [input.raidId, input.signupRowId],
    );
    await revokeActivityParticipationOffer(client, {
      activityKind: "raid",
      activityId: input.raidId,
      actor: { kind: input.applicantAnchor.kind, reference: input.applicantAnchor.value },
      procedureReference: input.signupRowId,
    });
    return publishEmission(client, { code: "raid.signup.revoked", subject: input.raidId });
  });
  await deliverEmission(publication);
}

async function raidAssignmentCandidate(client:PoolClient,raidId:string,signupRowId:string):Promise<{offeredSpecs:RaidOfferedSpec[]}>{
  const rr=await client.query<{signup_row_id:string}>(`SELECT rr.signup_row_id
    FROM raid_signup_rows rr
    LEFT JOIN raid_signup_denials rsd ON rsd.raid_id=rr.raid_id AND rsd.signup_row_id=rr.signup_row_id
    WHERE rr.raid_id=$1 AND rr.signup_row_id=$2 AND rr.withdrawn_at_unix IS NULL AND rsd.signup_row_id IS NULL`,[raidId,signupRowId]);
  const row=rr.rows[0];if(!row)throw new Error("Raid signup is not available for assignment");
  const offer=await activityParticipationOfferByProcedureReference(client,{activityKind:"raid",activityId:raidId,procedureReference:signupRowId});
  if(!offer || offer.revokedAtUnix!==null || offer.closedAtUnix!==null)throw new Error("Raid signup Participation Offer is not available for assignment");
  return {offeredSpecs:raidOfferedSpecs(offer)};
}
export async function setRaidAssignment(actorGuildieId:string,input:EstablishRaidAssignmentInput):Promise<{ assignmentId:string; established:boolean }>{
  await requireGuildCapabilityOrOperator(actorGuildieId,RAID_ASSIGN_CAPABILITY);
  const persisted=await withTransaction(async client=>{
    const raid=await raidEventFacts(input.raidId,client);if(!raid)throw new Error("Raid not found");requireActiveRaid(raid);
    const row=await raidAssignmentCandidate(client,input.raidId,input.signupRowId);validateSelectedConfiguration(row.offeredSpecs,input.selectedClass,input.selectedSpec,input.selectedRole);
    const existing=await client.query<{assignment_id:string}>(`SELECT assignment_id FROM raid_assignments WHERE raid_id=$1 AND signup_row_id=$2 FOR UPDATE`,[input.raidId,input.signupRowId]);
    if(existing.rowCount){await client.query(`UPDATE raid_assignments SET selected_class=$3,selected_spec=$4,selected_role=$5,assigned_by_identity_id=$6,assigned_at_unix=extract(epoch FROM now())::bigint WHERE raid_id=$1 AND signup_row_id=$2`,[input.raidId,input.signupRowId,input.selectedClass,input.selectedSpec,input.selectedRole,actorGuildieId]);await recordRaidAction(client,input.raidId,"assignment_modified",actorGuildieId);return{result:{assignmentId:existing.rows[0].assignment_id,established:false},publication:await publishEmission(client,{code:"raid.assignment.modified",subject:input.raidId})};}
    const r=await client.query<{assignment_id:string}>(`INSERT INTO raid_assignments (raid_id,signup_row_id,selected_class,selected_spec,selected_role,assigned_by_identity_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING assignment_id`,[input.raidId,input.signupRowId,input.selectedClass,input.selectedSpec,input.selectedRole,actorGuildieId]);await recordRaidAction(client,input.raidId,"assignment_established",actorGuildieId);return{result:{assignmentId:r.rows[0].assignment_id,established:true},publication:await publishEmission(client,{code:"raid.assignment.established",subject:input.raidId})};
  });await deliverEmission(persisted.publication);return persisted.result;
}
export async function establishRaidAssignment(actorGuildieId:string,input:EstablishRaidAssignmentInput):Promise<string>{await requireGuildCapabilityOrOperator(actorGuildieId,RAID_ASSIGN_CAPABILITY);const persisted=await withTransaction(async client=>{const raid=await raidEventFacts(input.raidId,client);if(!raid)throw new Error("Raid not found");requireActiveRaid(raid);const row=await raidAssignmentCandidate(client,input.raidId,input.signupRowId);validateSelectedConfiguration(row.offeredSpecs,input.selectedClass,input.selectedSpec,input.selectedRole);const r=await client.query<{assignment_id:string}>(`INSERT INTO raid_assignments (raid_id,signup_row_id,selected_class,selected_spec,selected_role,assigned_by_identity_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (raid_id,signup_row_id) DO NOTHING RETURNING assignment_id`,[input.raidId,input.signupRowId,input.selectedClass,input.selectedSpec,input.selectedRole,actorGuildieId]);if(!r.rowCount)throw new Error("Raid assignment already exists");await recordRaidAction(client,input.raidId,"assignment_established",actorGuildieId);return{assignmentId:r.rows[0].assignment_id,publication:await publishEmission(client,{code:"raid.assignment.established",subject:input.raidId})};});await deliverEmission(persisted.publication);return persisted.assignmentId;}
export async function modifyRaidAssignment(actorGuildieId:string,input:ModifyRaidAssignmentInput):Promise<void>{await requireGuildCapabilityOrOperator(actorGuildieId,RAID_ASSIGN_CAPABILITY);const publication=await withTransaction(async client=>{const raid=await raidEventFacts(input.raidId,client);if(!raid)throw new Error("Raid not found");requireActiveRaid(raid);const row=await raidAssignmentCandidate(client,input.raidId,input.signupRowId);validateSelectedConfiguration(row.offeredSpecs,input.selectedClass,input.selectedSpec,input.selectedRole);const r=await client.query(`UPDATE raid_assignments SET selected_class=$3,selected_spec=$4,selected_role=$5,assigned_by_identity_id=$6,assigned_at_unix=extract(epoch FROM now())::bigint WHERE raid_id=$1 AND signup_row_id=$2`,[input.raidId,input.signupRowId,input.selectedClass,input.selectedSpec,input.selectedRole,actorGuildieId]);if(!r.rowCount)throw new Error("Raid assignment not found");await recordRaidAction(client,input.raidId,"assignment_modified",actorGuildieId);return publishEmission(client,{code:"raid.assignment.modified",subject:input.raidId});});await deliverEmission(publication);}
export async function withdrawRaidAssignment(actorGuildieId:string,raidId:string,signupRowId:string):Promise<void>{await requireGuildCapabilityOrOperator(actorGuildieId,RAID_ASSIGN_CAPABILITY);const publication=await withTransaction(async client=>{const raid=await raidEventFacts(raidId,client);if(!raid)throw new Error("Raid not found");requireActiveRaid(raid);const r=await client.query("DELETE FROM raid_assignments WHERE raid_id=$1 AND signup_row_id=$2",[raidId,signupRowId]);if(!r.rowCount)throw new Error("Raid assignment not found");await recordRaidAction(client,raidId,"assignment_withdrawn",actorGuildieId);return publishEmission(client,{code:"raid.assignment.withdrawn",subject:raidId});});await deliverEmission(publication);}
export async function denyRaidSignup(actorGuildieId:string,input:DenyRaidSignupInput):Promise<void>{await requireGuildCapabilityOrOperator(actorGuildieId,RAID_ASSIGN_CAPABILITY);const publication=await withTransaction(async client=>{const raid=await raidEventFacts(input.raidId,client);if(!raid)throw new Error("Raid not found");requireActiveRaid(raid);const signup=await client.query(`SELECT 1 FROM raid_signup_rows WHERE raid_id=$1 AND signup_row_id=$2 AND withdrawn_at_unix IS NULL`,[input.raidId,input.signupRowId]);if(!signup.rowCount)throw new Error("Raid signup not found");const assigned=await client.query(`SELECT 1 FROM raid_assignments WHERE raid_id=$1 AND signup_row_id=$2`,[input.raidId,input.signupRowId]);if(assigned.rowCount)throw new Error("Assigned Raid signup cannot be denied");const r=await client.query(`INSERT INTO raid_signup_denials (raid_id,signup_row_id,denied_by_identity_id) VALUES ($1,$2,$3) ON CONFLICT (raid_id,signup_row_id) DO NOTHING RETURNING signup_row_id`,[input.raidId,input.signupRowId,actorGuildieId]);if(!r.rowCount)throw new Error("Raid signup is already denied");await closeActivityParticipationOffer(client,{activityKind:"raid",activityId:input.raidId,procedureReference:input.signupRowId});await recordRaidAction(client,input.raidId,"signup_denied",actorGuildieId);return publishEmission(client,{code:"raid.signup.denied",subject:input.raidId});});await deliverEmission(publication);}
export type RaidCommitmentAdjudication = { signupRowId:string; fulfilled:boolean; adjudicatedByGuildieId:string; adjudicatedAtUnix:number };

export async function raidCommitmentAdjudications(raidId:string):Promise<RaidCommitmentAdjudication[]>{
  const r=await pool.query<any>(`SELECT signup_row_id,fulfilled,adjudicated_by_identity_id,adjudicated_at_unix FROM raid_commitment_adjudications WHERE raid_id=$1 ORDER BY adjudicated_at_unix,signup_row_id`,[raidId]);
  return r.rows.map((row:any)=>({signupRowId:row.signup_row_id,fulfilled:row.fulfilled,adjudicatedByGuildieId:row.adjudicated_by_identity_id,adjudicatedAtUnix:Number(row.adjudicated_at_unix)}));
}

export async function adjudicateRaidCommitment(actorGuildieId:string,raidId:string,signupRowId:string,fulfilled:boolean):Promise<void>{
  await requireGuildCapabilityOrOperator(actorGuildieId,RAID_STAGE_CAPABILITY);
  const publication=await withTransaction(async client=>{
    const raid=await raidEventFacts(raidId,client);if(!raid)throw new Error("Raid not found");requireActiveRaid(raid);
    const signup=await client.query(`SELECT 1 FROM raid_signup_rows rr LEFT JOIN raid_signup_denials rsd ON rsd.raid_id=rr.raid_id AND rsd.signup_row_id=rr.signup_row_id WHERE rr.raid_id=$1 AND rr.signup_row_id=$2 AND rr.withdrawn_at_unix IS NULL AND rsd.signup_row_id IS NULL`,[raidId,signupRowId]);
    if(!signup.rowCount)throw new Error("Active Raid commitment not found");
    await client.query(`INSERT INTO raid_commitment_adjudications (raid_id,signup_row_id,fulfilled,adjudicated_by_identity_id) VALUES ($1,$2,$3,$4) ON CONFLICT (raid_id,signup_row_id) DO UPDATE SET fulfilled=EXCLUDED.fulfilled,adjudicated_by_identity_id=EXCLUDED.adjudicated_by_identity_id,adjudicated_at_unix=extract(epoch FROM now())::bigint`,[raidId,signupRowId,fulfilled,actorGuildieId]);
    return publishEmission(client,{code:"raid.commitment.adjudicated",subject:raidId});
  });
  await deliverEmission(publication);
}

export async function concludeRaid(actorGuildieId:string,raidId:string):Promise<void>{
  await requireGuildCapabilityOrOperator(actorGuildieId,RAID_STAGE_CAPABILITY);
  const persisted=await withTransaction(async client=>{
    const raid=await raidEventFacts(raidId,client);if(!raid)throw new Error("Raid not found");requireActiveRaid(raid);
    const commitments=await client.query<any>(`SELECT rr.signup_row_id,rca.fulfilled FROM raid_signup_rows rr LEFT JOIN raid_signup_denials rsd ON rsd.raid_id=rr.raid_id AND rsd.signup_row_id=rr.signup_row_id LEFT JOIN raid_commitment_adjudications rca ON rca.raid_id=rr.raid_id AND rca.signup_row_id=rr.signup_row_id WHERE rr.raid_id=$1 AND rr.withdrawn_at_unix IS NULL AND rsd.signup_row_id IS NULL FOR UPDATE OF rr`,[raidId]);
    const unresolved=commitments.rows.filter((row:any)=>row.fulfilled===null);if(unresolved.length)throw new Error("Every active Raid commitment must be adjudicated before conclusion");
    for(const row of commitments.rows){
      const offer=await activityParticipationOfferByProcedureReference(client,{activityKind:"raid",activityId:raidId,procedureReference:row.signup_row_id});
      if(!offer)throw new Error("Raid commitment Participation Offer not found");
      if(row.fulfilled){await establishActivityParticipation(client,{activityKind:"raid",activityId:raidId,party:offer.actor,procedureReference:row.signup_row_id,participationOfferId:offer.participationOfferId});}
      else{await closeActivityParticipationOffer(client,{activityKind:"raid",activityId:raidId,procedureReference:row.signup_row_id});}
    }
    await client.query(`UPDATE raid_events SET concluded_at_unix=extract(epoch FROM now())::bigint,concluded_by_identity_id=$2,updated_at_unix=extract(epoch FROM now())::bigint WHERE raid_id=$1`,[raidId,actorGuildieId]);
    return publishEmission(client,{code:"raid.concluded",subject:raidId});
  });
  await deliverEmission(persisted);
}

export async function raidRosterDiagnostics(raidId:string):Promise<RaidRosterDiagnostics>{const r=await pool.query<any>(`SELECT ra.selected_role,ra.selected_class,ra.selected_spec FROM raid_assignments ra JOIN raid_signup_rows rr ON rr.signup_row_id=ra.signup_row_id WHERE ra.raid_id=$1 AND rr.withdrawn_at_unix IS NULL`,[raidId]);return r.rows.reduce((d:RaidRosterDiagnostics,row:any)=>{d.assigned++;if(row.selected_role==="tank")d.tanks++;if(row.selected_role==="healer")d.healers++;if(row.selected_role==="damage"){d.damage++;const p=positionForSpec(row.selected_class,row.selected_spec);if(p==="melee")d.melee++;if(p==="ranged")d.ranged++;}return d;},{assigned:0,tanks:0,healers:0,damage:0,melee:0,ranged:0});}
export async function assignedRaidCapabilities(raidId:string):Promise<readonly WowTrait[]>{const r=await pool.query<any>(`SELECT ra.selected_class,ra.selected_spec FROM raid_assignments ra JOIN raid_signup_rows rr ON rr.signup_row_id=ra.signup_row_id WHERE ra.raid_id=$1 AND rr.withdrawn_at_unix IS NULL ORDER BY ra.assigned_at_unix,ra.assignment_id`,[raidId]);return [...new Set<WowTrait>(r.rows.flatMap((row:any)=>traitsForSpec(row.selected_class,row.selected_spec)))].sort();}
