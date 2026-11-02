import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../sql/094_roster_applications.sql", import.meta.url), "utf8");
const operation = readFileSync(new URL("../src/core/guild/roster-applications.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/guild-routes.ts", import.meta.url), "utf8");

test("pending applications are unique requests, not declared membership", () => {
  assert.match(migration, /CREATE TABLE guild_roster_applications/);
  assert.match(migration, /WHERE status = 'pending'/);
  assert.doesNotMatch(operation, /(?:INSERT INTO|UPDATE|DELETE FROM) guild_declared_roster/);
  assert.match(operation, /controlled_character_roster/);
  assert.match(operation, /currently_controlled = true/);
  assert.match(operation, /manual_initialized_at/);
});

test("applicants cannot review applications and review cannot grant membership", () => {
  assert.match(operation, /canManageGuildRoster\(actorIdentityId, guildId\)/);
  assert.match(operation, /status = 'rejected'/);
  assert.match(routes, /"\/guild\/roster\/applications"/);
  assert.match(routes, /"\/guild\/roster\/applications\/:applicationId\/reject"/);
  assert.match(routes, /authenticatedIdentity/);
});
