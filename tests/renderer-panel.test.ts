import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPanel } from "../src/web/render.js";

test("renderer owns shared panel boundary and preserves feature content", () => {
  assert.equal(renderPanel("<p>Content</p>"), '<div class="settings-panel"><p>Content</p></div>');
  assert.equal(
    renderPanel("<button>Save</button>", { element: "article", className: "feature-panel compact" }),
    '<article class="settings-panel feature-panel compact"><button>Save</button></article>',
  );
});
