import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const check = read("../src/core/guild/manual-admin-continuity.ts");
const manual = read("../src/core/guild/manual-roster-operations.ts");
const transition = read("../src/core/guild/roster-mode-transitions.ts");

test("administrator continuity requires a currently controlled declared rank-zero character", () => {
  assert.match(check, /guild_declared_roster/);
  assert.match(check, /currently_controlled = true/);
  assert.match(check, /declared.rank_index = 0/);
});

test("Manual mutations reject removal or demotion of the last administrator inside transaction", () => {
  assert.match(manual, /hasDeclaredRosterAdministrator\(client, binding.guildId\)/);
  assert.match(manual, /last_roster_administrator_required/);
  assert.ok(manual.indexOf("hasDeclaredRosterAdministrator(client, binding.guildId)") < manual.indexOf("guildieRosterTransitions(before, after)"));
});

test("Blizzard Sync to Manual transition rejects a resulting roster without an administrator", () => {
  assert.match(transition, /hasDeclaredRosterAdministrator\(client, guildId\)/);
  assert.match(transition, /last_roster_administrator_required/);
  assert.ok(transition.indexOf("hasDeclaredRosterAdministrator(client, guildId)") < transition.indexOf("mode = 'manual'"));
});
