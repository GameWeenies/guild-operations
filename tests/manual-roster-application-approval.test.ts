import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const operation = readFileSync(new URL("../src/core/guild/manual-roster-operations.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/guild-routes.ts", import.meta.url), "utf8");

test("approval requires pending application and current character control", () => {
  assert.match(operation, /guild_roster_applications WHERE guild_id/);
  assert.match(operation, /status = 'pending' FOR UPDATE/);
  assert.match(operation, /application_character_not_controlled/);
  assert.match(operation, /application_not_pending/);
});
test("approval and membership change share a transaction and effective transition publication", () => {
  assert.match(operation, /UPDATE guild_roster_applications SET status = 'approved'/);
  assert.match(operation, /INSERT INTO guild_declared_roster/);
  assert.match(operation, /guildieRosterTransitions\(before, after\)/);
  assert.match(operation, /publishEmission\(client/);
  assert.match(routes, /applications\/:applicationId\/approve/);
  assert.match(routes, /canManageGuildRoster|pendingRosterApplications\(identity.identityId\)/);
});
