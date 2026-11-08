import type { FastifyInstance } from "fastify";
import { authenticatedIdentity, SESSION_COOKIE_NAME } from "../../../auth.js";
import { raidEventFacts, raidOccurrenceDestinations, raidParticipationOfferWorkspace, establishRaidSignup, establishRaidSignupFromParticipationContext, revokeRaidSignup } from "../application.js";
import { raidSignupsForGuildie, type RaidSignupView } from "../participation-view.js";
import type { RaidDifficulty, RaidOfferedSpecInput, RaidRole } from "../domain.js";
import type { AssetRegistry } from "../../../web/assets.js";
import { htmlText, renderOccurrenceParticipation, renderPage } from "../../../web/render.js";
import { viewerForRequest } from "../../../web/viewer.js";
import { renderParticipationOfferWorkspace } from "../../../web/participation-offer-workspace.js";

type RaidParams = { raidId: string };
type WithdrawParams = RaidParams & { signupRowId: string };
type SignupBody = { offeredSpecs?: unknown; context?: unknown };

function roleLabel(role: RaidRole): string { return role === "damage" ? "Damage" : role === "healer" ? "Healer" : "Tank"; }
function difficultyLabel(value: RaidDifficulty): string { return value[0].toUpperCase() + value.slice(1); }
function localTime(unixSeconds:number):string{const instant=new Date(unixSeconds*1000).toISOString();return `<time datetime="${instant}" data-local-time-unix="${unixSeconds}" data-local-time-date-style="full">${instant}</time>`;}

function ownSignupsView(rows:readonly RaidSignupView[],canWithdraw:boolean):string{
  return rows.length?`<section class="raid-my-offers"><h2>Your participation</h2><div>${rows.map(row=>`<article><strong>${htmlText(row.displayName)}</strong><span>Willing to play: ${row.offeredSpecs.map(spec=>htmlText(`${spec.specName} ${spec.className}`)).join(", ")}</span>${row.assignmentId!==null?`<span>Assigned: ${htmlText(row.selectedSpec??"")} ${htmlText(row.selectedClass??"")} · ${htmlText(roleLabel(row.selectedRole!))}</span>`:""}${canWithdraw?`<button type="button" class="button-secondary" data-raid-revoke-signup="${htmlText(row.signupRowId)}">Withdraw</button>`:""}</article>`).join("")}</div></section>`:"";
}

function offeredSpecInput(value:unknown):RaidOfferedSpecInput|null{
  if(!value||typeof value!=="object")return null;
  const item=value as Record<string,unknown>;
  if(typeof item.specName!=="string"||!item.specName.trim())return null;
  if(typeof item.className!=="string"||!item.className.trim())return null;
  return {className:item.className.trim(),specName:item.specName.trim()};
}

export async function registerRaidParticipationRoutes(app:FastifyInstance,assets:AssetRegistry):Promise<void>{
  app.get<{Params:RaidParams}>("/activities/raid/:raidId/participation",async(request,reply)=>{const sessionToken=request.cookies[SESSION_COOKIE_NAME];const [viewer,identity,raid]=await Promise.all([viewerForRequest(sessionToken),authenticatedIdentity(sessionToken),raidEventFacts(request.params.raidId)]);if(!raid)return reply.code(404).send({error:"Raid not found"});const historical=raid.concludedAtUnix!==null,signupsOpen=!historical,publicDestination=raidOccurrenceDestinations(raid.raidId).find(value=>value.kind==="public");let intake="",ownRows="";let existing:RaidSignupView|null=null;if(identity){try{const rows=await raidSignupsForGuildie(raid.raidId,identity.identityId);existing=rows.find(row=>row.withdrawnAtUnix===null&&row.deniedAtUnix===null)??null;ownRows=ownSignupsView(rows,signupsOpen);}catch{ownRows="";}}
    if(historical){intake=`<section class="raid-signup-state"><h2>Raid record</h2><p>This raid is concluded. Its commitments, assignments, adjudications, and established Participation are preserved as history.</p></section>`;}else if(!identity){intake=`<section class="raid-signup-state"><h2>Sign in to participate</h2><p>Sign in to Guild Operations to offer your class and specializations. Discord signups are available when enabled by the guild.</p></section>`;}else{try{const workspace=await raidParticipationOfferWorkspace(raid,{kind:"native",reference:identity.identityId});intake=renderParticipationOfferWorkspace(workspace,{action:`/activities/raid/${encodeURIComponent(raid.raidId)}/signup`});}catch(error){intake=`<section class="raid-signup-state"><h2>Signup unavailable</h2><p>${htmlText(error instanceof Error?error.message:"Raid signup is temporarily unavailable.")}</p></section>`;}}
    const html=renderPage(assets,{pathname:request.url,title:`Participation · ${raid.label} · ${viewer.guildPresentation.guildName} Guild Operations`,description:`Participation for ${raid.label}.`,viewer,stylesheets:["raid.css"],scripts:["participation-offer-workspace.js"],secondaryNavigation:publicDestination?{kind:"back",label:raid.label,href:publicDestination.href}:{kind:"back",label:"Activities",href:"/activities"},header:"",body:renderOccurrenceParticipation({activity:"Raid",title:raid.label,context:`${localTime(raid.occursAt[0])} · ${htmlText(difficultyLabel(raid.difficulty))}${historical?" · Historical":""}`,existingParticipation:ownRows||undefined,intake})});return reply.header("Cache-Control","no-cache").type("text/html; charset=utf-8").send(html);});

  app.post<{Params:RaidParams;Body:SignupBody}>("/activities/raid/:raidId/signup",async(request,reply)=>{
    const identity=await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if(!identity)return reply.code(401).send({error:"Authentication required"});
    try{
      const suppliedContext=request.body?.context;
      if(suppliedContext&&typeof suppliedContext==="object"&&!Array.isArray(suppliedContext)){
        const signupRowId=await establishRaidSignupFromParticipationContext({
          raidId:request.params.raidId,
          applicantAnchor:{kind:"native",value:identity.identityId},
          context:suppliedContext as Record<string,unknown>,
        });
        return reply.code(201).send({signupRowId});
      }
      const raw=request.body?.offeredSpecs;
      if(!Array.isArray(raw)||!raw.length)return reply.code(400).send({error:"At least one specialization is required"});
      const offeredSpecs=raw.map(offeredSpecInput);
      if(offeredSpecs.some(value=>value===null))return reply.code(400).send({error:"Specialization offer is invalid"});
      const signupRowId=await establishRaidSignup({
        raidId:request.params.raidId,
        applicantAnchor:{kind:"native",value:identity.identityId},
        offeredSpecs:offeredSpecs as RaidOfferedSpecInput[],
      });
      return reply.code(201).send({signupRowId});
    }catch(error){
      return reply.code(400).send({error:error instanceof Error?error.message:"Signup could not be submitted"});
    }
  });
  app.post<{Params:WithdrawParams}>("/activities/raid/:raidId/signup/:signupRowId/withdraw",async(request,reply)=>{const identity=await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);if(!identity)return reply.code(401).send({error:"Authentication required"});try{await revokeRaidSignup({raidId:request.params.raidId,signupRowId:request.params.signupRowId,applicantAnchor:{kind:"native",value:identity.identityId}});return reply.code(204).send();}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:"Signup could not be withdrawn"});}});
}
