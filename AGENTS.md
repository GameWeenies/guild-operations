# AGENTS.md

## Project

This repository contains Guild Operations, a self-hosted application for World of Warcraft guilds. One deployment represents one guild.

Guild Operations is the guild's interactive participation and operation layer outside World of Warcraft. WoW remains the authoritative game domain; this system extends guild activity into places and times where the game client is not available or appropriate.

## Scope boundary

This is not a generic identity platform, an Armory replacement, or a universal community platform. It is a World of Warcraft guild operations product.

- World of Warcraft is the native account/Character authority domain.
- A GO-recognized WoW Account identity is the canonical domain identity; Blizzard authentication establishes account control.
- Characters are controlled context beneath WoW Account identity.
- Guildie is a derived identity attribute, not a separate durable identity or member object.
- `Subject` is contextual language for an already-existing object in relation; it is not a domain object or persistence coordinate.
- Discord identities may act independently where procedure permits, or associate directly to a GO-recognized WoW Account identity.
- Character presentation should favor recognition cues needed for guild participation rather than profile completeness.
- Do not introduce generic provider/platform abstractions unless the repository develops a concrete need for them.

A useful product test is whether a capability helps establish authority to participate, enable guild participation, operate that participation, or preserve its history.

## Architectural invariants

- The backend owns authoritative operational state.
- Interfaces are projections and interaction surfaces, not independent sources of operational truth.
- Discord identity must not create a canonical WoW Account identity or fabricate WoW-backed authority.
- Changing Discord associations or selected character representation must not create a new WoW Account identity or rewrite historical attribution.
- Blizzard owns current Blizzard facts such as account control, guild Character membership, and numeric guild rank.
- Guild Operations owns the meaning and presentation it assigns to those facts outside WoW, including rank-derived application capabilities.
- Persist actual domain objects and relationship roles (identity and Character coordinates, `round_id`, etc.); do not introduce generic `subject_id` persistence.
- Human guild judgments remain human judgments. Code may enforce permissions, required inputs, and valid transitions, but must not manufacture authority unavailable from the actual source.
- Guild Operations preserves, enables, and enriches community participation; it does not replace the community processes that give participation meaning.

## Recognition surfaces

Member-facing recognition should be concise and operationally relevant.

The strongest default cues are:

- character name;
- class / active specialization;
- realm; and
- current guild rank.

Facts such as race, level, item level, achievements, and similar profile information are incidental unless a concrete workflow requires them.

When a known semantic fact is likely to gain richer presentation later, prepare a narrow presentation seam rather than implementing speculative styling or policy.

## Development approach

Keep changes small, direct, and domain-specific.

- Do not create numbered task documents.
- Do not create development journals.
- Avoid speculative abstractions and infrastructure.
- Prefer explicit Guildie/Character/WoW/Discord semantics over generalized identity machinery.
- Preserve durable architectural decisions in `docs/doctrine/architecture.md` when a change materially affects later work.
- Do not assume Blizzard API behavior. Verify current contracts before implementing authority-bearing behavior.
- Prefer concrete participation features over additional foundational modeling when the existing model is sufficient.
- Let shared event, notification, audit, participation, or interface abstractions emerge from demonstrated overlap between real features rather than designing them in isolation.

## Current objective

The immediate release objective is v0.1.0. Prioritize coherent installation, operation, correctness, and release blockers. A GO-managed roster and authority model with Blizzard reconciliation is an accepted direction, not yet reconciled with the existing Blizzard-authority doctrine. Inspect current implementation and doctrine before treating that direction as implemented.
