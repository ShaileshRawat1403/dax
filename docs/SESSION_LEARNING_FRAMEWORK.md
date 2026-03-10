# DAX Session Learning Framework

This document is a living record of how DAX should learn from real working sessions.

The goal is not just to save outputs. The goal is to capture:

- how to think
- how to ask
- how to constrain
- how to sequence work
- how to refine intent into execution

Over time, this should become a practical masterclass in prompt engineering for AI-assisted SDLC.

## Why This Exists

DAX is not only a runtime for execution. It should also help users learn how to work effectively with AI.

That means each important session can produce reusable knowledge in five layers:

1. product insight
2. prompt pattern
3. execution pattern
4. architecture decision
5. anti-pattern to avoid

## Session Learning Template

For each significant session, capture:

### 1. Intent

- What the user actually wanted
- What they first said
- What the deeper objective turned out to be

### 2. Clarification Path

- Which questions mattered
- Which repo checks reduced ambiguity
- What assumptions were safe vs unsafe

### 3. Prompt Engineering Pattern

- What framing worked
- What constraints improved output quality
- What language reduced ambiguity
- What sequencing turned vague goals into executable work

### 4. Execution Pattern

- What should happen first
- What should not happen too early
- Where safety or governance must intervene

### 5. Durable Learning

- What DAX should remember
- What can become product behavior
- What can become docs, templates, or workflows

## Session 001: Reposition DAX as an Execution Control Plane

Date: March 9, 2026

### Starting User Intent

The user wanted a deep critique of DAX as a practical AI-assisted SDLC product, then wanted to reposition and overhaul it into a real enterprise-grade product.

### What The Session Revealed

The real need was not “make it better.”

The real need was:

- choose the right category
- remove confusing product signals
- preserve useful existing work
- define what to reuse versus what to delete
- turn one conversation into a repeatable product-learning asset

### Prompt Engineering Patterns That Worked

#### Pattern 1: Move from aspiration to category

Weak framing:

- “make DAX powerful”
- “move toward AGI”

Strong framing:

- “DAX is the execution control plane for AI-assisted SDLC”

Why it worked:

- it defined category, audience, and differentiation in one sentence
- it made later architectural decisions easier
- it removed distracting AGI marketing pressure

#### Pattern 2: Ask for critique before implementation

Strong sequence:

1. review the repo as-is
2. identify strengths and weaknesses
3. choose positioning
4. define overhaul plan
5. implement in stages

Why it worked:

- it prevented premature refactoring
- it preserved useful work
- it exposed the real trust and repo-boundary problems first

#### Pattern 3: Name the reuse constraint explicitly

Important user correction:

- do not delete CLI, TUI, and core blindly
- reuse maximum code
- delete only redundant parts

Why it worked:

- it changed the cleanup strategy from removal-first to donor-assessment-first
- it protects accumulated product intuition already embedded in legacy surfaces

#### Pattern 4: Convert the session into a reusable framework

This is a high-value move.

Instead of treating the conversation as disposable chat, treat it as:

- a product artifact
- a prompt-engineering lesson
- a workflow design pattern

This should become a DAX-native behavior.

## Session 002: Make Governance Visible Before Tightening Execution

Date: March 9, 2026

### Starting User Intent

The user wanted DAX to feel like a real operator system, starting with `dax approvals`, then tightening `run` only after governance language was stable.

### What The Session Revealed

The safer execution order was:

1. expose approvals as first-class objects
2. align wording across CLI and TUI
3. tighten `run` around governed execution

This avoided destabilizing runtime flow too early.

### Prompt Engineering Patterns That Worked

#### Pattern 5: Sequence the safest category-defining change first

Better sequence:

1. make approvals visible
2. stabilize intervention language
3. tighten execution entrypoint

Why it worked:

- it improved category clarity before touching a foundational path
- it reduced implementation risk
- it made `run` easier to reframe honestly

#### Pattern 6: Tighten semantics before broad refactors

