import type { GuildPresentation } from "../core/presentation/guild-presentation.js";
import type { AdministrationNavigationDestination } from "./admin-navigation.js";
import { assetUrl, type AssetName, type AssetRegistry } from "./assets.js";
import type { WebPresentationContributions } from "./presentation-contributions.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Shared header for the five Guild Settings destinations. */
export function renderGuildSettingsHeader(section: string, description: string): string {
  return `<div class="admin-page-header"><p class="eyebrow">Guild Settings</p><h1 id="page-title">${escapeHtml(section)}</h1><p class="lede">${escapeHtml(description)}</p></div>`;
}

export type WebViewerCharacter = {
  characterId: string;
  realmId: string;
  name: string;
  realmName: string | null;
  guildMember: boolean;
  rankIndex: number | null;
  rankDisplayName: string | null;
  level: number | null;
  className: string | null;
  raceName: string | null;
  activeSpecName: string | null;
  avatarUrl: string | null;
};

type WebViewerPresentation = {
  guildPresentation: GuildPresentation;
  presentationContributions: WebPresentationContributions;
  theme: "default" | "alliance" | "horde";
};

export type WebViewer =
  | ({ authenticated: false } & WebViewerPresentation)
  | ({
      authenticated: true;
      administrationAvailable: boolean;
      administrationDestinations: AdministrationNavigationDestination[];
      operationsAvailable: boolean;
      canConfigureGuildPresentation: boolean;
      identityLabel: string;
      identityDisplayName: string | null;
      identityProfileIconKey: string | null;
      identityProfileIconUrl: string | null;
      guildRankDisplayName: string | null;
      guildRankIndex: number | null;
      mainCharacter: {
        characterId: string;
        realmId: string;
        name: string;
        realmName: string | null;
        rankIndex: number | null;
        rankDisplayName: string | null;
        level: number | null;
        className: string | null;
        activeSpecName: string | null;
        avatarUrl: string | null;
      } | null;
      controlledCharacters: WebViewerCharacter[];
      characters: WebViewerCharacter[];
    } & WebViewerPresentation);

export type SecondaryNavigation =
  | { kind: "back"; label: string; href: string }
  | { kind: "breadcrumb"; items: readonly { label: string; href?: string }[] };

export type RenderPageInput = {
  pathname: string;
  title: string;
  description?: string;
  header: string;
  body: string;
  viewer: WebViewer;
  secondaryNavigation?: SecondaryNavigation;
  stylesheets?: AssetName[];
  scripts?: AssetName[];
};

function userGlyph(): string {
  return `<svg class="account-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="4"></circle>
    <path d="M4.8 20c.8-4 3.2-6 7.2-6s6.4 2 7.2 6"></path>
  </svg>`;
}

function renderMeControl(viewer: WebViewer, pathname: string): string {
  if (!viewer.authenticated) {
    return `<a class="me-control" href="/auth/blizzard/start?return_to=${encodeURIComponent(pathname)}" aria-label="Sign in"><span>Sign in</span><span class="account-visual account-visual-generic">${userGlyph()}</span></a>`;
  }
  const moduleSections = viewer.presentationContributions.meMenuSections.map((render) => render(pathname)).join("\n");
  const guildStanding = viewer.guildRankIndex !== null
    ? `<span class="me-identity-standing">${escapeHtml(viewer.guildRankDisplayName ? `${viewer.guildRankDisplayName} · Rank ${viewer.guildRankIndex}` : `Rank ${viewer.guildRankIndex}`)}</span>`
    : "";
  return `<details class="me-menu menu-surface">
    <summary class="me-control"><span data-me-label>${escapeHtml(viewer.identityLabel)}</span><span class="account-visual ${viewer.identityProfileIconUrl ? "account-visual-portrait" : "account-visual-generic"}" data-me-visual>${viewer.identityProfileIconUrl ? `<img src="${escapeHtml(viewer.identityProfileIconUrl)}" alt="" referrerpolicy="no-referrer">` : userGlyph()}</span></summary>
    <div class="menu-panel menu-panel-right me-menu-panel">
      <section class="me-menu-section me-identity-section">
        <span class="me-identity-name">${escapeHtml(viewer.identityLabel)}</span>
        ${guildStanding}
      </section>
      <section class="me-menu-section me-self-service-links"><a href="/me"><span>Settings</span><span aria-hidden="true">→</span></a><a href="/me/participation"><span>My Participation</span><span aria-hidden="true">→</span></a></section>
      ${moduleSections}
      <section class="me-menu-section me-session-section"><button type="button" class="session-sign-out-action" data-logout>Sign out</button></section>
    </div>
  </details>`;
}
function characterMeta(character: WebViewerCharacter): string {
  const identity: string[] = [];
  if (character.level !== null) identity.push(`Level ${character.level}`);
  if (character.activeSpecName && character.className) identity.push(`${character.activeSpecName} ${character.className}`);
  else if (character.className) identity.push(character.className);
  else if (character.raceName) identity.push(character.raceName);
  return identity.length ? identity.join(" · ") : "Character profile not enriched yet";
}

