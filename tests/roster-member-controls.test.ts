import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");
const script = readFileSync(new URL("../src/web/public/roster.js", import.meta.url), "utf8");

test("member mutation controls are restricted to initialized Manual mode", () => {
  assert.ok(page.includes('comparison.mode === "manual" && comparison.manualInitialized'));
  assert.ok(page.includes('manualControls ?'));
  assert.ok(page.includes('data-member-save'));
  assert.ok(page.includes('data-member-remove'));
  assert.ok(page.includes('data-member-add'));
  assert.ok(page.includes('manualRosterCharacterCandidates(identity.identityId)'));
  assert.ok(page.includes('guildRankDefinitions(comparison.guildId)'));
});
test("member actions use existing roster API and require removal confirmation", () => {
  assert.ok(script.includes('fetch("/guild/roster/members"'));
  assert.ok(script.includes('character_record_id: characterRecordId'));
  assert.ok(script.includes('rank_index: Number(rankIndex)'));
  assert.ok(script.includes('window.confirm("Remove this character'));
  assert.ok(script.includes('window.location.reload()'));
});
