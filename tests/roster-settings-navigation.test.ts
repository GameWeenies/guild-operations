import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const render = readFileSync(new URL("../src/web/render.ts", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/web/pages/admin.ts", import.meta.url), "utf8");
const viewer = readFileSync(new URL("../src/web/viewer.ts", import.meta.url), "utf8");
const roster = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");

test("Roster is the second Guild Settings tab, not a public navigation destination", () => {
  assert.match(render, /label: "General", href: "\/admin\/general"[^]*label: "Roster", href: "\/admin\/roster\/members"[^]*label: "Appearance"/);
  assert.doesNotMatch(render, /href="\/roster\/members"/);
  assert.match(render, /pathname\.startsWith\("\/admin\/roster\/"\)/);
});

test("Roster pages share the settings shell and retain legacy redirects", () => {
  assert.match(roster, /for \(const section of \["members", "synchronization"\] as const\)/);
  assert.match(roster, /app\.get\(`\/admin\/roster\/\$\{section\}`/);
  assert.match(admin, /app\.get\("\/admin\/roster\/ranks"/);
  assert.match(roster, /app\.get\("\/roster\/members"[^\n]*redirect\("\/admin\/roster\/members"\)/);
  assert.match(admin, /app\.get\("\/roster\/ranks"[^\n]*redirect\("\/admin\/roster\/ranks"\)/);
  assert.match(roster, /renderGuildSettingsHeader\("Roster"/);
  assert.match(admin, /renderGuildSettingsHeader\("Roster"/);
});

test("Verified GM retains a Settings entrypoint before Manual initialization", () => {
  assert.match(viewer, /binding\?\.authorizationKind === "guild_master"/);
  assert.match(viewer, /administrationAvailable: administration\.available \|\| canRefreshGuild \|\| canInspectOperations \|\| bootstrap/);
});

test("Synchronization has its own roster section, not Members or General", () => {
  assert.match(roster, /section === "synchronization" \? renderPageSectionStack\(synchronization, observationControls, reconciliation, syncTransition\)/);
  assert.match(roster, /membersView\.initialized \? renderPageSectionStack\(membersTable, applicantReview\)/);
  assert.match(roster, /href="\/admin\/roster\/synchronization"/);
  assert.match(admin, /href="\/admin\/roster\/synchronization"/);
  assert.match(roster, /const synchronization =/);
  assert.match(roster, /renderGuildRefreshSchedule\(refreshSchedule\)/);
  assert.match(roster, /renderGuildRefreshOperation\(refreshStatus, canRefresh\)/);
  assert.match(roster, /scripts: \["roster\.js", "admin\.js"\]/);
  const general = admin.slice(admin.indexOf('app.get("/admin/general"'), admin.indexOf('app.get("/admin/appearance"'));
  assert.doesNotMatch(general, /Guild synchronization|renderGuildRefreshSchedule|renderGuildRefreshOperation/);
});