function renderMainPicker(viewer: WebViewer): string {
  if (!viewer.authenticated) return "";
  const characters = viewer.characters.map((character) => {
    const selected = viewer.mainCharacter !== null && viewer.mainCharacter.realmId === character.realmId && viewer.mainCharacter.characterId === character.characterId;
    const portrait = character.avatarUrl ? `<img src="${escapeHtml(character.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="character-portrait-placeholder" aria-hidden="true">${userGlyph()}</span>`;
    const location = character.realmName ?? `Realm ${character.realmId}`;
    const role = character.activeSpecName && character.className ? `${character.activeSpecName} ${character.className}` : character.className ?? character.activeSpecName ?? "Character";
    return `<button type="button" class="character-choice${selected ? " character-choice-current" : ""}" data-select-main data-character-id="${escapeHtml(character.characterId)}" data-realm-id="${escapeHtml(character.realmId)}" data-character-name="${escapeHtml(character.name)}" data-character-role="${escapeHtml(role)}" data-character-realm="${escapeHtml(location)}" data-character-rank="${character.rankIndex}" data-avatar-url="${escapeHtml(character.avatarUrl ?? "")}">
      <span class="character-portrait">${portrait}</span><span class="character-choice-copy"><span class="character-choice-name">${escapeHtml(character.name)}${selected ? ' <span class="current-main-label">Current default</span>' : ""}</span><span class="character-choice-meta">${escapeHtml(characterMeta(character))}</span><span class="character-choice-submeta">${escapeHtml(location)} · ${escapeHtml(character.rankDisplayName ? `${character.rankDisplayName} · Rank ${character.rankIndex}` : `Rank ${character.rankIndex}`)}</span></span>
    </button>`;
  }).join("\n");
  return `<dialog class="main-picker" data-main-picker data-has-main="${viewer.mainCharacter ? "true" : "false"}" aria-labelledby="main-picker-title">
    <div class="main-picker-sheet">
      <div class="main-picker-heading"><h2 id="main-picker-title">Default Character</h2><button type="button" class="dialog-close" data-close-main-picker aria-label="Close default Character selection">×</button></div>
      
      <section class="main-picker-section main-picker-section-main" aria-labelledby="main-character-title"><h3 id="main-character-title">Default Character</h3><p class="main-picker-section-copy">Choose the Character Guild Operations should use when Character context is needed and you have not chosen one specifically.</p><div class="character-choices" data-character-choices>${characters || '<p class="main-picker-empty">No currently eligible guild characters were found.</p>'}</div></section>
      <p class="main-picker-status" data-main-picker-status aria-live="polite"></p>
    </div>
  </dialog>`;
}

