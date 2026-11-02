import assert from "node:assert/strict";
import { test } from "node:test";
import { reconciliationVersion, compareRosterEntries } from "../src/core/guild/roster-reconciliation.js";
import { readFileSync } from "node:fs";

const rows = [
  { character_record_id: "a", name: "A", realm_slug: null, level: null, declared_rank: 1, observed_rank: 2 },
  { character_record_id: "b", name: "B", realm_slug: null, level: null, declared_rank: 3, observed_rank: null },
];
test("version rejects changed membership, ranks, and reacquired snapshots", () => {
  const date = new Date("2026-11-01T00:00:00Z");
  const version = reconciliationVersion(rows, date);
  assert.equal(version, reconciliationVersion(rows, date));
  assert.notEqual(version, reconciliationVersion(rows, new Date("2026-11-02T00:00:00Z")));
  assert.notEqual(version, reconciliationVersion([{ ...rows[0], observed_rank: 3 }, rows[1]], date));
});
test("partial selections can preserve discrepancies", () => {
  const differences = compareRosterEntries(new Map([["a", 1], ["b", 3]]), new Map([["a", 2]]));
  assert.equal(differences.length, 2);
  assert.equal(differences.find((item) => item.characterRecordId === "b")?.kind, "declared_only");
});
test("transaction validates preview and selections before mutation", () => {
  const source = readFileSync(new URL("../src/core/guild/roster-mode-transitions.ts", import.meta.url), "utf8");
  const transition = source.slice(source.indexOf("export async function activateManualWithReconciliation"));
  assert.ok(transition.indexOf("reconciliationVersion(rows") < transition.indexOf("DELETE FROM guild_declared_roster"));
  assert.ok(transition.indexOf("selectedCharacterRecordIds.some") < transition.indexOf("DELETE FROM guild_declared_roster"));
  assert.match(transition, /FOR UPDATE/);
  assert.match(transition, /SET mode = 'manual'/);
  assert.match(transition, /guildieRosterTransitions\(before, after\)/);
});
