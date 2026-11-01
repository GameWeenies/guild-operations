import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { ensureGuildRosterInitialization, resetDestinationGuildRoster } from "../src/core/guild/roster-initialization.js";

function recordingClient() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { client, queries };
}

test("first binding creates uninitialized Manual state without copying Blizzard roster", async () => {
  const { client, queries } = recordingClient();
  await ensureGuildRosterInitialization(client, "guild-1");
  assert.equal(queries.length, 1);
  assert.match(queries[0]!.sql, /VALUES \(\$1, 'manual', NULL\)/);
  assert.match(queries[0]!.sql, /ON CONFLICT \(guild_id\) DO NOTHING/);
  assert.deepEqual(queries[0]!.params, ["guild-1"]);
});

test("rebinding clears destination declarations and resets reviewed state", async () => {
  const { client, queries } = recordingClient();
  await resetDestinationGuildRoster(client, "guild-2");
  assert.equal(queries.length, 2);
  assert.match(queries[0]!.sql, /^DELETE FROM guild_declared_roster WHERE guild_id = \$1$/);
  assert.match(queries[1]!.sql, /mode = 'manual', manual_initialized_at = NULL/);
  assert.deepEqual(queries.map((q) => q.params), [["guild-2"], ["guild-2"]]);
  assert.ok(queries.every((q) => !/DELETE FROM (guild_roster|character_roster|controlled_character_roster)/.test(q.sql)));
});
