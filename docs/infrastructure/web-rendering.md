# Web Rendering Infrastructure

Guild Operations' web layer owns presentation composition and delivery. Routes assemble presentation-ready values; rendering code does not query the database, make authority decisions, or manufacture backend truth.

## Application shell

The shared shell owns application-level presentation including:

- a compact utility bar for crossing between the member-facing and Administration dimensions;
- dimension-specific primary navigation;
- optional legacy administration navigation;
- optional secondary navigation;
- shared action surfaces;
- responsive shell behavior;
- common page composition;
- persistent member context.

Authenticated member context is projected from the current recognized identity and its available guild context. Selected Character imagery may improve recognition but does not determine continuity or authorization.

## Shared controls

Standard interactive controls use the global presentation fallback unless a narrower semantic owner has a real reason to differ.

Current shared fallback covers ordinary buttons/button-like actions, text and number inputs, text areas, selects, focus/disabled states, and switch presentation for boolean enabled/disabled controls.

Presentation precedence is:

1. global shell fallback;
2. producer-scoped refinement or override;
3. rare inline exception.

Checkbox semantics remain distinct from switch semantics. A boolean enabled/disabled state may use switch presentation while retaining a native checkbox input; ordinary checkbox choices should not become switches merely because they share the input type.

## Authorization boundary

Rendering may express the result of an authorization decision by showing, hiding, disabling, or labeling an interaction appropriately. It does not make or enforce that decision.

A missing or disabled control is presentation, not access control. Routes and procedures must still enforce required capabilities against backend authority through [`guild-permissioning.md`](guild-permissioning.md) or the appropriate module-owned authorization policy.

## Shell dimensions

Guild Operations has two navigation dimensions over the same application, authentication, presentation, and rendering foundations:

```text
Guild Operations
├── Application shell
│   ├── Home
│   ├── Events
│   └── persistent member context
│
└── Administration shell
    ├── General
    ├── Appearance
    ├── Roster (Members, Synchronization, Ranks)
    ├── Discord (when available)
    └── Plugins
```

The member-facing Application shell is for participating in the guild. Its primary navigation owns ordinary application destinations, while **Me** remains persistent personal context and quick access. Guild-wide administration does not belong in Me.

The Administration shell exposes **Guild Settings**: controls for configuring Guild Operations behavior within the guild, subject to the capabilities granted to each viewer. `/admin` redirects to `/admin/general`. Its primary navigation groups settings by the application capability being configured:

- `/admin/general` for orientation and Article publication destination;
- `/admin/appearance` for theme, homepage composition, and guild presentation links;
- `/admin/roster/members` (**Roster**) for member management, with `/admin/roster/synchronization` for Blizzard observation and roster authority mode, and `/admin/roster/ranks` for rank display names, capability policy, and Discord role mappings;
- `/admin/discord` for Discord connection, server association, and integration utilities, when Discord administration is available;
- `/admin/modules` (**Plugins**) for activity enablement and Raid/Raffle publication destinations.

The legacy `/admin/homepage` GET redirects to Appearance. Existing configuration mutation endpoints retain their backend authorization requirements. In particular, Discord role mapping requires Discord configuration authority independently of permission-policy administration authority.

Operational inspection remains available at `/admin/history` but is no longer a top-level Guild Settings destination. Host-owned installation, credentials, deployment, and recovery are outside Guild Settings.

Modules may gain administrative depth beneath the appropriate concern without each becoming a top-level shell destination.

### Utility bar

The utility bar is the explicit dimension swap. It answers one question: **where is the other operating dimension?**

- In the Application shell, authorized members receive **Guild Settings**.
- In the Administration shell, the bar returns to the named guild application.

Guild Settings also owns a durable, reversible orientation aid. Until the guild-level **I know where to find Guild Settings** state is checked, the Application shell emphasizes the Guild Settings destination with a **Start here** prompt. The control remains visible at the top of General Administration after acknowledgement so an authorized operator can deliberately turn the teaching aid back on for future administrators. Administrative viewers without configuration authority may inspect the state but cannot change it.

The utility bar is intentionally vertically compact and is not a general-purpose shelf. Unrelated controls, status, and destinations belong to their semantic navigation or page owner.

Rendering may hide the Administration swap when the viewer has no administrative availability, but backend authorization remains authoritative.

## Legacy administration navigation

The shared renderer still supports the previous module administration destination selector for legacy `/admin/<module>` routes during migration.

Published destinations are filtered against backend authority before they reach rendering. The selector is a projection of authorized legacy destinations, not an authorization boundary of its own. Module routes must continue enforcing their own authority requirements.