function renderUtilityBar(viewer: WebViewer, pathname: string): string {
  if (!viewer.authenticated) return "";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return `<nav class="utility-bar" aria-label="Application area"><div class="utility-bar-inner"><a class="utility-dimension-swap" href="/">← Return to ${escapeHtml(viewer.guildPresentation.guildName)}</a></div></nav>`;
  }
  if (!viewer.administrationAvailable) return "";
  const orientation = viewer.guildPresentation.guildSettingsLocationAcknowledged
    ? `Guild Settings <span aria-hidden="true">⚙</span>`
    : `<span class="utility-orientation-prompt">Start here <span class="utility-orientation-arrow" aria-hidden="true">→</span></span> Guild Settings <span aria-hidden="true">⚙</span>`;
  const orientationClass = viewer.guildPresentation.guildSettingsLocationAcknowledged ? "" : " utility-dimension-swap-orientation";
  return `<nav class="utility-bar" aria-label="Application area"><div class="utility-bar-inner"><a class="utility-dimension-swap${orientationClass}" href="/admin">${orientation}</a></div></nav>`;
}

function renderActionBar(viewer: WebViewer, pathname: string): string {
  const administration = pathname === "/admin" || pathname.startsWith("/admin/");
  if (administration) {
    const discordAdministrationAvailable = viewer.authenticated
      ? viewer.administrationDestinations.some((destination) => destination.href === "/admin/discord")
      : false;
    const destinations = [
      { label: "General", href: "/admin/general" },
      { label: "Appearance", href: "/admin/appearance" },
      { label: "Ranks", href: "/admin/permissions" },
      ...(discordAdministrationAvailable ? [{ label: "Discord", href: "/admin/discord" }] : []),
      { label: "Plugins", href: "/admin/modules" },
    ];
    const links = destinations.map((destination) => {
      const active = pathname === destination.href ? ' aria-current="page"' : "";
      return `<a href="${destination.href}"${active}>${destination.label}</a>`;
    }).join("");
    return `<nav class="action-bar" aria-label="Settings navigation"><div class="action-bar-inner">
      <details class="mobile-nav menu-surface"><summary class="icon-control" aria-label="Open navigation"><span></span><span></span><span></span></summary><div class="menu-panel menu-panel-left mobile-nav-panel">${links}</div></details>
      <div class="desktop-nav">${links}</div>
    </div></nav>`;
  }

  const rosterActive = pathname === "/roster" || pathname.startsWith("/roster/") ? ` aria-current="page"` : "";
  const homeActive = pathname === "/" ? ' aria-current="page"' : "";
  const calendarActive = pathname === "/calendar" ? ' aria-current="page"' : "";
  const activitiesActive = pathname === "/activities" || pathname.startsWith("/activities/") ? ' aria-current="page"' : "";
  const articlesActive = pathname === "/articles" || pathname.startsWith("/articles/") ? ' aria-current="page"' : "";
  return `<nav class="action-bar" aria-label="Primary navigation"><div class="action-bar-inner">
    <details class="mobile-nav menu-surface"><summary class="icon-control" aria-label="Open navigation"><span></span><span></span><span></span></summary><div class="menu-panel menu-panel-left mobile-nav-panel"><a href="/"${homeActive}>Home</a><a href="/calendar"${calendarActive}>Calendar</a><a href="/activities"${activitiesActive}>Activities</a><a href="/articles"${articlesActive}>Articles</a><a href="/roster/members"${rosterActive}>Roster</a></div></details>
    <div class="desktop-nav"><a href="/"${homeActive}>Home</a><a href="/calendar"${calendarActive}>Calendar</a><a href="/activities"${activitiesActive}>Activities</a><a href="/articles"${articlesActive}>Articles</a><a href="/roster/members"${rosterActive}>Roster</a></div><div class="action-bar-spacer"></div>${renderMeControl(viewer, pathname)}
  </div></nav>`;
}

