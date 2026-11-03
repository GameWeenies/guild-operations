import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { renderActionRow, renderFormLayout, renderPanel } from "../src/web/render.js";

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

const discordStyles = readFileSync(new URL("../src/web/public/discord-admin.css", import.meta.url), "utf8");


test("renderer composes form groups and action rows", () => {
  assert.equal(renderFormLayout("<label>Enabled</label>", "", renderActionRow("<button>Save</button>")), '<div class="form-layout"><label>Enabled</label><div class="form-action-row"><button>Save</button></div></div>');
});

test("Discord integration uses shared form spacing instead of a feature exception", () => {
  assert.match(discordSource, /renderFormLayout\(/);
  assert.match(discordSource, /renderActionRow\(/);
  assert.doesNotMatch(discordStyles, /form\[action="\/admin\/discord"\] > \.button-primary/);
});

test("Discord emoji preview uses shared field and action spacing", () => {
  const preview = discordSource.slice(discordSource.indexOf('action="/admin/discord/emoji/preview"'), discordSource.indexOf(': "<p>No text channels are available for a preview.</p>"'));
  assert.match(preview, /renderFormLayout\(/);
  assert.match(preview, /renderActionRow\(/);
  assert.match(preview, /name="channel_id" required/);
  assert.match(preview, /Send emoji preview/);
});
