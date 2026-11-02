# Architecture

## Purpose

Guild Operations is a self-hosted application for World of Warcraft guilds. One deployment represents one guild and provides that guild's interactive participation and operation layer outside World of Warcraft.

World of Warcraft remains the authoritative game domain, while Discord and other integrations may be important places where a guild communicates and participates. Guild Operations provides a neutral, knowledgeable place where guild-owned operational truth can be established and then expressed appropriately across those interfaces.

It is not an Armory replacement, a generic identity platform, a universal community platform, or an attempt to move a guild out of WoW or its established community spaces. It is a guild operations product whose scope remains grounded in concrete World of Warcraft guild participation and operation.

A useful product test is:

> Does this help establish authority to participate, enable guild participation, operate that participation, or preserve its history?

If not, it probably does not belong.

## Architectural center

The backend owns singular truthful operational state.

Web, Discord, and future WoW-facing integrations are projections or interaction surfaces over that truth. They may express the same facts differently because their media differ, but they must not become independent owners of the same operational facts.

Authority remains with whoever can legitimately establish the fact:

- **Blizzard** owns authenticated account control, Characters, and the in-game guild membership and numeric ranks it reports. Those roster reports are retained as observations and may be stale.
- **Guild Operations** owns meanings and procedures established by the guild outside WoW, including its declared operational roster in Manual mode and the effective membership/rank selection used by application consumers.
- **Human guild members** remain authoritative for judgments no machine can legitimately make.

Guild Operations should automate procedure, enforcement, recording, resolution, and presentation where useful. It should not manufacture authority merely because software could make a decision.

## Application contracts

Global machinery is the canonical application substrate for state and relationships that belong to Guild Operations as a whole.

Authoritative persistence and external observations are translated into named application contracts before consumers interpret them. Internal and external consumers depend on the same application meanings. Web presentation, external integrations, schedulers, administrative tooling, Activity plugins, and REST interfaces may express or invoke those contracts differently, but they must not independently reconstruct alternate versions of the same truth.

The dependency direction is:

```text
external authority / persistence
            ↓
    application contracts
            ↓
        consumers
```

A consumer should not need to know how state is persisted in order to use it correctly. Direct persistence access is appropriate inside the machinery that owns and establishes a contract; it is not an alternate contract for downstream consumers.

REST preparedness is a consequence of this coherence rather than a separate architecture. The promoted global REST namespace is `/api/v1`; it serializes and authorizes established application contracts rather than introducing a second interpretation of Guild Operations state. Resources and operations are added only when concrete consumer pressure earns them.

Concrete shared infrastructure may accept projections from an owning procedure. Calendar points and Operational Records are examples: their contracts define the shared meaning accepted by the infrastructure without transferring ownership of the underlying producer truth.

Do not introduce a generic application framework, universal object model, or speculative contract registry to enforce this rule. Establish concrete contracts as actual state and relationships require them.

## Semantic ownership and persistence

Persistence ownership follows semantic ownership.

A fact is not globally owned merely because it is stored in the same database, referenced by many consumers, or projected through shared infrastructure. Guild Operations globally owns durable application facts whose meaning belongs to the application as a whole. A concrete Activity plugin or other owning procedure owns durable facts created by its own procedure. Shared infrastructure may own storage and enforcement of its own contract while a producer remains authoritative for the truth contributed through it.

Persisting an external observation does not transfer authority from the system that established it. Blizzard observations may be retained by Guild Operations while Blizzard remains authoritative for the underlying Blizzard-owned facts.

Derived state should not become a second independently persisted source of authority merely because it is useful. Historical procedure facts may be persisted by the procedure that established them without becoming mutable sources of current identity, membership, or rank truth.

Persistence names actual objects and relationships. **Subject** is contextual language, not a persisted object category or universal coordinate.

When deciding where durable state belongs, ask what concrete fact is being persisted, who owns its meaning, whether it is authoritative or observed, whether an existing owner should be referenced rather than duplicated, and whether shared storage has actually been earned. Place state with its semantic owner rather than whichever code path happens to write it first.

Current transactional and operational persistence mechanics belong under [`../infrastructure/`](../infrastructure/).

## Semantic emissions and transport

A **semantic emission** is a publication that a meaningful application occurrence happened. The producer owns the occurrence and identifies it through an application-wide semantic code and authoritative coordinates. An emission is not created for a particular consumer and does not encode the work a consumer should perform. A valid emission may currently have zero, one, or many interested consumers.

Emissions have two earned production mechanisms:

- **operational production** — a meaningful occurrence is produced by an authoritative application operation or observed transition;
- **temporal production** — a meaningful occurrence is produced when authoritative state crosses a domain-defined temporal threshold.

The producer owns whether an operational event or temporal threshold is semantically significant enough to emit. Temporal production does not transfer ownership of the threshold's meaning into scheduling machinery.

