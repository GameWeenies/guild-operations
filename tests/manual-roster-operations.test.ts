import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validCharacterRecordId, validRosterRank } from "../src/core/guild/manual-roster-operations.js";

const operation = readFileSync(new URL("../src/core/guild/manual-roster-operations.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/guild-routes.ts", import.meta.url), "utf8");

test("Manual roster accepts only bounded rank coordinates and character UUIDs", () => {
  for (const rank of [-1, 10, 1.5, "1", null]) assert.equal(validRosterRank(rank), false);
  for (const rank of [0, 1, 9]) assert.equal(validRosterRank(rank), true);
  assert.equal(validCharacterRecordId("123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(validCharacterRecordId("not-a-uuid"), false);
});

test("Manual operations require authorization and initialized Manual mode", () => {
  assert.match(operation, /canAdministerGuildPermissions/);
  assert.match(operation, /manual_initialized_at/);
  assert.match(operation, /mode !== "manual"/);
  assert.match(operation, /FOR UPDATE/);
});

test("Member mutations target only declared roster, not Blizzard observations", () => {
  assert.match(operation, /INSERT INTO guild_declared_roster/);
  assert.match(operation, /DELETE FROM guild_declared_roster/);
  assert.match(operation, /UPDATE guild_declared_roster/);
  assert.doesNotMatch(operation, /(?:INSERT INTO|DELETE FROM|UPDATE) guild_roster\b/);
  assert.match(operation, /member_already_declared/);
  assert.match(operation, /member_not_declared/);
});

test("Member API validates inputs and requires an authenticated session", () => {
  assert.match(routes, /"\/guild\/roster\/members"/);
  assert.match(routes, /authenticatedIdentity\(request.cookies\[SESSION_COOKIE_NAME\]\)/);
  assert.match(routes, /validCharacterRecordId\(characterId\)/);
  assert.match(routes, /validRosterRank\(rankIndex\)/);
});
