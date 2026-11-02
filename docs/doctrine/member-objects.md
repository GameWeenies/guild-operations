# identity and Member Objects

This document defines Guild Operations' identity model and the member-related facts derived from it.

Guild Operations is a World of Warcraft guild product. Its identity model therefore begins with the identities and facts that are meaningful to operating a WoW guild rather than attempting to model a universal person above every external provider.

## identity is the stable layer

An **identity** is a durable identity that Guild Operations recognizes.

identity answers:

> Who can Guild Operations recognize?

identity is the stable layer beneath attributes, authority, capabilities, and actions:

```text
identity
   ↓
identity attributes and controlled context
   ↓
Authority / capabilities
   ↓
Actions
```

An identity is not required to be backed by Blizzard. Discord and future concrete authorities may establish identities that Guild Operations can legitimately recognize. Different backing authorities provide different domain context; they do not create different grades of identity validity.

Do not introduce a universal human, person, member, or account-holder object above identity. Cross-authority relationships are expressed between recognized identities when concrete product behavior requires them.

## World of Warcraft is the domain anchor

Guild Operations exists to operate around a World of Warcraft guild. The most important identity information it can obtain is therefore an authenticated, GO-recognized **WoW Account identity**.

A WoW Account identity is not privileged because Blizzard is universally a superior identity provider. It is privileged because World of Warcraft is the domain Guild Operations exists to serve. A WoW Account unlocks the authoritative context from which GO can understand controlled characters, the subject guild, guild rank, derived guildie status, and rank-derived capabilities.

Accordingly:

> **A WoW Account identity is Guild Operations' canonical domain identity and richest desired form of identification.**

This does not make WoW identity mandatory for every operation. An external identity may act independently wherever the operation does not require WoW-derived facts.

## Blizzard authentication and the WoW Account boundary

Blizzard authentication establishes an authenticated Blizzard principal/profile and allows Guild Operations to discover the subordinate WoW accounts controlled through that authority.

Conceptually:

```text
authenticated Blizzard principal/profile
        │
        │ reveals / establishes control authority over
        ▼
WoW Account(s)
        │
        ▼
character(s)
```

The authenticated Blizzard principal/profile is **authentication authority above the Guild Operations identity boundary**. It is not itself the GO identity.

Each subordinate WoW account is independently meaningful in the WoW domain: it is independently occupiable in WoW and owns its own character population. Guild Operations therefore recognizes an individual WoW account as the identity boundary.

```text
──────── outside GO identity concern ────────
authenticated Blizzard principal/profile
        │
────────── GO identity boundary ─────────────
        ▼
WoW Account identity
        │
        └── controlled character(s)
```

One authenticated Blizzard principal may reveal multiple WoW Account identities. Their common authentication authority does not merge or associate them inside Guild Operations.

> **Authentication topology must not become identity topology.**

## Discovery, declaration, establishment, and occupation

External discovery and GO recognition are distinct.

**Discovery** means an external authority has revealed an identity candidate. Discovery alone does not establish a Guild Operations identity.

For WoW-backed login, Blizzard authentication reveals the WoW accounts available to the authenticated principal. The user selects one. That selection is an implicit declaration of intent to occupy that identity; it does not require a second confirmation ceremony.

If the selected WoW Account is not yet recognized by GO, GO **establishes** it and continues. Establishment means GO accepts the externally authoritative identity into its own durable identity space.

```text
Blizzard authentication
        ↓
discover WoW Accounts
        ↓
user selects one
        ↓
selection declares intent to occupy
        ↓
GO resolves selected account
        │
        ├── already established → occupy
        └── not established     → establish → occupy
```

GO does not eagerly establish every identity an external provider exposes.

An identity is **occupiable** when both its external authority and Guild Operations recognize it.

For the web application, occupation is the active GO session backed by an established identity. A separate durable occupation object is unnecessary:

```text
externally recognized identity
        ↓
user declaration / selection
        ↓
established GO identity
        ↓
session = occupation
```

Signing out ends the session/occupation. It does not destroy the identity or rewrite history.

## Acting and action attribution