For `run`, the correct move was not “rewrite runtime.”

It was:

- clarify execution intent
- show pre-execution visibility
- keep structured output
- avoid overclaiming plan validation that does not yet exist

Why it worked:

- it improved product posture with minimal churn
- it respected the current runtime contract
- it kept future plan-mode work open

#### Pattern 7: Separate workflow stages before adding more capability

Strong next-step framing:

- close the execution-language wave first
- record the planning vs execution boundary explicitly
- only then design a first-class planning surface

Why it worked:

- it prevented `run` from absorbing too many identities
- it made the product grammar clearer:
  - `plan`
  - `run`
  - `approvals`
  - `artifacts`
  - `audit`
- it preserved convenience while clarifying long-term direction

#### Pattern 8: Design around existing behavior before inventing new surfaces

For `dax plan`, the strongest move was not to invent a new planner from scratch.

It was to read the existing runtime and see that DAX already has:

- a `plan` agent
- plan-mode entry and exit tools
- a real plan file path

## Session 003: Finish Session Depth Before Defining Release Judgment

Date: March 10, 2026

### Starting User Intent

The user wanted DAX to move from session depth into the next meaningful operational layer without drifting into UI work too early.

### What The Session Revealed

Release readiness only became designable after DAX had already defined:

- session as a durable record
- trust posture as a session property
- verification as trust judgment
- history surfaces for browsing and inspection

That sequence mattered more than speed.

### Prompt Engineering Patterns That Worked

#### Pattern 9: Finish the record surface before adding higher judgment

The strong sequence was:

1. define session history surface
2. implement `session list`
3. implement `session show`
4. implement `session inspect`
5. only then define release readiness

Why it worked:

- it prevented release readiness from being abstract or hand-wavy
- it forced readiness to depend on real inspectable session records
- it kept the product layered and legible

#### Pattern 10: Distinguish trust judgment from operational readiness

Important boundary:

- `verify` decides whether a session can be trusted
- release readiness decides whether a trusted session is operationally complete

Why it worked:

- it stopped verification from absorbing deployment or handoff semantics
- it made readiness a downstream consequence instead of a mixed trust label
- it preserved clean product language for later CLI and UI surfaces

#### Pattern 9: Define trust surfaces from operator questions, not legacy command names

For the trust layer, the right move was not:

- keep `verify-ledger` because it existed
- expose raw logs because they were available

It was:

- ask what operator trust question needs answering
- inspect canonical trust substrate first
- define `audit` as a summary-first trust surface

Why it worked:

- it kept `audit` separate from artifacts
- it prevented the surface from collapsing into raw internals
- it preserved future room for verification without forcing it into v1
- read-only constraints during planning

#### Pattern 10: Add history only after session, timeline, and verification are real

The correct sequence for durable record navigation was:

1. define session as a runtime primitive
2. define timeline as meaningful progression
3. define audit and verify separately
4. only then design session history

Why it worked:

- it prevented history from becoming a vague transcript archive
- it made history a navigation layer over already-defined session surfaces
- it kept workstation concerns separate from record-browsing concerns

Why it worked:

- it grounded the design in the current architecture
- it avoided creating a second planning model
- it showed that the next command can be an exposure layer, not a subsystem rewrite

#### Pattern 9: Write the implementation contract before writing the command

For `dax plan`, the next artifact after design was an implementation note, not code.

Why it worked:

- it locked the v1 scope before implementation pressure widened it
- it defined reuse points in the canonical runtime
- it made the non-goals explicit, especially:
  - no second planner
  - no breaking change to `run`
  - no explicit validation command yet

## Session 003: Layer Workstation Focus Over the Existing Interaction Substrate

Date: March 10, 2026

### Starting User Intent

The user wanted Pass 3 of the TUI refactor, but only after understanding the current keyboard and navigation behavior well enough to avoid fighting the existing session, prompt, and dialog model.

### What The Session Revealed

The current TUI is not empty. It already has a stable interaction priority:

1. dialogs
2. prompt
3. workstation surface

That means pane focus cannot be designed as a clean-slate navigation system. It must be added as a thin visible layer over the current prompt-first and dialog-priority substrate.

### Prompt Engineering Patterns That Worked

#### Pattern 10: Inspect real interaction ownership before defining a focus model

The useful question was not:

- what should a TUI focus model look like in theory?

It was:

- what currently owns interaction?
- which keys already mean something?
- where can workstation focus be added safely?

Why it worked:

- it grounded the next design step in the actual codebase
- it prevented a fictional focus model that would conflict with working dialogs and prompt behavior
- it made Pass 3 additive instead of disruptive

#### Pattern 11: Design new interaction layers as overlays, not replacements

The correct framing for workstation focus was:

- keep dialogs in control when open
- keep prompt as the fallback interaction home
- add pane focus only when no higher-priority owner is active

Why it worked:

- it respected current TUI behavior
- it kept keyboard changes narrow
- it created a safe boundary for `tab`, `shift+tab`, and pane-aware footer hints

#### Pattern 12: Narrow the first focus pass to visibility and predictability

The right Pass 3 scope was not:

- rebuild all navigation
- rewrite overlays
- universalize `enter`

It was:

- make focus visible
- make pane cycling predictable
- make footer hints focus-aware
- add `enter` only where it already maps naturally

Why it worked:

- it reduces the risk of regressions in prompt, approval, question, and diff flows
- it keeps the workstation feeling more intentional without overreaching
- it makes the next implementation slice mechanical instead of exploratory

## Session 004: Normalize Overlays as Workstation Subviews

Date: March 10, 2026

### Starting User Intent

The user wanted the next TUI slice to improve coherence without pushing further on focus. The next inconsistency was the overlay layer: approvals, permission prompts, diff dialogs, and audit-oriented detail views still reflected older interaction patterns.

### What The Session Revealed

The correct next step after pane focus is not more navigation. It is overlay normalization.

The workstation now has a coherent base screen, so the next requirement is that overlays feel like focused subviews of that workstation rather than separate mini-apps.

### Prompt Engineering Patterns That Worked

#### Pattern 13: Move from structured screens to structured interaction systems

Once the base layout and pane focus are stable, the next question is not:

- what new feature should be added?

It is:

- where does interaction still feel inconsistent?

Why it worked:

- it shifted attention from feature growth to experiential coherence
- it identified overlays as the next highest-value inconsistency
- it kept the refactor aligned with product feel rather than implementation novelty

#### Pattern 14: Normalize overlay ownership before redesigning overlay logic

The correct Pass 4 framing was:

- define overlay taxonomy
- define ownership priority
- define return behavior
- define footer ownership
- preserve existing local overlay logic underneath

Why it worked:

- it avoids rewriting working approval/question/permission behavior too early
- it gives the workstation a coherent subview model
- it keeps the slice narrow and structurally valuable

#### Pattern 15: Treat close behavior as part of product trust

The most important overlay rule was:

- closing an overlay should return to the pane that opened it

Why it worked:

- it preserves operator orientation
- it makes overlays feel integrated with the workstation
- it prevents “where am I now?” confusion after modal interactions

#### Pattern 10: Convert the new grammar into a contributor-facing contract

After `plan`, `run`, and `approvals` became real surfaces, the next useful move was not another feature.

It was to document the canonical operator flow explicitly.

Why it worked:

- it turned implementation progress into a stable product contract
- it reduced the risk of future commands blurring responsibilities
- it gave contributors a simple rule:
  - `plan` defines work
  - `run` executes work
  - `approvals` exposes checkpoints

#### Pattern 11: Define inspectability before trust

Once the core operator grammar was stable, the next correct move was not to jump straight into verification language.

It was to define artifacts first.

Why it worked:

- artifacts answer what was produced
- trust surfaces answer why the result can be trusted
- separating them keeps storage, inspection, and verification from collapsing into one muddy concept

