import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const candidates = readFileSync(new URL("../src/core/guild/manual-roster-character-candidates.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/guild-routes.ts", import.meta.url), "utf8");

test("candidate discovery uses canonical characters, not only observed guild roster", () => {
  assert.match(candidates, /FROM character_roster cr/);
  assert.match(candidates, /NOT EXISTS \(/);
  assert.match(candidates, /guild_declared_roster declared/);
  assert.match(candidates, /observedMember: row.observed_member/);
  assert.match(candidates, /controlled: row.controlled/);
});
test("candidate discovery requires global roster management authority", () => {
  assert.match(candidates, /canManageGuildRoster/);
  assert.match(routes, /"\/guild\/roster\/character-candidates"/);
  assert.match(routes, /authenticatedIdentity/);
});
