import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const operation = readFileSync(new URL("../src/core/guild/roster-initialization-operation.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/guild-routes.ts", import.meta.url), "utf8");

test("initialization requires verified installation GM, independent of GO rank capabilities", () => {
  assert.match(operation, /authorizationKind !== "guild_master"/);
  assert.match(operation, /authorizedByIdentityId !== identityId/);
  assert.doesNotMatch(operation, /requireGuildCapability/);
});

test("commit verifies reviewed snapshot version and delegates to transaction-bound import", () => {
  assert.match(operation, /withTransaction\(async \(client\)/);
  assert.match(operation, /snapshotVersion\(members\) !== reviewedSnapshotVersion/);
  assert.match(operation, /initializeManualRosterFromReviewedSnapshot\(client, guildId, selectedCharacterRecordIds\)/);
});

test("routes reject unauthenticated callers, invalid payloads and stale previews", () => {
  assert.match(routes, /app\.get\("\/guild\/roster\/initialization"/);
  assert.match(routes, /app\.post<\{ Body:.*snapshot_version/);
  assert.match(routes, /roster_snapshot_changed/);
  assert.match(routes, /roster_initialization_forbidden/);
  assert.match(routes, /invalid_roster_initialization_request/);
});