Once produced, both kinds enter the same transport boundary:

```text
operational event ────┐
                      ├── emission → transport → interested consumers
temporal threshold ───┘
```

**Emission transport** begins when a producer publishes an emission and ends when that emission has been handed to each interested consumer. Transport owns routing and reliable receipt. Reliability may mature from direct in-process invocation to durable acknowledgement, retry, and recovery as concrete delivery pressure requires; those mechanics must not change the semantic meaning of emissions or transfer producer authority into transport.

Operational publication must not depend on a second best-effort step after authoritative state commits. When an authoritative operation and its semantic emission are persisted by the same application database, the authoritative mutation and durable publication are committed atomically. Consumer delivery remains downstream of that commit. This closes the loss window between committed domain truth and publication without making consumer work part of the domain transaction. Temporal producers must establish an equivalent durable publication boundary when they are implemented.

Reliable receipt is tracked per publication and intended consumer. The interested consumers registered when a publication is committed are snapshotted as durable pending receipts in that same transaction. A consumer acknowledges its receipt by returning successfully from its registered receive operation; failures remain pending and are retried by transport recovery. Recovery also resumes pending receipts after process restart.

This transport provides **at-least-once delivery**, not exactly-once external effects. A process can fail after consumer work succeeds but before acknowledgement is persisted, so consumers must make repeated receipt safe through idempotent or convergent work where practical. Current Calendar reconciliation is idempotent and Discord role reconciliation is convergent. Transport does not claim that a downstream external provider performed an effect exactly once.

Transport implementations and consumers require stable identities once reliability needs durable delivery coordinates. Transport identity distinguishes the mechanism responsible for carrying a publication; consumer identity distinguishes the independently interested recipient whose receipt may need to be tracked. Publication identity may likewise be introduced as transport-owned infrastructure when retries must distinguish repeated delivery of one publication from a separately produced occurrence. These identities are infrastructure coordinates, not domain meaning, and must not be encoded into producer-owned semantic codes or authoritative subject coordinates.

Consumers own all work after receipt. Calendar reconciliation, Discord projection or mutation, push notification, audience resolution, and other consumer-specific consequences remain concerns of those consumers and their adapters. From the transport boundary, Calendar, Discord, Push, and future consumers are the same class of participant: independently interested consumers of semantic emissions. Future consumers may pressure the transport design without requiring placeholder adapters, registrations, configuration, or persistence before those consumers actually exist.

Transport does not require every emission to have a consumer, and consumer usefulness does not itself establish producer meaning. Concrete consumer pressure may reveal a meaningful occurrence worth publishing, but the resulting emission describes the producer-owned occurrence rather than the requesting consumer's desired action.

Do not introduce a generic event domain, notification domain, audience framework, or scheduler merely to implement transport. Production, transport, and consumption remain distinct responsibilities even when their first implementation is small.

## Identity and authority model

Identity is the stable recognition layer beneath attributes, authority, capabilities, and actions.

Guild Operations is a World of Warcraft guild product, so a GO-recognized WoW Account Identity is its canonical domain identity and richest desired form of identification. Blizzard authentication authority above that boundary may discover multiple WoW Account Identities without merging them. External identities may also be established and may act independently where procedure permits.

Cross-authority association exists only between Identities and is always anchored directly to a GO-recognized WoW Account Identity. Association lets an external ingress Identity resolve to the canonical WoW-backed Actor subject while preserving the external Identity as the action origin.

Characters are controlled context beneath WoW Account Identity. Blizzard owns its observed in-game ranks; Guild Operations selects effective subject-guild membership and rank from its declared roster (Manual, default) or Blizzard observations (Blizzard Sync, opt-in). Guild Member Character and Guildie remain derived classifications, not independently authored identity objects. Representation is a declarable Identity attribute and does not determine authority.

The dependency direction is:

```text
Identity
   ↓
attributes / controlled context
   ↓
authority / capabilities
   ↓
actions
```

The canonical identity, member, Actor-resolution, and organizational-authority model lives in [`member-objects.md`](member-objects.md).

## Subject is contextual language

Guild Operations has no universal persisted domain object called **Subject**.

A subject is only the object currently being designated by a statement, question, event, or operation. Subjecthood creates no durable coordinate, ownership, persistence, authorization, or identity semantics of its own.

Persist and name the actual object or relationship involved. Do not introduce a generic `subject_id` as a domain shortcut.

## Recognition over profile completeness

Character presentation should favor recognition over profile completeness.

Useful recognition cues currently include Character name, class or active specialization, realm, and current guild rank. Additional Blizzard data should be introduced when a concrete guild workflow requires it, not merely because Blizzard exposes it.

> Prepare the seam, not the speculative feature.

## Time

