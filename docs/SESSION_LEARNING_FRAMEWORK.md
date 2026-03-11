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

## Session 003: Lock DAX Voice Before The Workstation Drifts

Date: March 11, 2026

### Starting User Intent

The user wanted to finalize the workstation voice before more TUI implementation drifted toward generic AI-assistant language.

### What The Session Revealed

Once the workstation model is stable, tone stops being a branding detail and becomes an interaction contract.

The wrong voice would break:

- the stream as narrative
- the sidebar as truth
- the overlays as evidence

The correct persona is not "teammate."

It is:

- execution operator

### Prompt Engineering Patterns That Worked

#### Pattern 9: Lock voice as a product rule, not a style preference

The strongest move was to define:

- persona statement
- hard tone rules
- forbidden phrases
- surface-specific guidance

Why it worked:

- it prevents later UI drift
- it gives implementation a concrete review bar
- it keeps stream, sidebar, and overlay roles from collapsing into assistant chatter

## Session 004: Validate Explore Before Expanding Mode Plumbing

Date: March 11, 2026

### Starting User Intent

The user wanted Explore to become a real repository-understanding capability, but only after its output was trustworthy on real repos.

### What The Session Revealed

The correct sequencing was:

1. define the Explore execution graph
2. define the fixed Explore output contract
3. build the internal pass pipeline
4. expose one narrow `dax explore` command
5. validate it on real repos
6. refine signal quality before adding broader mode plumbing

This kept Explore from becoming a vague repo summarizer.

### Prompt Engineering Patterns That Worked

#### Pattern 10: Build the internal truth before the user-facing mode

Better sequence:

1. evidence model
2. section renderer
3. pass outputs
4. command surface
5. mode plumbing later

Why it worked:

- it prevented a hollow `explore` mode
- it made real-repo validation possible early
- it forced quality work to happen before surface expansion

#### Pattern 11: Validate with intentionally different repo shapes

The strongest Explore evaluation came from using a mixed local repo set:

- single-surface CLI/runtime repos
- workspaces/monorepos
- content/web repos
- mixed-language repos
- unfamiliar repos

Why it worked:

- repeated failure modes became obvious
- weak heuristics stopped hiding behind one “good fit” repo
- refinement priority became evidence-driven instead of taste-driven

#### Pattern 12: Treat unknown as a valid product outcome

The useful correction was not “make Explore say more.”

It was:

- reduce false positives
- down-rank noise
- preserve `observed`
- use `inferred` carefully
- let unresolved areas stay `unknown`

Why it worked:

- it made Explore more trustworthy
- it kept reading order cleaner
- it made future refinement targets concrete

## Session Learning As A Product Feature

The framework should not stay docs-only forever.

There is now enough repeated evidence that DAX can eventually expose session learning as a first-class product capability.

### What Session Learning Could Become

Potential product surfaces:

1. session replay with extracted patterns
2. reusable prompt and execution lessons
3. “what worked / what failed” summaries
4. feature candidates derived from repeated friction
5. team-level learning packs from real governed work

### Candidate Artifacts Per Session

For each important session, DAX should eventually be able to derive:

- intent evolution
- clarification path
- constraint patterns
- execution sequencing lesson
- anti-patterns
- feature opportunities

### Current Product Rule

Until there is a dedicated feature surface, keep enriching this framework whenever work reveals:

- a repeatable prompt pattern
- a repeatable execution pattern
- a stable design rule
- a productizable lesson
- it keeps DAX aligned with the control-plane product identity

#### Pattern 10: Use verb-first phrasing to preserve operator tone

Best examples:

- `Scanning repository`
- `Producing report artifact`
- `Approval required`
- `Execution paused`

Why it worked:

- it keeps the stream concise
- it removes chatbot framing
- it makes the center read like execution, not conversation

#### Pattern 11: Separate narration from explanation at the voice level too

The same model that works structurally also works tonally:

- stream narrates
- sidebar states
- overlays explain

Why it worked:

- it keeps voice and information architecture aligned
- it stops reasoning language from leaking into the stream
- it gives each surface a distinct job

## Session 004: Lock Modes Before Explore, Sub-Agents, And Skills

Date: March 11, 2026

### Starting User Intent

The user wanted to design modes, sub-agents, skills, and Explore mode without destabilizing the workstation, interaction model, or execution-operator voice.

### What The Session Revealed

The correct dependency order is:

1. mode model
2. sub-agent model
3. skills model
4. Explore mode

This prevents Explore from turning into shallow summarization and prevents sub-agents from becoming competing personas.

### Prompt Engineering Patterns That Worked

