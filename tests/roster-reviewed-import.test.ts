import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { initializeManualRosterFromReviewedSnapshot } from "../src/core/guild/roster-reviewed-import.js";

function clientFor(rows: Array<{ character_record_id: string; rank_index: number }>, mode = "manual", initialized: Date | null = null) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = { query: async (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    if (sql.includes("FROM guild_roster_management")) return { rows: [{ mode, manual_initialized_at: initialized }] };
    if (sql.includes("FROM guild_roster\n")) return { rows };
    return { rows: [], rowCount: 1 };
  } } as unknown as PoolClient;
  return { client, queries };
}

test("reviewed selection copies only selected observed ranks and marks initialization", async () => {
  const { client, queries } = clientFor([
    { character_record_id: "a", rank_index: 1 },
    { character_record_id: "b", rank_index: 3 },
  ]);
  assert.equal(await initializeManualRosterFromReviewedSnapshot(client, "guild", ["b"]), 1);
  const insert = queries.find((q) => q.sql.includes("INSERT INTO guild_declared_roster"));
  assert.deepEqual(insert?.params, ["guild", "b", 3]);
  assert.equal(queries.filter((q) => q.sql.includes("INSERT INTO guild_declared_roster")).length, 1);
  assert.ok(queries.some((q) => q.sql.includes("SET manual_initialized_at = now()")));
});

test("rejects non-observed and duplicate selections before writing declarations", async () => {
  const { client, queries } = clientFor([{ character_record_id: "a", rank_index: 1 }]);
  await assert.rejects(initializeManualRosterFromReviewedSnapshot(client, "guild", ["missing"]));
  assert.ok(!queries.some((q) => q.sql.includes("INSERT INTO guild_declared_roster")));
  await assert.rejects(initializeManualRosterFromReviewedSnapshot(client, "guild", ["a", "a"]));
});

test("rejects repeat initialization and non-Manual mode", async () => {
  for (const [mode, initialized] of [["manual", new Date()], ["blizzard_sync", null]] as const) {
    const { client } = clientFor([], mode, initialized);
    await assert.rejects(initializeManualRosterFromReviewedSnapshot(client, "guild", []));
  }
});
