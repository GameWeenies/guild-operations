import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/core/guild/roster-mode-transitions.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/guild-routes.ts", import.meta.url), "utf8");

test("mode switch requires explicit risk acknowledgment and global roster authority", () => {
  assert.match(source, /acknowledged !== true/);
  assert.match(source, /canManageGuildRoster/);
  assert.match(routes, /acknowledge_stale_roster_risk !== true/);
});
test("switch preserves declared roster and emits effective transitions", () => {
  assert.match(source, /blizzard_snapshot_missing/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /SET mode = 'blizzard_sync'/);
  assert.doesNotMatch(source, /DELETE FROM guild_declared_roster|UPDATE guild_declared_roster/);
  assert.match(source, /guildieRosterTransitions\(before, after\)/);
  assert.match(source, /publishEmission\(client/);
  assert.match(source, /deliverEmission/);
});
