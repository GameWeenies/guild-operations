# Guild Refresh

Guild refresh is the shared observation procedure for Blizzard-reported guild roster state. It does not overwrite Guild Operations-declared membership or rank. The doctrine describing how roster truth contributes to Guildie authority lives in [`../doctrine/member-objects.md`](../doctrine/member-objects.md).

## What it owns

Guild refresh answers:

> Which Characters and numeric ranks does Blizzard's latest acquired guild roster report for this installation? These observations may be stale and are not necessarily the effective operational roster.

It does not establish Character control and does not make Character presentation authoritative for membership.

## Invocation surfaces

The same reconciliation procedure is used by:

- `npm run guild:sync` — one-shot operator/debug CLI;
- protected `POST /guild/refresh` — manual web/API refresh requiring `guild.refresh`;
- the application-owned automatic guild refresh scheduler.

The scheduler is internal application machinery, not an environment-variable or Docker worker configuration.

## Automatic schedule

Persisted schedule state records:

- enabled state;
- refresh interval in seconds;
- next due Unix instant.

The interval must be an integer of at least 300 seconds.

Schedule behavior:

- enabling schedules the first run one interval from save time;
- changing the interval restarts cadence from save time;
- disabling clears the next due instant;
- re-enabling starts a fresh cadence;
- claiming an automatic occurrence advances next due by the configured interval from claim time;
- failure does not disable later automatic occurrences;
- manual refresh does not move the automatic cadence.

Claiming a due occurrence uses an atomic database update so multiple application processes do not casually claim the same occurrence. Scheduler-triggered refreshes do not overlap within one process.

Manual execution and schedule configuration use the `guild.refresh` capability, resolved from effective guild rank. Default capability policy includes rank indexes 1 and 2; effective rank 0 has inherent administrative authority.

## Administrative surface

Guild refresh appears under `/admin` in Guild settings.

The surface exposes:

- current member count from persisted current roster membership;
- `Last reconciled` from the most recent successful persistence of Blizzard guild authority;
- automatic enabled state;
- interval in seconds;
- next due instant rendered in viewer-local time;
- `Refresh now`, which invokes the existing protected endpoint.

## Reconciliation behavior

After guild profile and roster persistence, current roster Characters are selected for presentation acquisition when:

- newly observed or returning after absence;
- roster-observed presentation coordinates changed;
- profile data is missing and not in a known-unavailable cooldown;
- media data is missing and not in a known-unavailable cooldown.

An unchanged current Character with complete profile and media data causes no Character API work.

Characters absent from the latest Blizzard roster are marked `currently_present = false` in observed state; historical observations are preserved. In Manual mode, this changes discrepancies only, not effective membership, rank, or Guildie transition emissions. In Blizzard Sync mode, observed changes affect effective authority and may produce Guildie transitions.

Follow-up presentation acquisition is documented in [`character-presentation-acquisition.md`](character-presentation-acquisition.md).

## Presentation availability

Roster membership and Character presentation availability are independent observations.

HTTP 404 from Character profile/media does not negate roster membership. Profile and media attempts record failure independently. A 404 suppresses another request for that same missing resource for seven days.

Newly observed, returning, or presentation-changed Characters bypass that cooldown. Successful acquisition clears the corresponding failure status. Other failures remain retryable normally.

## Blizzard request behavior

Guild profile, roster, and follow-up Character authority GETs use the shared [`blizzard-request-boundary.md`](blizzard-request-boundary.md).

Guild refresh owns target selection and reconciliation semantics; the shared request boundary owns pacing and retry behavior.

## Operational inspection

Completed refreshes publish `guild / refresh` evidence to [`operational-inspection.md`](operational-inspection.md) as `success` or `partial`. A refresh that does not complete publishes an exception when possible before rethrowing the original failure.

Manual refreshes record the initiating Guildie actor. Scheduled and CLI refreshes do not have a human actor.

Inspection publication is best effort and never rolls back authoritative roster reconciliation.
