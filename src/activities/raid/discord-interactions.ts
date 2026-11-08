import { componentLogger } from "../../core/runtime-logger.js";

const log = componentLogger("discord.raid.participation");

import { raidEventFacts, raidParticipationOfferWorkspace, establishRaidSignup } from "./application.js";
import { raidSignups } from "./participation-view.js";
import { revokeRaidSignup } from "./application.js";
import { establishDiscordIdentity, resolvedActorSubjectForDiscordIdentity } from "../../integrations/discord/identity.js";
import { registerDiscordComponentHandler, type DiscordComponentInteraction, type DiscordInteractionResponse } from "../../integrations/discord/interaction-handlers.js";
import { discordIntegrationConfiguration } from "../../integrations/discord/configuration.js";
import { specsForClass } from "../../wow-traits/registry.js";
import type { RaidApplicantAnchor, RaidOfferedSpecInput } from "./domain.js";

const classes = ["Death Knight", "Demon Hunter", "Druid", "Evoker", "Hunter", "Mage", "Monk", "Paladin", "Priest", "Rogue", "Shaman", "Warlock", "Warrior"];
const ephemeral = (content: string): DiscordInteractionResponse => ({ type: 4, data: { flags: 64, content } });
const menu = (content: string, customId: string, options: { label: string; value: string }[], multiple = false): DiscordInteractionResponse => ({
  type: 4, data: { flags: 64, content, components: [{ type: 1, components: [{ type: 3, custom_id: customId, min_values: 1, max_values: multiple ? options.length : 1, options }] }] },
});

async function actorFor(interaction: DiscordComponentInteraction): Promise<RaidApplicantAnchor> {
  const user = interaction.member?.user;
  if (!user?.id || !/^\d+$/.test(user.id)) throw new Error("Discord member identity unavailable");
  const discordId = await establishDiscordIdentity({ discordUserId: user.id, username: interaction.member?.nick || user.global_name || user.username });
  const subject = await resolvedActorSubjectForDiscordIdentity(discordId);
  return subject === discordId ? { kind: "external", value: discordId } : { kind: "native", value: subject };
}

async function handleRaid(interaction: DiscordComponentInteraction): Promise<DiscordInteractionResponse> {
  const id = interaction.data?.custom_id ?? "";
  const match = /^go:raid:(start|class|spec|withdraw):([0-9a-f-]{36})$/.exec(id);
  if (!match) return ephemeral("This raid interaction is no longer valid.");
  const [, action, raidId] = match;
  const raid = await raidEventFacts(raidId);
  if (!raid || raid.concludedAtUnix !== null) return ephemeral("This raid is no longer accepting signups.");
  const configuration = await discordIntegrationConfiguration();
  if (!configuration?.enabled || !configuration.allowRaidSignups) return ephemeral("Discord raid signups are disabled. Use the Guild Operations website.");
  const actor = await actorFor(interaction);
  if (action === "withdraw") {
    const rows = await raidSignups(raidId);
    const mine = rows.filter(row => row.actorKind === actor.kind && row.actorReference === actor.value && row.withdrawnAtUnix === null && row.deniedAtUnix === null);
    if (!mine.length) return ephemeral("You have no active signup to withdraw.");
    for (const row of mine) await revokeRaidSignup({ raidId, signupRowId: row.signupRowId, applicantAnchor: actor });
    return ephemeral("Your raid signup has been withdrawn.");
  }
  const workspace = await raidParticipationOfferWorkspace(raid, { kind: actor.kind, reference: actor.value });
  const acquisition = workspace.requests.find(item => item.request.name === "offered_specs")?.acquisition;
  if (!acquisition || acquisition.kind !== "wow_spec") return ephemeral("Raid specialization choices are unavailable.");
  if (action === "start") {
    return menu("Choose a class for your raid signup.", `go:raid:class:${raidId}`, classes.map((name, index) => ({ label: name, value: String(index) })));
  }
  if (action === "class") {
    const index = Number(interaction.data?.values?.[0] ?? "");
    const className = Number.isInteger(index) ? classes[index] : undefined;
    if (!className) return ephemeral("Invalid class. Start again.");
    return menu(`Choose specializations for ${className}.`, `go:raid:spec:${raidId}`, specsForClass(className).map(spec => ({ label: `${spec} ${className}`, value: `${index}:${spec}` })), true);
  }
  if (action === "spec") {
    const selections = interaction.data?.values ?? [];
    if (!selections.length || selections.length > 4 || new Set(selections).size !== selections.length) return ephemeral("Invalid specialization selection. Start again.");
    const offers: RaidOfferedSpecInput[] = [];
    let selectedClass: string | null = null;
    for (const selected of selections) {
      const matchSpec = /^(\\d{1,2}):(.{1,60})$/.exec(selected);
      if (!matchSpec) return ephemeral("Invalid specialization. Start again.");
      const className = classes[Number(matchSpec[1])];
      if (!className || (selectedClass !== null && selectedClass !== className) || !specsForClass(className).includes(matchSpec[2])) return ephemeral("Invalid specialization. Start again.");
      selectedClass = className;
      offers.push({ className, specName: matchSpec[2] });
    }
    await establishRaidSignup({ raidId, applicantAnchor: actor, offeredSpecs: offers });
    return ephemeral("Your raid signup has been recorded. You can use Sign up again to revise it.");
  }
  return ephemeral("Unsupported raid interaction.");
}

export function registerDiscordRaidInteractionHandler(): void {
  registerDiscordComponentHandler("go:raid:", async interaction => {
    try { return await handleRaid(interaction); }
    catch (error) {
      log.error({ err: error, interactionId: interaction.id ?? null, interactionKind: "go:raid" }, "Discord raid interaction failed");
      return ephemeral("Raid participation could not be completed. Please try again or use the Guild Operations website.");
    }
  });
}