#### Pattern 12: Lock inheritance rules before specialist features

The strongest move was to define what modes are allowed to change before defining what sub-agents or skills can do.

Why it worked:

- it protected the stream persona
- it protected the sidebar contract
- it reduced later UI and behavior drift

#### Pattern 13: Treat ELI12 as an explanation modifier, not a narration mode

This was an important clarification.

Why it worked:

- it preserves the execution-operator stream
- it keeps overlays and guided help as the right place for simplification
- it avoids splitting the product into multiple voices

#### Pattern 14: Treat skills as capability packs, not personalities

Defining skills as prompts, tools, checks, workflow steps, and output contracts keeps them operational.

Why it worked:

- it keeps tone centralized
- it keeps reuse practical
- it stops skills from fragmenting the system identity

#### Pattern 15: Make Explore produce structured repo understanding, not prose impressions

The strongest Explore contract is file-grounded and output-shaped:

- entry points
- execution flow
- orchestration loop
- integration map
- important files
- reading order
- unknowns
- follow-up targets

Why it worked:

- it makes Explore actually useful for engineering work
- it prevents README paraphrasing
- it aligns Explore with the control-plane product, not a summarizer product

#### Pattern 16: Use ordered passes to turn repo exploration into evidence

The strongest Explore workflow is not one-shot analysis.

It is:

1. boundary pass
2. entry-point pass
3. execution-flow pass
4. integration pass
5. evidence pass

Why it worked:

- it makes investigation reproducible
- it gives each claim a better evidence trail
- it prevents premature architectural storytelling

#### Pattern 17: Distinguish observed, inferred, and unknown explicitly

This is critical for repo exploration.

Why it worked:

- it keeps Explore honest
- it makes partial understanding useful instead of misleading
- it gives follow-up investigation a clean target

#### Pattern 18: Separate Explore method from Explore deliverable

The cleanest Explore design uses two contracts:

- execution graph = how Explore investigates
- output contract = what Explore must return

Why it worked:

- it separates internal tracing from user-facing consistency
- it makes implementation easier to test
- it reduces the chance of Explore drifting into ad hoc prose

## Session 003: Settle Write Outcome Semantics Before Surface Expansion

Date: March 10, 2026

### Starting User Intent

The user wanted richer write-governance truth pushed into operator surfaces, but only after the semantic layer could distinguish completed writes from blocked or partial write paths.

### What The Session Revealed

The stronger move was not immediate `session show` / `session inspect` exposure.

The stronger move was:

1. classify write risk
2. map write buckets into trust/readiness severity
3. stop again and define partial / blocked / no-durable-result semantics
4. only then expose richer write-governance truth in broader operator surfaces

### Prompt Engineering Patterns That Worked

#### Pattern 9: Finish semantic distinctions before broadening operator surfaces

Good sequence:

1. artifact truth
2. enforcement visibility
3. bucket-based severity
4. partial/blocked semantics
5. operator-surface expansion later

Why it worked:

- it prevented `show` / `inspect` from becoming semantically unstable
- it kept the repo aligned with the model -> bridge -> code discipline
- it made policy depth a prerequisite for surface breadth

#### Pattern 10: Separate write outcome semantics from risk buckets

Why it worked:

- risk buckets answer what kind of write happened
- write outcomes answer how the write actually resolved
- trust and readiness can consume both without collapsing them into one overloaded concept

#### Pattern 11: Stabilize semantics before deciding default surface exposure

Good sequence:

1. fix lifecycle truth
2. fix artifact truth
3. harden inspection reliability
4. settle write governance semantics
5. only then decide what belongs in list/show/inspect/judgment/workstation defaults

Why it worked:

- it prevented premature UI and surface churn
- it made surface placement a product decision rather than a guess
- it clarified that not every internal truth deserves default visibility

#### Pattern 12: Choose workstation direction through exposure variants, not isolated widgets

Better sequence:

1. settle runtime truth
2. settle surface exposure boundaries
3. compare 2-3 workstation variants
4. choose one product posture
5. only then refine panes, overlays, and stream rules

Why it worked:

- it kept the TUI discussion architectural instead of cosmetic
- it forced tradeoffs to be explicit:
  - calmness vs visibility
  - execution focus vs governance emphasis
  - summary vs drilldown
- it made the "balanced workstation" recommendation defensible rather than stylistic

#### Pattern 13: Lock sidebar truth rules before refining interaction details

Better sequence:

1. lock center vs sidebar invariant
2. choose the balanced workstation direction
3. define sidebar card order and card behavior
4. only then design overlays, footer shortcuts, and focus behavior

Why it worked:

- it kept durable truth separate from live execution
- it prevented drilldown behavior from shaping card semantics prematurely
- it gave the workstation a stable operator scan order before visual refinement

#### Pattern 14: Define the stream as event narrative, not system reasoning

Better sequence:

1. lock center vs sidebar invariant
2. define sidebar truth rules
3. define allowed and forbidden stream message classes
4. only then design overlay detail and shortcut behavior

Why it worked:

- it protected the center from becoming a dashboard or compliance feed
- it made interruptions explicit without turning them into explanations
- it preserved the stream as a chronological execution story

#### Pattern 15: Define overlays as evidence surfaces after stream and sidebar are stable

Better sequence:

1. lock sidebar truth
2. lock stream narrative
3. define overlays as evidence and explanation surfaces
4. only then refine focus and shortcut behavior in detail

Why it worked:

- it kept overlays from absorbing responsibilities meant for the stream or sidebar
- it made each drilldown surface justify its existence
- it preserved the center/sidebar/overlay separation as a real product architecture

#### Pattern 16: Lock interaction hierarchy only after surface roles are clear

Better sequence:

1. define center narrative
2. define sidebar truth
3. define overlays as evidence
4. then define focus, shortcuts, and open-close behavior

Why it worked:

- it prevented shortcut design from distorting surface purpose
- it made focus ownership a consequence of product structure
- it kept the workstation interaction model simple in the first version

#### Pattern 17: Collapse multiple workstation specs into one refined committed direction

Better sequence:

1. compare variants
2. lock sidebar rules
3. lock stream rules
4. lock overlay and interaction rules
5. collapse them into one refined workstation mockup

Why it worked:

- it turns abstract design layers into one implementable product shape
- it prevents endless variant churn
- it gives implementation a single source of workstation truth

#### Pattern 18: Treat approvals as interruptions, not persistent UI mode

Better sequence:

1. define workstation roles
2. commit a refined workstation direction
3. define approval interruptions as a special narrative break
4. keep decision-making inside the overlay, not the stream

Why it worked:

- it preserved the center/sidebar/overlay separation under stress
- it kept approvals visible without turning the workstation into a modal shell
- it made approval handling feel like part of the execution story rather than a separate product

Useful distinction:

- risk bucket answers `what kind of path was written?`
- write outcome answers `how did the governed write path actually end?`

Why it worked:

- it stopped severity from doing too much semantic work
- it clarified why partial writes and blocked writes must be modeled separately
- it keeps later operator wording more auditable and easier to reason about

## Session 003: Refine Semantics in Two Passes, Not One

Date: March 10, 2026

### Starting User Intent

The user wanted the next post-validation correction to tighten run lifecycle truth before any UI work resumed.

### What The Session Revealed

The first lifecycle correction solved the weak path:

- lightweight visible-answer runs no longer looked falsely complete
- planning-only sessions became terminal correctly

But it also exposed a second semantic gap:

- strong artifact-heavy runs could still remain classified as active

That meant the right move was not a broad rewrite. It was a second lifecycle refinement pass with a narrower question:

- what evidence is sufficient to treat a tool-driven artifact-heavy run as terminal?

### Prompt Engineering Patterns That Worked

#### Pattern 9: Fix the weak path first, then refine the strong path separately

Better sequence:

1. expose unfinished lightweight runs honestly
2. verify that planning-only sessions still terminate cleanly
3. only then refine the strong artifact-heavy completion path

Why it worked:

- it prevented one large ambiguous semantics change
- it made regression risk easier to understand
- it let evidence define the second refinement question precisely

#### Pattern 10: Write the refinement bridge before touching the strong path

The right intermediate artifact was:

- `DAX_RUN_LIFECYCLE_REFINEMENT_2.md`

Why it worked:

- it locked the acceptance cases before code changed
- it kept lifecycle refinement separate from write-governance work
- it preserved the repo discipline:
  - model
  - bridge
  - code

## Session 004: Fix Execution Truth Before Fixing Artifact Truth

Date: March 10, 2026

### Starting User Intent

The user wanted the post-validation corrections applied in the right order, with runtime lifecycle fixed before write-governance and artifact visibility.

### What The Session Revealed

Once lifecycle truth was corrected, the remaining gap became much clearer:

- write-intent sessions could complete
- real project files could exist
- but canonical artifact surfaces could still report `artifact_count = 0`

That meant the next move was not another lifecycle pass and not TUI work.

It was a write-governance implementation bridge focused on artifact truth propagation.

### Prompt Engineering Patterns That Worked

#### Pattern 11: Remove one ambiguity layer before diagnosing the next

Better sequence:

