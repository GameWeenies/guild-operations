# Guild Permissioning Infrastructure

This document describes the shared machinery that translates established Guildie authority into globally owned application capabilities.

The authority derivation itself is doctrine defined in [`../doctrine/member-objects.md`](../doctrine/member-objects.md).

## Input

The permission layer receives the operating `guildie_id` and current effective guild authority from backend truth. If the Guildie has no current participation surface, there is no rank-derived authority to translate. Selected main is never an authorization input.

Capabilities are derived at use time rather than embedded permanently in the Guildie or session.

## Rank definitions

`guild_rank_definitions` attaches Guild Operations metadata to numeric guild rank indexes shared by declared and observed rosters. `rank_index` remains the authority coordinate. Display names and other Guild Operations presentation are mutable metadata.

Guild roster synchronization may establish definitions for newly observed ranks without overwriting configured metadata. The available rank space must not be inferred only from ranks occupied in one roster observation.

## Capability contract

Capability keys are authoritative machine identifiers. They use stable dotted vocabulary such as `raid.create`. Human-readable labels, descriptions, and namespace labels are projection metadata only; changing that metadata does not change authority, persistence, or module consumption.

Global machinery and modules may register configurable capability definitions. A definition contributes the capability key and descriptive metadata only. It does not contribute Administration routes, HTML, CSS, controls, or rank-selector behavior.

The registration seam is intentionally application-facing rather than web-facing. The same capability-policy service can therefore support later application/API contracts without making the current Administration page authoritative for permission state.

## Global capability mapping

`guild_rank_capabilities` maps rank definitions to capabilities:

```text
current Guildie effective authority
        ↓
mode-selected effective numeric rank
        ↓
explicit capability grants
        ↓
global authorization decision
```

Capability sets are explicit. The resolver does not assume implicit capability inheritance from numeric rank ordering. A configurable capability's policy is therefore the explicit array of permitted effective rank indexes.

Global permission policy machinery owns reading and replacing those rank arrays. Modules consume the resulting global authority rather than maintaining their own rank maps.

## Permission administration root authority

Permission administration is deliberately not another configurable capability. In supported customer topology, current effective rank `0` may administer capability-to-rank policy innately. Installation GM verification is a separate Blizzard-backed trust anchor and cannot be conferred by a Manual roster rank.

No editable capability grant can remove rank 0's ability to administer permission policy or manufacture that root authority for another rank.

## Development authority override

Development topology may designate one Guildie through `DEVELOPMENT_AUTHORITY_GUILDIE_ID`. The development Compose topology explicitly enables this seam; supported customer topology does not.

The designated development Guildie satisfies the same inherent application authority checks as an effective rank-zero Guildie. This exists so development can exercise GM-authorized workflows when the developer's real guild character is not rank 0.

This override is application authority only. It does not synthesize a guild rank, add entries to `guild_rank_capabilities`, or rewrite Blizzard-observed membership or rank facts. Effective authority continues to report the Guildie's mode-selected effective rank.

Host or deployment control is not guild authority. The development override is development machinery, not a supported customer/deployer ownership mechanism. Clean-room release validation must exercise the real rank-0 Guild Master authorization path without this override.

## Administration projection

`/admin/permissions` is a global projection of registered configurable capability policy. Global Administration owns its rendering, styling, grouping, and rank-selection behavior. Capabilities are grouped by their registered namespace and shown using descriptive metadata while the dotted capability key remains intact underneath.

The page keeps each capability compact until its rank checklist is expanded. This is presentation only; the persisted authority remains the explicit capability-to-rank mapping.

Presentation is never the enforcement boundary. Routes and procedures that require a capability must enforce that requirement against backend authority regardless of whether the corresponding control is visible.

## Module use

A module owns the meaning of the capabilities its domain requires. When a module needs configurable rank-derived authority, it registers the authoritative key and human projection metadata with the global capability-policy machinery. Global machinery owns persistence and Administration projection.

A module does not register a permission page and does not own a parallel rank-permission table. It consumes global capability authority, or may retrieve the configured permitted-rank array through the application-facing policy service when that contract is useful.

This does not require every module to contribute capabilities. A module contributes only concrete authority its real procedures have earned.