#### Pattern 12: Do the behavior pass before the implementation contract

For artifacts, the correct sequence was:

1. define the product boundary
2. inspect canonical runtime behavior
3. compare donor semantics
4. write the v1 implementation contract

Why it worked:

- it kept the command scope anchored to real runtime behavior
- it separated mental model value from obsolete donor storage design
- it made the v1 command contract much easier to keep thin

#### Pattern 13: Add the next command only after its place in the operator flow is clear

`artifacts` became safe to implement only after:

- the operator grammar was already stable
- the product boundary was defined
- the runtime substrate was inspected

Why it worked:

- the new command extended the canonical flow instead of competing with it
- docs and CLI help could absorb it cleanly
- it kept trust and inspectability separated

#### Pattern 14: Design the trust surface from the operator question, not the legacy command name

Once the visible operator grammar was stable, the next correct question became:

- why should I trust this execution trail?

Why it worked:

- it framed audit as a trust posture surface instead of a log dump
- it prevented early lock-in to `verify-ledger` as the category
- it kept `audit` broad enough to synthesize approvals, outputs, and readiness later

#### Pattern 15: Compare legacy verification semantics to canonical trust behavior, not to command names

For audit, the useful donor question was not:

- should we keep `verify-ledger`?

It was:

- what trust posture does `verify-ledger` imply that canonical DAX should preserve?

Why it worked:

- it separated conceptual integrity-check value from legacy implementation
- it let audit v1 stay inspect-first
- it kept explicit verification available as a later layer instead of forcing it too early

## As-Is vs To-Be

## As-Is

### Product

- DAX has strong execution/runtime ambition but mixed public messaging.
- It reads partly like governed orchestration, partly like coding assistant, partly like experiment.
- The repo contains real value but presents duplicate surfaces and mixed maturity.

### Architecture

- `packages/dax` is the real product surface.
- root `cli/`, `core/`, and `tui/` still contain meaningful older thinking and command patterns.
- some public docs still reflect older command shapes and storage models.

### Governance

- approvals, permission rules, audit trace, and PM are real strengths
- current governance is rule-based and approval-centric, not yet a rich contextual policy engine

### Extensibility

- tools, plugins, agents, and config surfaces exist
- extension behavior is powerful but still partly implicit and too implementation-shaped

### Release Trust

- now improved, but historically had placeholders, broken doc references, and soft repo boundaries

## To-Be

### Product

- DAX is clearly the execution control plane for AI-assisted SDLC
- natural-language programming is a capability, not the category
- the product serves both builders and operators

### Architecture

- `packages/dax` stays canonical
- root legacy paths are treated as donor/refactor material first
- only clearly redundant code gets deleted

### Governance

- DAX owns governed execution:
  - intent
  - plan
  - action
  - approval
  - verification
  - evidence

### Extensibility

- supported customization paths are explicit:
  - tool packs
  - agent/prompt packs
  - policy/config packs
- unstable hooks are clearly marked experimental

### Release Trust

- legal/docs integrity
- CI-enforced repo boundaries
- smoke-tested release readiness
- human-readable operator runbooks

## Reuse Strategy for `cli/`, `core/`, and `tui/`

Delete nothing by default.

Use this rubric:

### Keep and Migrate

Move ideas or code when a legacy area contains:

- a user flow missing from `packages/dax`
- clearer command ergonomics
- useful storage or workflow semantics
- better narrative or review UX

### Refactor In Place

Reuse logic when the behavior is valuable but the shape is outdated.

Examples:

- command semantics that should be re-expressed in the canonical CLI
- older session or memory models that should inform the new product contract
- simple TUI flows that can be absorbed into the current review surfaces

### Delete as Redundant

Delete only when all of the following are true:

- equivalent or better behavior already exists in `packages/dax`
- no public docs or tests still rely on the old path
- the old code adds onboarding or maintenance confusion

## What DAX Should Learn From This Session

