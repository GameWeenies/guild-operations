import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const admin = readFileSync(new URL("../src/web/pages/admin.ts", import.meta.url), "utf8");
const members = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/web/render.ts", import.meta.url), "utf8");

test("Ranks uses the existing permission editor under Roster", () => {
  assert.match(admin, /app\.get\("\/roster\/ranks"/);
  assert.match(admin, /renderPermissionPolicies\(policies, canRename\)/);
  assert.match(admin, /admin-permissions\.js/);
  assert.match(admin, /renderDiscordContextSetting\("roles"/);
  assert.match(admin, /app\.get\("\/admin\/permissions".*redirect\("\/roster\/ranks"\)/);
});
test("Roster links connect Members and Ranks without replacing primary navigation", () => {
  assert.match(admin, /href="\/roster\/members"/);
  assert.match(members, /href="\/roster\/ranks"/);
  assert.doesNotMatch(shell, /label: "Ranks", href: "\/admin\/permissions"/);
  assert.match(shell, /href="\/roster\/members"/);
});