function renderSecondaryNavigation(navigation: SecondaryNavigation | undefined): string {
  if (!navigation) return "";
  if (navigation.kind === "back") return `<nav class="secondary-navigation secondary-navigation-back" aria-label="Secondary navigation"><a href="${escapeHtml(navigation.href)}">← ${escapeHtml(navigation.label)}</a></nav>`;
  if (navigation.items.length === 0) return "";
  const items = navigation.items.map((item, index) => {
    const terminal = index === navigation.items.length - 1;
    const label = escapeHtml(item.label);
    const content = item.href && !terminal ? `<a href="${escapeHtml(item.href)}">${label}</a>` : `<span${terminal ? ' aria-current="page"' : ""}>${label}</span>`;
    return `${index > 0 ? '<span class="secondary-navigation-separator" aria-hidden="true">›</span>' : ""}${content}`;
  }).join("");
  return `<nav class="secondary-navigation secondary-navigation-breadcrumb" aria-label="Breadcrumb">${items}</nav>`;
}

function externalFooterLink(url: string | null, label: string): string {
  if (!url) return "";
  return `<a class="footer-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function renderFooter(viewer: WebViewer): string {
  const communityLinks = viewer.presentationContributions.footerCommunityLinks.join("");
  const presentation = viewer.guildPresentation;
  const wowLinks = [externalFooterLink(presentation.wowArmoryUrl, "WoW Armory"), externalFooterLink(presentation.raiderIoUrl, "Raider.IO"), externalFooterLink(presentation.warcraftLogsUrl, "Warcraft Logs")].filter(Boolean).join("");
  return `<footer class="app-footer"><div class="app-footer-inner">
    <div class="footer-brand"><span class="footer-guild-name">${escapeHtml(presentation.guildName)}</span><span class="footer-guild-context">${escapeHtml([presentation.realmName, presentation.region].filter(Boolean).join(" · "))}</span></div>
    <div class="footer-destinations">
      ${communityLinks ? `<section class="footer-group" aria-label="Guild community"><p class="footer-group-title">Join us</p><div class="footer-links">${communityLinks}</div></section>` : ""}
      ${wowLinks ? `<section class="footer-group" aria-label="Guild links"><p class="footer-group-title">Find us in Azeroth</p><div class="footer-links">${wowLinks}</div></section>` : ""}
    </div>
    <nav class="footer-site-information" aria-label="Site information"><a href="/privacy">Privacy</a><span aria-hidden="true">·</span><a href="/terms">Terms</a></nav>
  </div></footer>`;
}

export type PublicOccurrenceAction = { label: string; href: string; kind?: "primary" | "secondary" };
export type PublicOccurrenceFrame = {
  title: string;
  state: string;
  active?: boolean;
  description?: string;
  facts: string;
  actions?: readonly PublicOccurrenceAction[];
  detail?: string;
};

export function renderPublicOccurrence(input: PublicOccurrenceFrame): string {
  const actions = (input.actions ?? []).map((action) => `<a class="button-${action.kind ?? "secondary"}" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`).join("");
  return `<article class="public-occurrence"><header class="public-occurrence-header"><div class="public-occurrence-identity"><h1>${escapeHtml(input.title)}</h1><p class="status${input.active ? " status-active" : ""}">${escapeHtml(input.state)}</p>${input.description ? `<div class="public-occurrence-description">${input.description}</div>` : ""}</div></header><div class="public-occurrence-facts facts">${input.facts}</div>${actions ? `<nav class="public-occurrence-actions" aria-label="Occurrence actions">${actions}</nav>` : ""}${input.detail ? `<div class="public-occurrence-detail">${input.detail}</div>` : ""}</article>`;
}

export type OccurrenceParticipationFrame = {
  activity: string;
  title: string;
  context?: string;
  existingParticipation?: string;
  intake: string;
};

export function renderOccurrenceParticipation(input: OccurrenceParticipationFrame): string {
  return `<section class="occurrence-participation-frame"><header class="occurrence-participation-header"><p class="eyebrow">Activities · ${escapeHtml(input.activity)}</p><h1>Participation</h1><p class="occurrence-participation-title">${escapeHtml(input.title)}</p>${input.context ? `<div class="occurrence-participation-context">${input.context}</div>` : ""}</header>${input.existingParticipation ? `<div class="occurrence-participation-existing">${input.existingParticipation}</div>` : ""}<div class="occurrence-participation-intake">${input.intake}</div></section>`;
}

export type OccurrenceOperationsMode = { label: string; href: string; current?: boolean };
export type OccurrenceOperationsFrame = {
  title: string;
  context: string;
  publicAction?: { label: string; href: string };
  modes: readonly OccurrenceOperationsMode[];
  lifecycleActions?: string;
  workspace: string;
};

export function renderOccurrenceOperations(input: OccurrenceOperationsFrame): string {
  const publicAction = input.publicAction ? `<a class="button-secondary" href="${escapeHtml(input.publicAction.href)}">${escapeHtml(input.publicAction.label)} ↗</a>` : "";
  const modes = input.modes.map((mode) => `<a class="${mode.current ? "button-primary" : "button-secondary"}" href="${escapeHtml(mode.href)}"${mode.current ? ' aria-current="page"' : ""}>${escapeHtml(mode.label)}</a>`).join("");
  const lifecycleActions = input.lifecycleActions ?? "";
  return `<section class="occurrence-operations-frame"><header class="occurrence-operations-header"><div class="occurrence-operations-identity"><h1>${escapeHtml(input.title)}</h1><p>${input.context}</p></div>${publicAction ? `<div class="occurrence-operations-public-action">${publicAction}</div>` : ""}</header>${modes || lifecycleActions ? `<div class="occurrence-operations-toolbar">${modes ? `<nav class="occurrence-operations-modes" aria-label="Operational mode">${modes}</nav>` : ""}${lifecycleActions ? `<div class="occurrence-operations-lifecycle" aria-label="Lifecycle actions">${lifecycleActions}</div>` : ""}</div>` : ""}<div class="occurrence-operations-workspace">${input.workspace}</div></section>`;
}

export function renderPage(assets: AssetRegistry, input: RenderPageInput): string {
  const theme = input.viewer.theme;
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description ?? input.viewer.guildPresentation.guildName);
  const canonicalUrl = input.pathname;
  const stylesheets = (input.stylesheets ?? []).map((name) => `  <link rel="stylesheet" href="${assetUrl(assets, name)}">`).join("\n");
  const scripts = (input.scripts ?? []).map((name) => `  <script src="${assetUrl(assets, name)}" defer></script>`).join("\n");
  const utilityBar = renderUtilityBar(input.viewer, input.pathname);
  const secondaryNavigation = renderSecondaryNavigation(input.secondaryNavigation);
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="stylesheet" href="${assetUrl(assets, "app.css")}">
  <link rel="stylesheet" href="${assetUrl(assets, "footer.css")}">
  <link rel="stylesheet" href="${assetUrl(assets, "me.css")}">
  <link rel="stylesheet" href="${assetUrl(assets, "navigation-shelves.css")}">
${stylesheets ? `${stylesheets}\n` : ""}  <title>${title}</title>
</head>
<body>
  <div class="app-shell">
    ${utilityBar}
    ${renderActionBar(input.viewer, input.pathname)}
    ${secondaryNavigation ? `<div class="secondary-navigation-zone">${secondaryNavigation}</div>` : ""}
    <header class="page-header${secondaryNavigation ? " page-header-after-secondary-navigation" : ""}">${input.header}</header>
    <main class="app-main">${input.body}</main>
    ${renderFooter(input.viewer)}
  </div>
  ${renderMainPicker(input.viewer)}
  <script src="${assetUrl(assets, "app.js")}" defer></script>
  <script src="${assetUrl(assets, "navigation-shelves.js")}" defer></script>
${scripts ? `${scripts}\n` : ""}</body>
</html>`;
}

export function htmlText(value: string): string { return escapeHtml(value); }
