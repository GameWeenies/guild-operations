import type { FastifyInstance } from "fastify";
import { authenticatedIdentity, SESSION_COOKIE_NAME } from "../../../auth.js";
import { GuildCapabilityDeniedError, identityHasGuildCapabilityOrOperator } from "../../../core/authority/guild-permissions.js";
import { RAID_MODIFY_CAPABILITY, RAID_STAGE_CAPABILITY } from "../permissions.js";

import { cancelRaid, modifyRaid, raidEventFacts, raidOccurrenceDestinations } from "../application.js";
import { RAID_DESCRIPTION_MAX_LENGTH, RAID_LABEL_MAX_LENGTH, type RaidDifficulty, type RaidRequirement } from "../domain.js";
import type { AssetRegistry } from "../../../web/assets.js";
import { htmlText, renderOccurrenceOperations, renderPage } from "../../../web/render.js";
import { viewerForRequest } from "../../../web/viewer.js";

type RaidParams = { raidId: string };
type DefinitionBody = { label?: unknown; description?: unknown; occursAt?: unknown; difficulty?: unknown; requirements?: unknown };

function validDifficulty(value: unknown): value is RaidDifficulty {
  return value === "normal" || value === "heroic" || value === "mythic";
}

function validRequirements(value: unknown): value is RaidRequirement[] {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item === "object" && typeof (item as Record<string, unknown>).label === "string" && typeof (item as Record<string, unknown>).value === "string");
}

function status(error: unknown): 400 | 403 {
  return error instanceof GuildCapabilityDeniedError ? 403 : 400;
}

function selected(actual: string, value: string): string {
  return actual === value ? " selected" : "";
}

function difficultyLabel(value: RaidDifficulty): string {
  return value[0].toUpperCase() + value.slice(1);
}