An **actor** is ordinary role language for an accepted identity authoring an action. It is not a separate domain object or identity hierarchy.

Actorhood is a role of identity, not a second durable identity hierarchy. Procedure may constrain whether a particular actor is allowed to perform an action, but those constraints do not create the actor.

An actor has two identity coordinates when origination and canonical resolution differ:

- **subject** — the canonical identity to which GO resolves and attributes the actor;
- **origin** — the identity through which the action entered Guild Operations.

For ordinary self-resolving actions they are the same:

```text
native WoW action
  subject = WoW identity A
  origin  = WoW identity A

unassociated Discord action
  subject = Discord identity B
  origin  = Discord identity B
```

When an external identity is associated with a WoW Account identity, the WoW Account is the canonical actor subject while the external identity remains the origin:

```text
Discord identity C ── association ──► WoW identity A

Discord-originated action:
  subject = WoW identity A
  origin  = Discord identity C
```

The origin preserves truthful ingress/provenance and provider-specific context. The subject is the coordinate downstream domain procedure uses when singular actor identity matters.

> **actor subject identifies who GO resolved the author to. actor origin identifies the identity through which the action was authored.**

Historical attribution records the identity coordinate appropriate to the historical fact. Current attributes, rank, capabilities, or representation must not be mistaken for historical actor identity. Association/reconciliation policy for already-recorded history is a separate concern and must not silently corrupt truthful historical attribution.

## identity association

Association exists only at the identity layer.

Every cross-authority association recognized by Guild Operations has exactly one GO-recognized WoW Account identity as its domain anchor.

```text
GO-recognized WoW Account identity
              ▲
              │ association
              │
       external identity
```

Valid association does not form an arbitrary identity graph. External identities are not associated directly to characters, guildie status, selected representation, or one another in order to manufacture transitive identity.

The association's consequence for actor resolution is intentionally asymmetric even if the relationship itself is described conversationally as an association: an associated external identity resolves to the WoW Account identity because the WoW Account is GO's canonical domain identity.

Association does not erase either identity. The external identity remains independently meaningful as an authority-specific identity and as the origin of interactions through that authority.

This gives three important cases:

```text
WoW identity A
  → actor subject A

external identity B, unassociated
  → actor subject B

external identity C, associated to WoW identity A
  → actor subject A
  → origin remains C when C authored the interaction
```

An external identity that cannot resolve to a WoW Account identity behaves as a **guest actor**: it is fully identifiable and may act wherever procedure permits, but it has no WoW-backed context from which GO can derive WoW-specific attributes or capabilities.

An associated external identity is not a guest that has inherited arbitrary powers. It is an ingress identity for an actor whose canonical subject resolves to a WoW-backed identity.

## characters

A **character** is a durable World of Warcraft context object controlled beneath a WoW Account identity.

The durable Blizzard character coordinate is:

```text
region + realm_id + character_id
```

character control is authoritative external context observed through Blizzard. characters do not belong to guildie. guildie is derived later from character facts.

A character may be known through Blizzard's guild roster even when GO has not established the WoW Account identity that controls it.

characters remain important recognition surfaces because guildmates commonly recognize one another through characters. Useful presentation facts may include name, class or active specialization, realm, and current guild rank, but presentation does not establish identity, control, or guild membership.

## Subject guild and Guild Member character

The **subject guild** is the World of Warcraft guild represented by this Guild Operations installation.

Blizzard owns the in-game guild membership and numeric ranks that its API reports. Guild Operations retains these as observations, which may be stale, without rewriting their meaning. For application participation and permissions, Guild Operations selects an **effective roster**: its independently maintained declared membership/rank in Manual mode (the default), or the latest Blizzard-observed membership/rank in opt-in Blizzard Sync mode. Mode switching never silently copies one roster into the other.

A **Guild Member character** is a derived classification:

```text
GuildMemberCharacter(character, subjectGuild)
⇔
character has a recognized guild rank in subjectGuild
```

No recognized rank in the subject guild means the character is not currently a Guild Member character.

This classification is derived from effective subject-guild membership and character control. It is not an independently authored identity or a second membership record.

## guildie is a derived identity attribute