This session suggests a future product capability:

### Session Learning Mode

DAX should be able to convert a work session into:

- a summary
- a decision log
- a prompt-engineering lesson
- a reusable workflow pattern
- a product-memory update

This can later become:

- a command
- a review surface
- a docs generator
- a team learning artifact

## Next Updates To Make In This Document

As the session continues, append:

- donor assessment for root `cli/`, `core/`, and `tui/`
- concrete reusable patterns found there
- refined as-is vs to-be architecture map
- commands or workflows that should become first-class DAX behavior

## Session 003: Build Trust Surfaces As Summary-First Operator Layers

Date: March 10, 2026

### Starting User Intent

The user wanted DAX to move beyond execution and outputs into a real trust layer, beginning with `dax audit`.

### What The Session Revealed

The correct move was not to expose raw ledger history as the main surface.

The correct move was:

- define the operator trust question first
- inspect canonical trust substrate already in the runtime
- preserve low-level access separately
- make `dax audit` a concise trust summary

### Prompt Engineering Patterns That Worked

#### Pattern 10: Define trust from review posture, not from implementation detail

Weak framing:

- show logs
- verify the ledger

Strong framing:

- what happened that matters for trust?
- is this execution trail reviewable?

Why it worked:

- it kept `audit` separate from artifacts
- it stopped the surface from becoming a raw event dump
- it made posture more important than internals

#### Pattern 11: Preserve advanced capability by making it explicit, not default

Instead of deleting low-level event access, move it behind an explicit command shape:

- `dax audit` for trust summary
- `dax audit events` for raw RAO history

Why it worked:

- it kept the operator surface clean
- it preserved useful debugging power
- it avoided false conflict between enterprise UX and advanced inspection

#### Pattern 12: Define the execution model before designing the workstation

The right UI sequence was not:

- sketch panels first
- wrap commands visually

It was:

- define the execution lifecycle
- define the session as the product unit
- map operator questions to workspace surfaces

Why it worked:

- it prevented the UI from becoming a chat shell with extra panes
- it anchored design to the real control-plane model
- it made the workstation a consequence of architecture, not decoration

#### Pattern 13: Use DITA as design grammar, not as user-facing vocabulary

For the TUI, the strongest move was not:

- invent more widgets
- use documentation labels literally in the UI

It was:

- use concept, task, reference, and troubleshooting as information-design roles
- map those roles to DAX-native panes like Plan, Activity, Approvals, Artifacts, Audit, and Alerts

Why it worked:

- it separated orientation, action, state, and recovery cleanly
- it gave each pane one editorial job
- it kept the workstation legible without turning it into a dashboard

#### Pattern 14: Write one refactor spec when component structure, state, and navigation are coupled

For the workstation refactor, the right move was not:

- separate component notes
- separate keyboard notes
- separate state notes

It was:

- define component structure, state machine, keyboard model, and migration passes in one implementation-ready spec

Why it worked:

- it kept the session workstation coherent
- it reduced the risk of local UI decisions drifting from the full model
- it made the next refactor phase pass-based instead of exploratory

#### Pattern 15: Lock polish intent before visual cleanup

Once the workstation shell, focus model, and overlay model are stable, the next risk is vague polish work.

The correct move is to define a narrow detail-polish contract first:

- readability
- density
- empty states
- continuity cues
- truncation rules

Why it worked:

- it prevents polish from turning into stealth interaction redesign
- it keeps the pass focused on calmness and scanability
- it protects the already-stable focus and overlay ownership model

#### Pattern 16: Stop UI iteration when the next problem is product depth

Once the workstation can clearly answer:

- what is this session trying to do?
- what is happening now?
- what needs operator input?
- what was produced?
- what is the current trust posture?

the next move should not be more incremental UI work.

The correct move is to decide the next product layer explicitly:

- session depth
- trust depth
- workstation IA expansion
- long-term surface strategy

Why it worked:

- it prevented diminishing-return UI churn
- it turned a pause into an architectural checkpoint
- it kept the next phase anchored to product questions instead of implementation momentum

#### Pattern 17: Define the session before defining deeper trust

Once DAX reaches a stable execution grammar and workstation, the next move is not to jump into verification features.

The correct move is:

- define what a session actually is
- define its lifecycle
- define what it contains
- attach future trust, artifacts, and readiness work to that object

Why it worked:

- it kept sessions as runtime primitives instead of UI-only concepts
- it ensured trust would attach to durable work lifecycles rather than isolated commands
- it created a stable object model for future timeline, handoff, and release-readiness work

#### Pattern 18: Define trust as a session property before designing verification

After the session model is explicit, the next move is not to jump straight into `audit verify`.

The correct move is:

- define trust inputs
- define trust signals
- define a posture ladder
- define how trust degrades
- attach all of it to the session

Why it worked:

- it kept trust from collapsing into command behavior or UI labels
- it made audit a surface over trust rather than the owner of trust
- it created a clean foundation for later release-readiness and verification design

#### Pattern 19: Define the timeline as progression, not telemetry

Once session and trust are defined, the next move is to define how a session reveals its lifecycle over time.

The correct move is:

- model the timeline as a session-native runtime structure
- define meaningful event families
- keep the timeline append-oriented
- prefer operator meaning over raw event exhaust

Why it worked:

- it kept the timeline from collapsing into a log viewer
- it made future replay, handoff, and verification work easier to attach
- it preserved a clean distinction between transcript, ledger, and session progression

#### Pattern 20: Define verification as judgment over existing signals

Once session, trust, and timeline are defined, the next move is not to invent a new verification subsystem.

The correct move is:

- treat verification as evaluation
- use approvals, artifacts, findings, overrides, and timeline evidence as inputs
- let verification confirm, degrade, or limit trust posture
- keep verification separate from audit browsing

Why it worked:

- it prevented verification from inventing a parallel trust model
- it kept audit as inspection and verification as judgment
- it created a clean bridge toward release-readiness without conflating execution outcome with trust outcome

#### Pattern 21: Expose timeline depth before release judgment

Once session, trust, timeline, and verification models exist, the next move should not be release-readiness policy first.

The correct move is:

- expose the session timeline as an operator-facing surface
- validate event density and readability
- make progression visible before adding stronger judgment layers

Why it worked:

- it turned the new depth model into product behavior with low interaction risk
- it validated session progression as a usable surface before policy expansion
- it kept DAX grounded in accountable progression rather than jumping too early into formal release gates
## Session Pattern: Validate Surface Density Against Real Sessions

When a new operator-facing surface is implemented from a clean model, validate it against real sessions before expanding the UI around it.

Sequence:

- model the runtime object
- define the operator-facing surface contract
- implement the narrowest useful surface
- inspect real sessions
- record density, wording, and grouping problems
- refine the surface before adding more presentation layers

This prevents workstation or release-oriented design from being built on top of a surface that still reads like implementation exhaust.

## Session Pattern: Keep Session Progress Layers Separate

As session depth grows, keep three layers distinct:

- transcript for live execution story
- timeline for meaningful progression
- verification for trust judgment

This prevents the timeline from becoming a dumping ground and prevents audit from absorbing history, artifacts, and verification into one overloaded surface.

## Session Pattern: Prove The CLI Surface Before TUI Placement

When a new structured surface is introduced:

- model it first
- validate it through a narrow CLI surface
- refine density against real sessions
- only then choose workstation placement

For timeline specifically:

- CLI proves event families, wording, and grouping
- workstation should then expose the proven structure as a drilldown, not as a competing always-on pane

## Session Pattern: Separate Trust Inspection From Trust Judgment

As trust surfaces mature, keep the product language clean:

- `audit` inspects trust state
- `verify` judges whether trust signals justify stronger posture

This prevents audit from absorbing verification semantics and keeps verification from turning into another history or findings browser.