export async function registerRaidDefinitionPage(app: FastifyInstance, assets: AssetRegistry): Promise<void> {
  app.get<{ Params: RaidParams }>("/activities/raid/:raidId/manage/definition", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    const [viewer, identity, raid] = await Promise.all([
      viewerForRequest(token),
      authenticatedIdentity(token),
      raidEventFacts(request.params.raidId),
    ]);
    if (!raid) return reply.code(404).send({ error: "Raid not found" });

    const [canModify, canStage] = identity
      ? await Promise.all([
          identityHasGuildCapabilityOrOperator(identity.identityId, RAID_MODIFY_CAPABILITY),
          identityHasGuildCapabilityOrOperator(identity.identityId, RAID_STAGE_CAPABILITY),
        ])
      : [false, false];
    if (!identity || (!canModify && !canStage)) {
      return reply.code(identity ? 403 : 401).send({ error: "Raid editing is not available for this account" });
    }

    const destinations = raidOccurrenceDestinations(raid.raidId);
    const publicDestination = destinations.find((destination) => destination.kind === "public");
    const operateDestination = destinations.find((destination) => destination.kind === "operate");
    if (!operateDestination) throw new Error("Raid operate destination is not configured");
    const basePath = operateDestination.href;
    const min = raid.requirements.find((requirement) => requirement.label === "Minimum item level")?.value ?? "";
    const enchants = raid.requirements.find((requirement) => requirement.label === "Enchants & gems")?.value ?? "";
    const historical = raid.concludedAtUnix !== null;

    const edit = canModify && !historical
      ? `<form class="raid-admin-form" data-raid-definition-form>
          <label><span>Raid name</span><input name="label" type="text" value="${htmlText(raid.label)}" maxlength="${RAID_LABEL_MAX_LENGTH}" required></label>
          <label><span>Description <small>(optional)</small></span><textarea name="description" rows="3" maxlength="${RAID_DESCRIPTION_MAX_LENGTH}">${htmlText(raid.description ?? "")}</textarea></label>
          <label><span>Start time</span><input name="startsAt" type="datetime-local" data-raid-definition-start="${raid.occursAt[0]}" required></label>
          <label><span>Difficulty</span><select name="difficulty"><option value="normal"${selected(raid.difficulty, "normal")}>Normal</option><option value="heroic"${selected(raid.difficulty, "heroic")}>Heroic</option><option value="mythic"${selected(raid.difficulty, "mythic")}>Mythic</option></select></label>
          <fieldset><legend>Readiness requirements</legend><p>These expectations are presented to participants and are not mechanically checked.</p><label><span>Minimum item level <small>(optional)</small></span><input name="minimumItemLevel" type="number" min="1" step="1" value="${htmlText(min)}"></label><label><span>Enchants &amp; gems</span><select name="enchantsAndGems"><option value=""${selected(enchants, "")}>No stated requirement</option><option value="Required"${selected(enchants, "Required")}>Required</option><option value="Preferred"${selected(enchants, "Preferred")}>Preferred</option><option value="Not required"${selected(enchants, "Not required")}>Not required</option></select></label></fieldset>
          <button type="submit" class="button-primary">Save changes</button>
        </form>`
      : `<section class="raid-admin-form"><p>${historical ? "This raid is concluded. Its definition is preserved as history." : "You can inspect this raid, but you cannot edit it."}</p><dl class="raid-admin-card-facts"><dt>Name</dt><dd>${htmlText(raid.label)}</dd><dt>Difficulty</dt><dd>${htmlText(difficultyLabel(raid.difficulty))}</dd></dl></section>`;

    const lifecycleActions = canStage && !historical
      ? `<button type="button" class="button-destructive" data-raid-cancel>Cancel raid</button>`
      : "";

    const html = renderPage(assets, {
      pathname: request.url,
      title: `${raid.label} · Raid Operations · ${viewer.guildPresentation.guildName} Guild Operations`,
      description: raid.description ?? "Raid operations.",
      viewer,
      stylesheets: ["admin.css", "raid-admin.css"],
      scripts: ["admin.js", "raid-definition.js"],
      secondaryNavigation: { kind: "breadcrumb", items: [{ label: "Activities", href: "/activities" }, { label: "Raid operations", href: "/activities/raid/manage" }, { label: raid.label }] },
      header: "",
      body: renderOccurrenceOperations({ title: raid.label, context: `<time data-unix-time="${raid.occursAt[0]}">${raid.occursAt[0]}</time> · ${htmlText(difficultyLabel(raid.difficulty))}${historical ? " · Historical" : ""}`, publicAction: publicDestination ? { label: publicDestination.label, href: publicDestination.href } : undefined, modes: [{ label: "Assign", href: basePath }, { label: "Edit", href: `${basePath}/definition`, current: true }], lifecycleActions, workspace: `<section class="raid-admin-setup">${edit}<p data-raid-definition-status role="status" aria-live="polite"></p></section>` }),
    });
    return reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(html);
  });

  app.post<{ Params: RaidParams; Body: DefinitionBody }>("/activities/raid/:raidId/manage/definition", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "Authentication required" });
    const body = request.body ?? {};
    if (typeof body.label !== "string" || typeof body.description !== "string" || !Array.isArray(body.occursAt) || body.occursAt.length !== 1 || typeof body.occursAt[0] !== "number" || !validDifficulty(body.difficulty) || !validRequirements(body.requirements)) {
      return reply.code(400).send({ error: "Raid definition is invalid" });
    }
    try {
      return { raid: await modifyRaid(identity.identityId, request.params.raidId, { label: body.label, description: body.description, occursAt: [body.occursAt[0]], difficulty: body.difficulty, requirements: body.requirements }) };
    } catch (error) {
      return reply.code(status(error)).send({ error: error instanceof Error ? error.message : "Raid could not be modified" });
    }
  });

  app.post<{ Params: RaidParams }>("/activities/raid/:raidId/manage/cancel", async (request, reply) => {
    const identity = await authenticatedIdentity(request.cookies[SESSION_COOKIE_NAME]);
    if (!identity) return reply.code(401).send({ error: "Authentication required" });
    try {
      await cancelRaid(identity.identityId, request.params.raidId);
      return { ok: true };
    } catch (error) {
      return reply.code(status(error)).send({ error: error instanceof Error ? error.message : "Raid could not be cancelled" });
    }
  });
}
