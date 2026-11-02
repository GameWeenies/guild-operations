# Blizzard Authority Evidence

## Purpose

This document records Blizzard API evidence that informed Guild Operations' member and guild authority model. Blizzard guild roster snapshots can lag in-game changes substantially; their acquisition time is not proof of in-game freshness. It is reference material, not the canonical definition of Guildie, authority, or persistence behavior.

Canonical contracts live in:

- [`../doctrine/member-objects.md`](../doctrine/member-objects.md)
- [`../infrastructure/authentication-ceremony.md`](../infrastructure/authentication-ceremony.md)
- [`../infrastructure/persistence-boundary.md`](../infrastructure/persistence-boundary.md)
- [`../doctrine/member-objects.md`](../doctrine/member-objects.md) — including current Guildie organizational authority derivation

## User-authorized WoW profile authority

Observed user authorization used OAuth 2.0 Authorization Code Flow with `wow.profile` and then:

```text
GET /oauth/userinfo
GET /profile/user/wow for selected region
```

The two responses supplied a corroborated Blizzard principal plus subordinate WoW accounts and controlled Character coordinates.

A controlled probe confirmed callback state round-tripping and an approximately 24-hour bearer-token lifetime. No credentials or live account-identifying values are preserved here.

## Account hierarchy evidence

Observed structure:

```text
Authenticated Blizzard principal
└── WoW Account Profile projection
    └── wow_accounts[]
        └── characters[]
```

The probe account happened to expose one WoW account and twenty Characters; those counts are observations, not invariants.

Observed identifier relationships:

```text
userinfo.id == userinfo.sub == profile.id
```

by textual value, while the top-level profile identifier differed from subordinate `wow_accounts[].id`.

A second independent OAuth ceremony confirmed stable principal/profile identifiers, WoW account identifier set, and Character coordinates for the same Blizzard user.

This evidence supports the external authority coordinate:

```text
region + Blizzard authenticated principal identifier
```

Region remains explicit because global uniqueness across regions has not been established strongly enough to remove it.

## Character-coordinate evidence

Protected Character addressing used `{realm-id}-{character-id}`, and Character coordinates remained stable across independent authorization ceremonies.

This supports:

```text
region + realm_id + character_id
```

as the durable Character coordinate rather than Character name or other mutable presentation.

## Guild-roster evidence

Live reconnaissance established the configured guild as:

```text
guild_id: 65431436
region: us
realm_id: 129
realm_slug: gurubashi
name: OH CRIT I Pulled
```

The observed roster sample contained 517 Character memberships. Comparing one authenticated account/control observation with that roster produced:

```text
authenticated controlled Characters: 20
current roster intersections: 9
```

All intersections matched by Blizzard Character and realm identifiers rather than Character name.

This evidence supports the authority derivation defined in [`../doctrine/guild-authority.md`](../doctrine/guild-authority.md).

## Rank evidence

The roster sample contained populated numeric ranks:

```text
0, 1, 2, 3, 4, 5, 7
```

Rank `6` was unoccupied at the time of observation. Blizzard responses did not expose the guild's custom human-readable rank names.

The evidence supports two implementation assumptions used elsewhere:

- numeric rank in the Blizzard roster is a Blizzard-owned observation, not necessarily current or effective application authority;
- the complete rank-definition space must not be inferred only from currently occupied ranks.

Current capability translation is documented in [`../infrastructure/guild-permissioning.md`](../infrastructure/guild-permissioning.md).

## Region evidence

WoW Profile API requests are region/namespace scoped, for example `profile-us`. No sufficiently authoritative pre-profile region-discovery mechanism was established, so region remains explicit in the current authentication and Blizzard-principal coordinate.

## Current evidence-backed coordinates

```text
Guildie continuity
    → guildie_id

external Blizzard authority binding
    → region + authenticated principal identifier

subordinate account structure
    → WoW account identifier(s)

Character continuity
    → region + realm_id + character_id

guild continuity
    → Blizzard numeric guild_id

Blizzard-observed guild rank
    → numeric rank in the acquired Blizzard roster

application-effective guild rank
    → declared rank in Manual mode; observed rank in Blizzard Sync mode
```

Narrower Blizzard questions should be investigated only when concrete work requires them. New evidence should change canonical doctrine only when it materially changes what Guild Operations can legitimately assert.