A **guildie** is not an identity, actor, durable person object, or intermediate owner of characters.

guildie is a **derived identity attribute**.

For a WoW Account identity:

```text
guildie(identity, subjectGuild)
⇔
∃ character ∈ ControlledCharacters(identity):
    character has a recognized rank in subjectGuild
```

Therefore:

```text
identity controls ≥1 Guild Member character
    → identity currently has guildie attribute

identity controls 0 Guild Member characters
    → identity does not currently have guildie attribute
```

The guildie attribute can appear or disappear as authoritative character control or subject-guild roster facts change. The identity remains stable.

guildie must not be independently authored or persisted as a competing source of membership truth. An implementation may cache/materialize a derived result for operational reasons, but the authoritative meaning remains derivable from identity, character control, and subject-guild rank.

Terms such as `guildie.joined` or `guildie.left`, if retained, describe transitions of this derived attribute. They do not describe creation or destruction of identity.

> **Derived means derived.**

## Rank and capability

Blizzard owns the numeric in-game rank it reports. Guild Operations owns declared operational rank assignments in Manual mode and selects the effective numeric rank according to roster mode. Guild Operations also owns what effective ranks permit inside the application.

Rank is a character-level authoritative fact. Rank-derived capability is evaluated from the subject-guild ranks of characters controlled by the relevant WoW Account identity.

A selected character representation does not determine authority.

The dependency remains:

```text
WoW Account identity
        ↓ controls
character(s)
        ↓ subject-guild rank
derived guildie / effective authority
        ↓
GO capabilities
```

An external guest actor has no WoW character/rank context and therefore cannot satisfy constraints that require guildie, Guild Member character, or rank-derived capability. This does not make the external identity invalid. It means the requested operation requires facts that identity cannot supply.

Open or `Any` operations may accept such an actor without requiring WoW context.

> **identity determines who is an actor. Subject-guild rank determines when WoW guild authority permits that actor to act.**

## identity presentation

An identity may declare a **display name** for ordinary Guild Operations presentation. The display name is an identity-owned presentation preference, not an identity coordinate, authentication credential, authority fact, or uniqueness constraint.

An identity may also choose a **profile icon** from Guild Operations' available WoW iconography. The choice is presentation only. Choosing an icon associated with a class or specialization does not assert that the identity or any controlled Character has that class or specialization.

Two identities may therefore choose the same display name without becoming ambiguous to domain procedure; procedure continues to use the durable identity coordinate. When an identity has not declared a display name, a domain identity coordinate such as its WoW Account ID may be used as a presentation fallback.

## identity attributes and representation

identity attributes describe a stable identity according to the authority appropriate to each attribute.

Attributes may have different authorities:

- **guildie** is derived by GO from controlled Characters and mode-selected effective subject-guild membership/rank.
- **representation** may include choices declared by the user as well as context that GO can resolve through the appropriate authority.

representation answers how an identity should be expressed in a particular context. The identity is the stable coordinate; representation is contextual expression of that coordinate. There is no requirement that one representation become the canonical presentation of an identity everywhere.

The same identity, and even the same Participation Offer bound to that identity, may therefore be represented differently in different surfaces. An operator workspace may use a procedurally selected character while a public projection uses a nickname, and a Discord projection may prefer an associated Discord persona. These presentations do not alter the identity or the Participation Offer.

Participation anchors procedure to identity; it does not anchor procedure to a chosen presentation of that identity. A Participation Offer therefore provides a stable route to the actor identity from which the representations available to a particular context may be resolved.

```text
Participation Offer
        ↓
actor identity
        ↓
contextual representation request
        ↓
Core resolution and rendering
```

Activity plugins and other producers may know about representation and request the representation appropriate to their context. They do not insert an already-resolved representation into systemic projection in place of the identity anchor. Core resolves the request against the identity and the authoritative context available to it.

A representation request is a presentation preference, not an identity or procedural requirement. A producer may request a character representation or prefer a specific character when one is contextually relevant. If that representation cannot be resolved, Core owns fallback or degradation; inability to satisfy a presentation request does not by itself invalidate the identity, Participation Offer, or plugin procedure.