1. correct lifecycle truth
2. rerun real-session checks
3. isolate the remaining artifact-visibility gap
4. only then write the implementation bridge for write governance

Why it worked:

- it prevented mixing runtime and artifact bugs together
- it made the next implementation boundary obvious
- it kept the product semantics coherent

#### Pattern 12: Treat read-model truth as a first-class correction

The next bridge did not start with UI or policy redesign.

It started with a read-model correction:

- if governed execution creates durable project files,
  canonical artifact surfaces must see them

Why it worked:

- it focused on operator-visible truth
- it kept the first slice narrow
- it aligned trust, readiness, and history on the same artifact evidence

## Session 005: Fix Reliability Before Expanding Surface Area

Date: March 10, 2026

### Starting User Intent

The user wanted the next layer chosen based on what was still technically unreliable after lifecycle and artifact truth were corrected.

### What The Session Revealed

Once lifecycle and artifact truth were in place, the sharpest remaining issue was no longer semantics.

It was reliability:

- `session inspect`
- transient `database is locked`

That made the next correct move a reliability bridge for inspection paths, not more governance design and not UI expansion.

### Prompt Engineering Patterns That Worked

#### Pattern 13: Fix the narrowest real failure before broadening behavior

Better sequence:

1. correct lifecycle truth
2. correct artifact truth
3. identify the next operator-visible failure
4. fix read-path reliability before adding more surface area

Why it worked:

- it kept the product disciplined
- it prevented UI work from masking a real backend instability
- it chose the smallest meaningful reliability target

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

## Session 004: Let Validation Close Before Redesigning Execution Semantics

Date: March 10, 2026

### Starting User Intent

The user wanted DAX to stop expanding surfaces and start learning from real work, then use that evidence to choose the next strengthening layer.

### What The Session Revealed

Validation did its job.

Real usage showed that DAX is already strong in artifact-heavy governed workflows, but weaker in two execution-truth areas:

- `run` lifecycle closure
- write-governance visibility

That changed the next design priority from workstation UX to execution semantics.

### Prompt Engineering Patterns That Worked

#### Pattern 11: Use evidence to choose the next abstraction

Strong sequence:

1. stop feature work
2. run real sessions
3. log repeated friction
4. wait for stable patterns
5. only then write the next model docs

Why it worked:

- it prevented speculative redesign
- it turned validation into product direction
- it kept the next design layer tied to real operator pain

#### Pattern 12: Separate architectural stability from semantic weakness

The correct reading of the evidence was not “the system is failing.”

It was:

- architecture is stable
- artifact-heavy workflows are strong
- lifecycle and write-governance semantics need tightening

Why it worked:

- it kept confidence in the control-plane architecture
- it localized the next work instead of reopening everything
- it delayed TUI decisions until the underlying runtime truth becomes clearer

#### Pattern 13: Write the implementation bridge before fixing semantics

Once validation identifies the weak layer, the next move should not be immediate code edits.

The stronger sequence is:

1. define the semantic model
2. define the implementation bridge
3. only then change runtime behavior and dependent surfaces

Why it worked:

- it kept the implementation boundary narrow
- it forced a clear decision about computation ownership
- it reduced the risk of patching surface symptoms independently

The strong separation was:

- `verify` asks whether a session can be trusted
- `release check` asks whether a trusted session is ready for handoff or shipping

Why it worked:

- it prevented trust posture from collapsing into shipping judgment
- it made readiness depend on inspectable evidence
- it kept operator language legible

## Session 004: Stop Building and Start Structured Real-Work Evaluation

Date: March 10, 2026

### Starting User Intent

The user wanted to stop expanding surfaces and shift DAX into real-world validation without losing the disciplined structure built during the design phase.

### What The Session Revealed

At the end of the core design phase, the highest-value move is not another feature.

It is a runbook that turns real usage into structured evidence.

That lets the next layer emerge from friction rather than intuition.

### Prompt Engineering Patterns That Worked

#### Pattern 11: Replace instinctive iteration with evidence capture

The strong move was:

1. freeze the current operator loop
2. run real tasks through it
3. record friction in a consistent structure
4. delay fixes until patterns emerge

Why it worked:

- it protects the product from premature refinement
- it turns real workflows into comparable evidence
- it makes the next improvement layer easier to justify

#### Pattern 12: Evaluate the whole loop, not isolated commands

The useful framing was to test:

- discoverability
- readability
- navigation
- trust explanation
- readiness clarity

Why it worked:

- it evaluates DAX as an operator system rather than as disconnected commands
- it keeps the focus on workflow friction instead of local polish
- it creates a practical bridge from architecture to product maturation

