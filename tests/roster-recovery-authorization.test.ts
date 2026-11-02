import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const recovery = readFileSync(new URL("../src/core/guild/roster-recovery.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/core/installation/routes.ts", import.meta.url), "utf8");

test("recovery requires the original verified installation GM and fresh character control", () => {
  assert.match(recovery, /binding\.authorized_by_identity_id !== identityId/);
  assert.match(recovery, /binding\.authorization_kind !== "guild_master"/);
  assert.match(recovery, /control\.character_record_id = \$3/);
  assert.match(recovery, /sess\.created_at >= now\(\) - interval '5 minutes'/);
  assert.match(recovery, /control\.last_seen_at >= sess\.created_at/);
});

test("recovery preserves observations and declarations and only changes mode with pending approval", () => {
  assert.match(recovery, /hasDeclaredRosterAdministrator/);
  assert.match(recovery, /observedAdmin\.rowCount/);
  assert.match(recovery, /mode = 'manual'/);
  assert.match(recovery, /completed_at = now\(\), authorized_by_identity_id/);
  assert.doesNotMatch(recovery, /UPDATE guild_roster SET/);
  assert.doesNotMatch(recovery, /UPDATE guild_declared_roster SET/);
  assert.match(routes, /authorizeRosterRecovery\(identity\.identityId, token\)/);
});
