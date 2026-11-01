import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const refresh = readFileSync(new URL("../src/core/guild/guild-refresh.ts", import.meta.url), "utf8");
const initialization = readFileSync(new URL("../src/core/guild/roster-initialization-operation.ts", import.meta.url), "utf8");

test("refresh and initialization lock the same guild row before touching observed roster", () => {
  const lock = 'SELECT guild_id FROM guilds WHERE guild_id = $1 FOR UPDATE';
  const refreshStart = refresh.indexOf("const persisted = await withTransaction(async (client)");
  const refreshLock = refresh.indexOf(lock, refreshStart);
  const refreshWrite = refresh.indexOf("await persistGuildRoster(client", refreshStart);
  assert.ok(refreshStart >= 0 && refreshLock > refreshStart && refreshWrite > refreshLock);
  const initStart = initialization.indexOf("return withTransaction(async (client)");
  const initLock = initialization.indexOf(lock, initStart);
  const initCheck = initialization.indexOf("snapshotVersion(members) !== reviewedSnapshotVersion", initStart);
  const initImport = initialization.indexOf("initializeManualRosterFromReviewedSnapshot(client", initStart);
  assert.ok(initStart >= 0 && initLock > initStart && initCheck > initLock && initImport > initCheck);
});
