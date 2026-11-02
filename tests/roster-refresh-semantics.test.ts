import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { guildieRosterTransitions, type GuildieRosterState } from "../src/core/guild/guildie-roster-transitions.js";
import { effectiveGuildRosterSql } from "../src/core/guild/effective-roster.js";

const state = (entries: Array<[string, number]>): Map<string, GuildieRosterState> =>
  new Map(entries.map(([identityId, rankIndex]) => [identityId, { identityId, rankIndex }]));

test("Manual observation-only changes cannot emit effective guildie transitions", () => {
  const before = state([["member", 3]]);
  const after = state([["member", 3]]);
  assert.deepEqual(guildieRosterTransitions(before, after), []);
  assert.match(effectiveGuildRosterSql, /management.mode = 'manual'/);
  assert.match(effectiveGuildRosterSql, /JOIN guild_declared_roster declared/);
});

test("Blizzard Sync effective changes emit joins, removals and rank changes", () => {
  const before = state([["removed", 2], ["promoted", 5], ["unchanged", 4]]);
  const after = state([["promoted", 1], ["unchanged", 4], ["joined", 6]]);
  assert.deepEqual(guildieRosterTransitions(before, after), [
    { code: "guildie.rank.modified", identityId: "promoted" },
    { code: "guildie.joined", identityId: "joined" },
    { code: "guildie.left", identityId: "removed" },
  ]);
  assert.match(effectiveGuildRosterSql, /management.mode = 'blizzard_sync'/);
});

test("refresh records acquisition provenance and compares effective states inside its transaction", () => {
  const source = readFileSync(new URL("../src/core/guild/guild-refresh.ts", import.meta.url), "utf8");
  assert.match(source, /INSERT INTO guild_roster_observation_state/);
  assert.match(source, /source_last_modified_at = NULL/);
  const before = source.indexOf("const beforeGuildies = await guildieRosterState");
  const persisted = source.indexOf("const roster = await persistGuildRoster");
  const after = source.indexOf("const afterGuildies = await guildieRosterState");
  const transitions = source.indexOf("guildieRosterTransitions(beforeGuildies, afterGuildies)");
  assert.ok(before >= 0 && before < persisted && persisted < after && after < transitions);
  assert.match(source, /changedIdentityIds: persisted.guildieTransitions.map/);
});
