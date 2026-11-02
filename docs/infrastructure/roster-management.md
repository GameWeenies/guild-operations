# Roster Management

Guild Operations maintains two independent membership/rank datasets for the bound guild:

- **Declared roster** (`guild_declared_roster`): Guild Operations-owned operational membership and numeric rank.
- **Observed roster** (`guild_roster`): the most recently acquired Blizzard guild roster, with observed presence and rank. Blizzard data can be stale.

`guild_roster_management` selects the effective authority source. **Manual** is the default, but has no effective members until explicitly initialized; there is no automatic Blizzard fallback. **Blizzard Sync** is opt-in and uses currently present observed members. Downstream Guildie, permission, character eligibility, Raid/Raffle, and Discord rank-role consumers resolve the selected effective roster.

## Manual mode

Guild Settings → Roster → Members permits authorized administrators to review/import initial observations, add or remove members, assign ranks, and review applicants. Blizzard refresh updates observations and discrepancies without changing declarations or emitting effective Guildie changes. Differences between declared and observed membership/rank are review information, not automatic changes.

## Blizzard Sync mode

Guild Settings → Roster → Members presents the observed snapshot without per-member mutation actions, with freshness and stale-authority warnings. Successful Blizzard refreshes can change effective Guildie membership/rank and publish corresponding transitions.

Switching Manual → Blizzard Sync requires risk acknowledgment and a controlled observed rank-zero administrator. Switching Blizzard Sync → Manual uses a snapshot-versioned discrepancy preview; selected observed differences are applied to declarations atomically with mode activation, while unselected declarations remain unchanged. An effective controlled administrator must remain.

## Administrative workspace

Guild Settings → Roster has three sections: **Members** (effective membership, member edits, and pending applications), **Ranks** (rank display, permissions, and Discord role associations), and **Synchronization** (Blizzard refresh schedule, manual refresh, observed snapshot provenance, and Manual/Blizzard Sync authority transitions and reconciliation). Members is the default destination. The initial Manual roster import remains on Members and is accessible to the verified GM before operational rank authority exists. No public roster view is provided.

## Installation and recovery

Initial guild binding and rebinding require Blizzard-backed Guild Master verification, separate from Manual rank-zero operational authority. Rebinding starts fresh destination roster configuration, retains history, records the newly verified GM character, and cancels pending recovery intent for the previous guild.

If Blizzard Sync loses every controlled effective rank-zero administrator, the host may request recovery using `./go roster-recover request` (or the corresponding interactive host command). The originally verified GM must then establish a fresh Blizzard-authenticated session and authorize recovery at `/setup`. Recovery requires an initialized declared roster containing a controlled rank-zero administrator; it switches to Manual without altering either roster dataset. The host can cancel pending intent with `./go roster-recover cancel`. This is a two-party exceptional path, not a general host permission override.

## Operational boundaries

Blizzard observations are preserved as observations. Manual changes and mode transitions publish effective Guildie transitions for downstream consumers. Discord rank roles are converged through the Discord reconciliation cycle, not guaranteed to update synchronously with a roster edit.

The implementation and tests provide source/CI evidence; development deployment, migrations, authorization, Discord effects, and recovery still require separate runtime verification before v0.1.0 acceptance.
