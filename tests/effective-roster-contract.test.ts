import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { effectiveGuildRosterSql } from "../src/core/guild/effective-roster.js";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("effective roster selects independent sources exclusively and never falls back during Manual initialization", () => {
  assert.match(effectiveGuildRosterSql, /management.mode = 'manual'/);
  assert.match(effectiveGuildRosterSql, /management.manual_initialized_at IS NOT NULL/);
  assert.match(effectiveGuildRosterSql, /JOIN guild_declared_roster declared/);
  assert.match(effectiveGuildRosterSql, /management.mode = 'blizzard_sync'/);
  assert.match(effectiveGuildRosterSql, /observed.currently_present = true/);
  assert.match(effectiveGuildRosterSql, /UNION ALL/);
});

test("membership, representation, attribution, and refresh transitions use effective roster", () => {
  for (const path of [
    "../src/core/guild/guild-characters.ts",
    "../src/core/guild/character-membership.ts",
    "../src/core/identity/main-character.ts",
    "../src/core/identity/guildie-attribution.ts",
    "../src/core/guild/guild-refresh.ts",
  ]) {
    const file = source(path);
    assert.ok(file.includes("effectiveGuildRosterSql"), path);
    assert.ok(file.includes("${effectiveGuildRosterSql}"), path);
  }
});

test("installation GM claim remains an independent Blizzard observation", () => {
  const binding = source("../src/core/installation/guild-binding.ts");
  assert.match(binding, /JOIN guild_roster gr/);
});