Do not extend the legacy destination registration contract. New Administration behavior should target the appropriate Guild Settings destination according to [`../doctrine/module-conformity.md`](../doctrine/module-conformity.md), and privileged domain operations should remain with the domain being operated.

## Secondary navigation

Pages declare navigation intent; the shared renderer owns presentation.

Two relationships are supported:

```text
breadcrumb
    → durable application location

back
    → return destination from a focused interaction
```

For breadcrumbs, pages supply semantic hierarchy and navigable destinations where applicable. The renderer owns separators, current-location treatment, styling, placement, accessibility, and constrained-space behavior.

For back navigation, pages supply destination and label. The renderer owns visual and accessibility treatment.

Use the semantic distinction **location versus return from an interaction**, not URL shape alone.

## Rendering ownership

Use the broadest owner already earned:

1. global rendering for shared application language;
2. module rendering for reusable module-specific presentation;
3. inline rendering for genuinely exceptional one-off surfaces.

Navigation belongs to the shell. Page and module identity—titles, section labels, event states, and domain status treatments—belongs to the page/module.

Standard panel boundaries are renderer-owned through `renderPanel`; feature pages supply content and may select a semantic outer element or additional classes. Domain-specific internal layouts remain feature-owned. Existing panel markup should migrate incrementally without changing interactive form boundaries or replacing specialized interfaces. Discord integration and emoji settings, along with the Roster synchronization controls, now use this shared boundary. The shared panel contract supports semantic `form` elements and an allowlisted set of HTML attributes, preserving existing form submissions and `data-*` interaction selectors. Server-rendered Appearance, Plugins, and Roster panel boundaries now use the renderer. Client-created Homepage editor panels still use the same classes in browser JavaScript; their dynamic creation path requires a separate client-side presentation boundary rather than importing the server renderer.

Ordinary form group spacing and action alignment use `renderFormLayout` and `renderActionRow`, with responsive rules in shared `app.css`. Features retain their controls, form elements, submission semantics, and specialized layouts. The Discord integration settings and emoji preview forms are adopters; its former button-specific spacing rule has been removed.

Administrative section groups use the renderer-owned `renderAdminSectionStack` helper so sibling sections inherit the existing `admin-sections` spacing contract. Roster panels use `renderPageSectionStack`. Producers still own their headings and domain-specific content.

## Application origin

The externally visible application origin is host-owned configuration, supplied through `PUBLIC_ORIGIN` or `PUBLIC_ORIGIN_FILE`. Guild Operations does not infer it from request headers or persist a request-derived origin during first-run setup. The configured origin is used for OAuth callbacks and background projections that require absolute links.

Ordinary in-application navigation and asset URLs remain application-relative. The local process listen port is independent of the externally visible origin.

Configure the public scheme, host, and optional port explicitly on the host. Reverse-proxy routing must agree with that configuration; forwarded headers do not establish the canonical origin.

## Asset delivery

Shared web assets use content-derived addressing so changed content receives a new URL and unchanged content remains safely cacheable.

Rendered HTML remains revalidatable so current interface state is not made stale by long-lived document caching.

Implementation may evolve, but cache behavior must preserve the distinction between immutable versioned assets and current rendered application state.

## Growth rule

Promote shared rendering only after real application pressure demonstrates common interaction or presentation behavior. The goal is fallback uniformity, not a speculative component or design-system framework.

## Guild homepage presentation

The guild homepage is a Core-owned presentation surface. A guild may supply a small amount of durable informational content and choose among the presentation shapes Guild Operations explicitly supports. Core owns the resulting markup, responsive behavior, theme application, and visual coherence.

Homepage configuration is intentionally not a site builder or rich-content system. Current configurable content consists of an introduction followed by ordered Card and Statement presentation primitives. A Card has one title and one or more related text values. Text count expresses content only; Core owns their responsive composition. Statements remain independent ordered primitives.

Configured homepage text is plain text. It does not accept HTML, Markdown, arbitrary CSS, or plugin-rendered fragments.

Articles are a separate future content concern. If Articles are introduced, the homepage may project them without owning their authored content or lifecycle.


### Data tables

The renderer owns table containment through `renderTableFrame` and sortable header controls through `renderSortableColumnHeader`. Features own their row data, sort comparisons and actions. Wide tables remain horizontally scrollable inside their panel. Tables that opt into `compactRecords` switch to vertically stacked, labeled rows on narrow viewports; cells supply `data-label` and sortable headers remain visible as controls. Use real table markup and `aria-sort` on the active column rather than a separate sort dropdown. The Roster Members workspace is the first compact-record consumer. Other Roster review and reconciliation grids retain scrollable comparison tables, because their columns are meaningful together.
