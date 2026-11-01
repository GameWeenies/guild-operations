# Roster implementation roadmap (temporary)

> **Temporary implementation coordination document.** Issue [#261](https://github.com/GameWeenies/guild-operations/issues/261) is the accepted product specification and decision record. This document orders the implementation; it is not permanent doctrine. **Delete this file in the final implementation PR after all completion gates pass.**

## Scope and constraints

Release blocker for v0.1.0: Blizzard guild roster observations can remain stale for months. Guild Operations must maintain a separate declared roster and choose the effective membership/rank source through a persisted management mode.

- **Manual (default):** GO-declared roster is effective; Blizzard refresh changes observations only. Operator reviews and imports initial Blizzard entries explicitly, can add missing characters, assigns ranks, manages membership and applicants, and reconciles inline discrepancies.
- **Blizzard Sync (opt-in):** Blizzard-observed roster is effective; roster table is read-only and shows snapshot freshness and an explicit stale-authority risk warning.
- The two rosters persist independently across mode switches. Switching modes does not implicitly copy or overwrite either dataset.
- **Roster → Members** owns membership, rank assignments, refresh, mode, discrepancies, applicants, and reconciliation. **Roster → Ranks** retains existing rank index, display name, Discord role binding, and capability policy, identical across modes. Preserve the existing Ranks implementation with only necessary navigation/visual tuning.
- GM-verified installation ownership and destination rebinding verification are separate from GO-delegated operational rank authority. No dependency on other GameWeenies services.
- Keep implementation focused on this release blocker. No speculative framework, unrelated features, or parallel task journal.

## Implementation sequence

Each numbered item is a focused PR targeting `main`, with tests for its own behavior and existing PR CI. Later phases may refine boundaries when actual implementation dependencies require it; record consequential deviations in #261.

### PR 1 — Persistence foundation
- Add a durable GO-declared character roster independent of existing Blizzard-observed `guild_roster`.
- Persist roster management mode (Manual default) and enough observation provenance to display acquisition time and available Blizzard Last-Modified metadata.
- Establish data integrity, rank-coordinate constraints, and migration behavior for existing installations.
- **Gate:** Both datasets coexist; refreshing observations cannot mutate declarations; migration is safe and repeatable.

### PR 2 — Initialization and rebinding lifecycle
- New installation begins in Manual mode with an **explicitly reviewed** import from the latest available Blizzard snapshot; absent characters can be added manually.
- Do not silently treat Blizzard as the effective fallback while Manual roster initialization is incomplete.
- Rebinding starts a fresh Manual roster and operational configuration for the destination guild; preserve prior guild historical records. Require destination GM verification.
- Keep the Blizzard GM claim/binding trust anchor independent of operational mode.
- **Gate:** Setup and rebinding are safe even with incomplete/stale Blizzard observations; no implicit authority restoration.

### PR 3 — Effective roster contract
- Centralize mode-selected membership/rank resolution; adapt `guildie()`, character membership, controlled member characters, main-character eligibility/representation, and capability checks.
- Audit direct `guild_roster` reads in identity attribution, participation, Raid/Raffle, and other consumers; retain explicit observed-roster queries only where observations are intended.
- Preserve shared rank definitions and capabilities. Never grant installation ownership merely from a GO-assigned rank.
- **Gate:** Backend permissions and character eligibility agree with the selected effective roster; removed Manual members lose operational access.

### PR 4 — Refresh and transition semantics
- Separate Blizzard observation changes from effective membership/rank transitions and semantic emissions.
- In Manual mode, refresh updates only observations and discrepancies, not effective roster authority or member-change emissions.
- In Blizzard Sync mode, successful refresh updates the effective roster and corresponding transitions.
- Review refresh observers and Discord reconciliation triggers so downstream effects match effective authority.
- **Gate:** A stale Blizzard refresh cannot reinstate revoked Manual privileges or produce false effective transitions.

### PR 5 — Manual roster operations
- Add authorized character membership add/remove, rank assignment, pending applicants, and approval operations against declared state.
- Reuse existing character and identity coordinates and rank configuration; preserve historical attribution.
- **Gate:** Changes are durable, permission-checked, auditable where appropriate, and work for characters missing from the Blizzard snapshot.

### PR 6 — Reconciliation and mode transitions
- Compare GO declarations with the latest Blizzard snapshot by membership and rank; surface exact field differences.
- Manual → Blizzard Sync: explicit risk confirmation; switch effective source without copying either roster.
- Blizzard Sync → Manual: minimal WinSCP-like preview of **differences only**, selected by default, with individual checkboxes and select/deselect all; no filters or duplicate roster management UI. Show snapshot freshness.
- Confirm applies selected changes to declarations and activates Manual atomically. Cancel changes nothing; unselected discrepancies remain. Recompute/reject preview if snapshot changes before save.
- **Gate:** No unintended roster mutation; transition is concurrency-safe; partial selections and no-difference cases behave correctly.

### PR 7 — Members and Ranks workspace integration
- Build Members table with `Character-Realm (level) | Rank | Actions` in Manual mode, placing discrepancy markers adjacent to disputed fields with contextual details.
- Blizzard Sync table shows `Character-Realm (level) | Rank` only, with no per-row actions/discrepancy controls. Shared refresh/schedule/mode controls remain available.
- Preserve existing Ranks configuration and Discord bindings with minor layout/navigation adjustments only.
- **Gate:** Both modes present accurate, actionable state and do not suggest authority they cannot enforce; mobile layout is usable.

### PR 8 — Release integration and permanent documentation
- Validate Discord rank role synchronization against effective rank, including removals and mode changes; verify Raid/Raffle participation and other roster-dependent consumers.
- Test installation, rebind, migration, incomplete snapshots, stale observations, privilege revocation, role changes, mode switching, concurrency, and operational failure paths.
- Reconcile `docs/doctrine/architecture.md`, `docs/doctrine/member-objects.md`, and relevant infrastructure/operator documentation with implemented semantics.
- Complete PR CI, development-image publishing as needed, and **separate runtime verification** on the actual deployment; CI does not prove deployment or runtime correctness.
- **Final gate:** Confirm all #261 acceptance criteria and documentation are satisfied; **delete this temporary file in the final implementation PR**. Close #261 only after that PR is merged and runtime evidence is reviewed.

## Delivery discipline

- Focused branches, understandable commits, PRs to `main`, existing CI, rebase-and-merge, branch cleanup.
- Do not enable a partially implemented Manual authority path before its access controls and lifecycle are safe.
- Inspect actual CI failures before fixing. Publishing and runtime validation are distinct checkpoints.
- When a genuine authority, destructive, or product-level ambiguity arises, resolve it explicitly rather than silently changing accepted design.
- This roadmap tracks dependencies, **not completion claims**. Implemented behavior and permanent doctrine take precedence once verified.
