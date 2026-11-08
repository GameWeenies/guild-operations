# Raid

Raid is an Activity plugin. It owns Raid-specific procedure while using Activity and Core machinery for systemic identity, lifecycle translation, Participation, authority, temporal projection, and shared presentation.

The governing boundary is:

> **Core machinery owns capability. Activity owns translation. Activity plugin procedure owns meaning.**

## Activity identity and lifecycle

Each persisted Raid is one Activity occurrence. Establishment creates an Active Raid. Conclusion or cancellation terminates its active procedure and projects it as a Record.

Raid lifecycle is declaration-driven:

```text
successful Raid establishment
        ↓
      ACTIVE
        │
        ├─ definition and occurrence coordinates
        ├─ participation commitments
        ├─ assignment
        ├─ commitment adjudication
        │
        ├─ conclusion ──────────┐
        └─ cancellation ────────┤
                               ↓
                             RECORD
```

The Raid occurrence time is a temporal reference coordinate. It can orient the Raid, order it, and project it into Calendar, but crossing that coordinate does not change Raid lifecycle or procedure.

Raid therefore does not infer history, freeze signups, prohibit assignment, or authorize closeout from the wall clock. While a Raid is Active, Raid procedure remains authoritative. Conclusion and cancellation are explicit operator actions authorized by Raid capability.

If Raid later earns a time-derived cutoff, that cutoff must be expressed through Raid procedure and a legitimate declaration. The passage of time itself is not procedural authority.

## Definition

Establishment defines:

- name;
- optional description;
- occurrence coordinate;
- difficulty;
- optional informational readiness requirements.

While the Raid remains Active, an authorized operator may modify its mutable definition, including its occurrence coordinate.

Readiness requirements communicate expectations to participants. Guild Operations does not mechanically enforce them.

Changing the occurrence coordinate produces changed temporal relevance for Activity consumers such as Calendar. Changing non-temporal Raid definition does not.

## Participation commitment

A Raid signup is Raid procedure expressing a participant's commitment: the applicant declares that they intend to participate and what they are willing to bring if selected.

The signup produces an Activity Participation Offer as systemic provenance. The Offer is not itself Participation.

A signed-in Guild Operations user may offer participation through the web application. A Discord interaction actor may offer through the configured Discord integration when **Allow Raid signups through Discord** is enabled. Discord-only participants retain their Discord identity and display attribution; linking to a web or Blizzard account is not required. The setting controls Discord interaction ingress, not web signups or existing commitments.\n\nApplicants declare one or more class/specialization combinations from the shared World of Warcraft catalog. The Discord signup flow lets a participant select specializations for one class, add further classes, and explicitly save the combined offer. These declarations express willingness to play, not character ownership or verified guild membership. Raid signup does not require a controlled character, Blizzard account, or current guild roster membership.

The applicant does not declare a Raid role directly. Raid derives willing roles from the class and specialization trait index. An assignment can only use a role supported by a specialization the applicant offered.

An applicant may have multiple active signup commitments. The public listing's signup count is the number of distinct applicants with at least one active, non-denied commitment.

While the Raid remains Active, a participant may revoke their own outstanding commitment when Raid procedure permits it. Revocation also removes an assignment attached to that commitment.

A signup is evidence of intent. It is not evidence of Participation.

## Assignment

Assignment is operator-owned Raid procedure. An operator organizes an active, non-denied signup commitment into the intended Raid roster by selecting a specialization and compatible Raid role from what the applicant offered.

Assignment is planned Raid configuration. It does not establish systemic Participation and does not prove that the commitment was fulfilled.

Assignment remains mutable while the Raid is Active. Its authority comes from Raid procedure and the Raid assignment capability, not from whether the occurrence coordinate is before or after the current time.

## External occurrence, commitment adjudication, and Participation

Raid is primarily preparatory procedure inside Guild Operations. Signup commitments and assignment organize a synchronized Raid whose meaningful participation occurs externally in World of Warcraft. Guild Operations does not observe that participation as it happens.

After the external occurrence, Raid operators reconcile what happened by adjudicating whether each surviving Raid commitment obligation was fulfilled. This closeout is retrospective evaluation of the external participation segment, not progressive in-system participation procedure.