All newly persisted values representing instants in time use **Unix timestamps**. Human-readable date, time, and timezone are presentation concerns. Local wall-clock input must be converted before persistence, and server/container timezone must not become application policy.

A temporal range uses two Unix values; an instant uses one. The owning contract defines their semantic meaning rather than introducing a speculative generic time framework.

Legacy timestamp columns predating this rule are conformity debt. They do not weaken the rule for new persistence and should not trigger unrelated wholesale migrations.

## Core, Activity, and extensions

Guild Operations distinguishes systemic ownership from concrete procedure and from distribution.

**Core** owns the shared truths, language, capabilities, and machinery required for Guild Operations to remain coherent. Current Core concerns include identity and guild context, authority and permissioning, Activity, Calendar, presentation, administration and operations, and the shared application infrastructure that supports them. Core remains coherent when no Activity plugins are installed.

**Activity** is a first-class Core primitive and the translation boundary for concrete guild procedures that produce Activity occurrences. Activity owns systemic Activity identity and lifecycle meaning, Participation as a systemic observation, plugin registration and activation, and translation into Core capabilities such as Calendar, authority, administration, discovery, navigation, and rendering. Activity does not own or reproduce concrete procedure.

**Activity plugins** own concrete Activity procedure. Raid and Raffle are current Activity plugins. They are authored in Guild Operations language and may depend strongly on Core vocabulary and machinery while remaining authoritative for what their own procedure means. Successful procedure may produce declarations with systemic Activity significance; Activity translates those declarations and current projections without learning enough procedure to reproduce the plugin's decisions.

The dependency direction is:

```text
Activity plugin procedure
        ↓ declarations / projections
      Activity
        ↓
 Core capabilities / systemic consumers
```

Shared vocabulary does not imply shared authority. Core may know what an Identity, Actor, derived Guildie attribute, Character, Role, Spec, rank, temporal coordinate, or capability means while an Activity plugin decides why that concept matters to its procedure. The provider owns what a primitive means and how it is resolved; the requester owns why its procedure requires it.

External integrations and other packaged capabilities are separate concerns. Their architecture should be established from their own concrete pressure rather than forcing Activity plugins and external-system integrations into one extension model. Distribution properties such as required, bundled, optional, or entitled likewise do not determine semantic ownership.

Application composition and adapters are structural roles rather than ownership categories. Web, REST, external integrations, CLI, and similar adapters express or invoke established application meaning without acquiring ownership merely because they are entrypoints.

Do not introduce a universal plugin superclass, extension framework, lifecycle engine, or generic procedure model merely because multiple packaged capabilities exist. Activity has earned its own explicit plugin seam through concrete Raid and Raffle pressure. Other extension seams should be earned independently.

## Activity and concrete pressure

Concrete Activity procedures are product pressure that should drive Activity architecture.

An Activity plugin owns its procedure and procedural persistence. Activity may project, organize, authorize, inspect, render, or otherwise systemize Activity-relevant truth without silently becoming authoritative for the procedure that produced it.

Systemic truth is not inferred from circumstances merely because Core can observe those circumstances. Plugin procedure determines when an authorized procedural act has succeeded and which successful acts have systemic Activity significance.

> Procedure produces declarations. Activity translates declarations into systemic consequences.

Shared abstractions are earned by concrete product pressure, not hypothetical extensibility. Multiple real consumers are strong evidence that a meaning should be generalized, but they are not a prerequisite for framework support: one concrete Activity plugin may earn a Core or Activity capability when supporting its legitimate expression belongs within Guild Operations' authority. Raid and Raffle remain paired pressure tests: their different procedure is evidence for preserving plugin authority, while the meanings they genuinely share have earned Activity ownership.

The current Activity boundary is governed by [Activity Plugin Contract](activity-plugin-contract.md). Calendar is Core and remains a consumer of Activity temporal projection rather than a consumer of Raid or Raffle. Participation is an optional systemic Activity observation rather than a generic plugin procedure or lifecycle.

## Interface model

Interfaces are projections and interaction surfaces over backend truth. No interface should become the sole keeper of meaningful guild operational state.

Member-facing context should help users recognize who is acting and what they may do without turning Guild Operations into a generic profile surface.

Current web implementation guidance lives in [`../infrastructure/web-rendering.md`](../infrastructure/web-rendering.md).

## Model maturity

Identity and authority machinery are infrastructure, not the product destination. The current foundation is intentionally sufficient rather than exhaustive.

When a new feature creates tension, prefer the smallest concrete change that lets the feature work correctly. Add another shared distinction only when real use proves it necessary.

## Documentation rule

Doctrine records durable meaning and design constraints. Current machinery belongs in infrastructure documentation.

Infrastructure may change substantially without changing doctrine; when doctrine itself changes, the project has changed what it believes the system should mean.