Important boundary:

- `verify` decides whether a session can be trusted
- release readiness decides whether a trusted session is operationally complete

Why it worked:

- it stopped verification from absorbing deployment or handoff semantics
- it made readiness a downstream consequence instead of a mixed trust label
- it preserved clean product language for later CLI and UI surfaces

#### Pattern 11: Add one surface bridge before implementing a new judgment layer

Once release readiness was modeled, the next step was not command work.

It was:

1. define the readiness surface
2. decide the first command shape
3. keep CLI and UI concerns separate

Why it worked:

- it prevented release readiness from drifting into vague operator language
- it forced a clear product separation between `verify` and `release`
- it kept the next implementation slice narrow and inspect-first

#### Pattern 12: Validate judgment ladders against real sessions before UI exposure

Once `release check` existed, the next step was not workstation exposure.

It was:

1. run the judgment against real sessions
2. inspect state distribution
3. test whether ladder levels are meaningfully distinct
4. refine the CLI surface first if the ladder is skewed

Why it worked:

- it exposed that `review_ready` dominated real-session outcomes
- it separated surface readability from ladder usefulness
- it prevented premature UI work around an unproven readiness distribution

#### Pattern 13: Add higher-order grouping only after the lower layers are stable

Once transcript, timeline, verification, release readiness, and history all existed, the next move was not more CLI or UI work.

It was:

1. define SDLC stages as a higher-order grouping
2. keep stages out of the live stream
3. apply them first to history and summary surfaces

Why it worked:

- it preserved the separation between narration, progression, and judgment
- it prevented stages from turning into noisy stream labels
- it created a clean abstraction for later history and timeline summarization

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

## Session Pattern: Fix Governance Truth Before Reopening Surfaces

When validation isolates a remaining trust gap, define that enforcement layer explicitly before returning to UI or ergonomics work.

Applied sequence in DAX:

- lifecycle truth
- artifact truth
- inspection reliability
- write-governance enforcement

This keeps workstation and operator-surface design downstream of stable semantics instead of forcing UI to guess at runtime truth.

## Session Pattern: Add An Implementation Bridge Before Broad Governance Changes

When a governance model can affect approvals, artifacts, trust, and readiness at once, lock the first implementation slice before writing code.

For write governance specifically, that means:

- define enforcement truth
- define the smallest shared evaluator
- propagate it first through trust and readiness
- avoid mixing UI or approval-flow redesign into the same slice

This keeps governance corrections narrow and makes it easier to tell whether the next issue is enforcement logic or surface design.

## Session Pattern: Refine Policy Depth Before Surface Expansion

Once governance visibility exists, the next useful move is often not more exposure. It is better severity discrimination.

For write governance, that means:

- distinguish harmless writes from meaningful project writes
- separate sensitive writes from normal workspace edits
- define what partial writes mean
- tune trust and readiness severity before pushing the signal into broader operator surfaces

This prevents UI and summary layers from hard-coding governance language before the policy distinctions are stable.

## Session Pattern: Lock Overlay Internals After Surface Roles

Once the workstation has stable roles for:

- stream as narrative
- sidebar as truth
- overlays as evidence

the next useful move is to define the internal structure of overlays before worrying about responsive collapse or visual polish.

The right sequence is:

- define which overlays exist
- define their interaction model
- define one consistent internal layout contract
- only then address terminal-density constraints

Why it worked:

- it kept the evidence layer from becoming inconsistent across verify, release, artifacts, timeline, and inspect
- it made approval overlays fit the same workstation grammar instead of becoming a special-case modal
- it delayed terminal constraints until the real information density was known

## Session Pattern: Define Terminal Degradation Only After Information Density Is Known

Terminal responsiveness should not be designed before the workstation content model is stable.

The correct order is:

- define sidebar truth
- define stream narrative
- define overlays and their internal layouts
- then define width tiers, collapse rules, and resizing behavior

Why it worked:

- it prevented terminal constraints from being based on guesswork
- it made sidebar collapse a deliberate design choice instead of an implementation accident
- it kept stream continuity as the highest-priority constraint during shrinkage

## Session Pattern: End Design With One Implementation Bridge

Once the workstation has stable semantics, surfaces, overlays, interruptions, and terminal constraints, the final design artifact should not be another mockup.

It should be a single implementation bridge that maps:

- layout regions
- component boundaries
- overlay routing
- focus ownership
- resize handling
- event-loop responsibilities

Why it worked:

- it converts design into implementable structure without reopening semantics
- it gives implementation a fixed north star for architecture and sequencing
- it cleanly marks the end of the workstation design phase