Fulfillment and adjudication are distinct. The external Raid may satisfy a commitment before an authorized Raid operator records that observation. Adjudications remain revisable while the Raid is Active; conclusion is the point at which the completed reconciliation is committed.

Adjudication remains Raid-owned procedure. A fulfilled adjudication does not by itself establish systemic Participation; conclusion completes the Raid procedure.

Conclusion requires every active, non-denied commitment to have been adjudicated. For commitments adjudicated fulfilled, successful conclusion establishes Activity-owned Participation observations using the corresponding Participation Offers as provenance. For commitments adjudicated not fulfilled, conclusion closes the outstanding Offer without establishing Participation. Activity owns only that the Offer is no longer outstanding; Raid owns why its procedure resolved it without Participation.

```text
Raid signup
    ↓
Participation Offer
    ↓
Raid preparation / assignment
    ↓
external synchronized Raid in World of Warcraft
    ↓
operator reconciliation / adjudication
    ↓
Raid conclusion
    ↓
Activity Participation observation
```

Participation means that Activity recognizes the party as having participated in the Raid. Raid remains authoritative for why that observation was legitimate.

## Cancellation

Cancellation is a terminal Raid declaration distinct from conclusion. It ends active Raid procedure and makes the occurrence a systemic Record while preserving Raid-owned facts.

Cancellation closes unresolved Participation Offers and removes the Raid's temporal relevance from Calendar projection. Activity does not interpret the Raid-specific reason those Offers ended. Cancellation does not erase the Raid identity or rewrite its prior procedure.

A cancelled Raid is not ordinarily projected back to users as Raid history. Unlike conclusion, cancellation means the externally synchronized participation the Raid was preparing did not produce a meaningful Raid occurrence for Guild Operations to reconcile. The persisted Record exists for systemic truth; Raid procedure does not require a user-facing historical artifact merely because Activity retains that truth.

## Temporal projection

Raid exposes its occurrence coordinate through Activity temporal relevance while the Raid is not cancelled.

Calendar consumes that projection without learning Raid procedure. Conclusion does not remove the coordinate: a concluded Raid may remain represented at its historical Calendar coordinate. Cancellation withdraws temporal relevance because the cancelled occurrence should no longer occupy that projection.

Temporal projection is representation, not lifecycle authority.

## Authority

Raid uses explicit capabilities registered through Core authority machinery:

- `raid.modify` — establish Raids and change mutable Raid definition;
- `raid.assign` — organize Raid commitments into assignments;
- `raid.stage` — adjudicate commitments, conclude Raids, and cancel Raids;
- `raid.permissions` — delegate Raid operational capabilities.

The capability keys are stable authority identifiers. Raid owns why its procedure requires each capability; Core owns how guild authority is resolved.

## Surfaces and destinations

Each Raid exposes Activity destinations for its concrete surfaces:

- `public` — the public Raid occurrence;
- `participate` — Raid commitment procedure;
- `operate` — Raid operations.

Destinations identify available surfaces. They do not grant authority.

Active Raid surfaces permit the operations authorized by Raid procedure and the viewer's capabilities. Concluded Raids are Records and are presented as historical facts rather than mutable procedure.

## Application boundary

Raid application operations own consequential Raid behavior. HTTP routes and web surfaces adapt user interaction into those operations rather than independently deciding lifecycle or authority.

Consequential operations include:

- establishment and definition modification;
- cancellation;
- signup commitment establishment and participant revocation;
- assignment, reassignment, and unassignment;
- signup denial;
- commitment adjudication; and
- conclusion.

Raid persistence owns the procedural facts supporting those operations. Activity owns the systemic consequences produced through the Activity contract.

## Relationship to Activity

Raid is a concrete pressure test of the Activity plugin contract, not a generic Activity lifecycle specification.

Raid-specific concepts such as signup commitments, roster assignment, readiness requirements, commitment adjudication, and Raid conclusion remain Raid procedure. Other Activity plugins need not reproduce them.

The systemic boundary is narrower:

```text
Raid procedure
    ↓
Activity-significant declarations and projections
    ↓
Activity translation
    ↓
Core capabilities and systemic consumers
```

Calendar does not need to understand Raid. My Participation does not need to understand Raid signup or assignment. Raid does not need to own either consumer.

Raid demonstrates the general rule without generalizing its procedure:

> **Procedure produces declarations. Activity translates declarations into systemic consequences.**
