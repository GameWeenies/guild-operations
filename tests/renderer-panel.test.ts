import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { renderPanel } from "../src/web/render.js";

test("renderer owns shared panel boundary and preserves feature content", () => {
  assert.equal(renderPanel("<p>Content</p>"), '<div class="settings-panel"><p>Content</p></div>');
  assert.equal(
    renderPanel("<button>Save</button>", { element: "article", className: "feature-panel compact" }),
    '<article class="settings-panel feature-panel compact"><button>Save</button></article>',
  );
});

const discordSource = readFileSync(new URL("../src/web/pages/discord-admin.ts", import.meta.url), "utf8");
const rosterSource = readFileSync(new URL("../src/web/pages/roster-members.ts", import.meta.url), "utf8");

test("Discord settings panels use renderer-owned boundaries", () => {
  assert.match(discordSource, /renderAdminSectionStack\(/);
  assert.equal((discordSource.match(/renderPanel\(/g) ?? []).length, 2);
  assert.doesNotMatch(discordSource, /class="settings-panel"/);
  assert.doesNotMatch(discordSource, /class="admin-sections"/);
});

test("Roster synchronization panel uses the renderer without losing its layout class", () => {
  assert.match(rosterSource, /renderPanel\(/);
  assert.match(rosterSource, /className: "guild-synchronization-settings"/);
  assert.doesNotMatch(rosterSource, /class="settings-panel guild-synchronization-settings"/);
});