Producing machinery may prescribe the kind or kinds of representation appropriate to its projection. Such a request may be ordered: for example, a consumer could prefer a nickname, then an appropriate character, then a specifically available character reference. The exact request vocabulary and resolution machinery should be earned by concrete consumers rather than generalized in advance.

A procedural character reference and a character representation are distinct facts. Procedure may establish that a particular character is relevant to an action or Participation Offer without declaring that the identity must be presented as that character. The character reference remains available to a representation context that elects to use it.

A selected main character is the identity owner's preferred fallback **within character representation**. It means: when GO must represent this identity as a character and the relevant context has not specified which character to use, prefer this character. A context that explicitly requests a particular character supersedes that default. A context requesting another kind of representation, such as nickname, does not consult the main-character preference merely because it exists.

representation is passive presentation state. It does not establish identity, character control, guildie status, rank, capability, participation, or attribution of an action.

A representation preference may become unavailable when the context supporting it changes without destroying the identity or rewriting historical actions. Character-backed preferences should retain a reference to the character and derive current character facts through character authority rather than copying those facts into identity-owned preference state.

Do not create a second identity layer merely to model representation, and do not generalize today's character-backed preference into a universal representation framework before concrete consumers earn shared machinery.

## Participation and actor resolution

Activity procedures consume actors; they do not own cross-authority identity resolution.

A Participation Offer represents one actor. When associated identities are involved, the Offer is keyed to the resolved actor **subject**, not independently to every identity that can originate actions for that actor.

```text
WoW identity A ───────────────────┐
                                  ├─ actor subject A → one Offer
associated Discord identity C ────┘
```

An unassociated external identity remains independently resolvable:

```text
Discord identity B
    ↓
actor subject B
    ↓
valid Offer where procedure permits guest / Any participation
```

Association is therefore not a prerequisite for participation merely because the interaction originated externally. It matters when WoW-backed context is required or when multiple ingress identities must resolve to one actor.

A procedure may constrain actors by current derived facts or require fulfillment from WoW context. Those constraints answer whether/how an already-recognized actor may participate; they do not determine whether the identity is legitimate.

## Subject is contextual language

Guild Operations has no universal persisted domain object called **Subject**.

A subject is contextual language for the object currently designated by a statement, question, event, or operation. actor `subject` is a specific identity-resolution coordinate within the actor contract; it does not establish a universal `Subject` domain object.

Persist and name actual objects and relationships. Do not introduce a generic `subject_id` merely as a shortcut for unrelated domains.

## Choosing the right coordinate

Use **identity** for durable recognition and cross-authority association.

Use **WoW Account identity** as GO's canonical domain identity and the anchor for every external identity association.

Use **actor subject** for the canonical identity to which an authored action resolves.

Use **actor origin** when the ingress identity or provider-specific provenance matters.

Use **character** for a specific WoW character and character-level Blizzard facts.

Use **Guild Member character** as the derived classification that a character currently has a recognized rank in the subject guild.

Use **guildie** as the derived identity attribute that the identity controls at least one Guild Member character.

Use **representation** for declarable presentation choices, not identity or authorization.

Use **capabilities** at operation boundaries when a real operation requires authorization.

Use **guest** for an actor whose subject remains an external identity because no WoW Account association resolves it into GO's domain anchor.

## Doctrine boundary

These are semantic rules, not a persistence migration plan.

The current implementation may still use `guildie_id`, Blizzard-principal-rooted ownership, guildie-scoped sessions, guildie-scoped authority, or direct guildie↔Discord associations. Those structures are implementation debt relative to this doctrine and must be audited according to what each persisted coordinate actually means.

Do not mechanically rename every `guildie_id` to `identity_id`. Determine whether each use means identity, actor attribution, representation ownership, current derived guildie state, authority, preference ownership, or a concrete procedure-owned historical fact.

Likewise, this doctrine does not yet prescribe retroactive reconciliation when a previously guest external identity is later associated with a WoW Account identity. Historical attribution must remain truthful; reconciliation policy should be earned and specified separately rather than smuggled into the definition of identity.

> **Stabilize the identity. Then determine what that identity is allowed to do.**
