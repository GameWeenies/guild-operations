import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const admin = readFileSync(new URL("../src/web/pages/admin.ts", import.meta.url), "utf8");
const members = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/web/render.ts", import.meta.url), "utf8");

test("Ranks uses the existing permission editor under Roster", () => {
  assert.match(admin, /app\.get\("\/admin\/roster\/ranks"/);
  assert.match(admin, /renderPermissionPolicies\(policies, canRename\)/);
  assert.match(admin, /admin-permissions\.js/);
  assert.match(admin, /renderDiscordContextSetting\("roles"/);
  assert.match(admin, /app\.get\("\/admin\/permissions".*redirect\("\/admin\/roster\/ranks"\)/);
});
test("Roster links connect Members and Ranks inside Guild Settings, not primary navigation", () => {
  assert.match(admin, /href: "\/admin\/roster\/members"/);
  assert.match(members, /href: "\/admin\/roster\/ranks"/);
  assert.doesNotMatch(shell, /label: "Ranks", href: "\/admin\/permissions"/);
  assert.match(shell, /label: "Roster", href: "\/admin\/roster\/members"/);
  assert.doesNotMatch(shell, /href="\/roster\/members"/);
});

const rankClient = readFileSync(new URL("../src/web/public/admin-permissions.js", import.meta.url), "utf8");
const rankStyles = readFileSync(new URL("../src/web/public/admin-permissions.css", import.meta.url), "utf8");
test("Ranks render independent collapsible cards without a second rank selector", () => {
  assert.match(admin, /<details id="rank-\$\{rank\.rankIndex\}" class="rank-workspace" data-rank-workspace>/);
  assert.match(admin, /<summary class="rank-workspace-heading">/);
  assert.match(admin, /class="rank-workspace-content"/);
  assert.doesNotMatch(admin, /data-rank-select=/);
  assert.doesNotMatch(rankClient, /rankSelectors|selectRank\(/);
  assert.match(rankClient, /requestedRank/);
  assert.match(rankStyles, /\.rank-workspace\[open\] > summary/);
  assert.match(admin, /data-rank-save disabled/);
});
