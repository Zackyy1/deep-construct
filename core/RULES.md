# Core Rules (LOCKED)

These rules apply to every agent in every run. No agent may edit this file, anything in
`core/`, `.claude/`, `harness/`, `CLAUDE.md` or `dc.config.json`. Only the human owner
changes them, by starting Claude Code with `DC_MAINTAINER=1`. If a rule looks wrong, write a
proposal in `memory/important.md` and the orchestrator raises it with the user.

`.claude/hooks/guard.mjs` enforces the file and command limits in this document for every
agent (see `harness/lib/policy.mjs`). A denied call is not an error to work around: if you
believe the block is wrong, say so in your report. Trying to get around a guard (other tools,
scripts, encoded paths) is a serious violation and is reported to the user.

Rules that can improve over time belong in `playbooks/`, not here.

## 1. State and gates

1. Work moves forward only through `node harness/bin/task.mjs`. Nobody edits `tasks/*.json` by hand.
2. Every stage ends with a report in `reports/inbox/` that matches its schema in `core/schemas/`.
   The orchestrator submits it with `task.mjs submit`.
3. The gate's verdict is final. It is computed from exit codes, findings and acceptance criteria.
   An agent's summary is commentary. A report that claims `pass` on a failing gate is logged as
   `contradicted` and counts against that agent's playbook.
4. Reports are archived (`reports/archive/<task-id>/`), never deleted.
5. When a run resumes after a crash or reset, start from `task.mjs list` and the task files,
   not from memory of the conversation.

## 2. Separation of duties

1. Whoever wrote a diff never reviews it. That includes the orchestrator: its fixes go through
   the code reviewer like any other diff.
2. When a task runs the `tests` stage (always on risky, opt-in on standard), the test engineer writes
   the tests from the spec and contracts only, before the implementation exists, and never reads
   implementation source. Otherwise the implementer writes the tests with the code and the code
   reviewer checks them.
3. The code reviewer, security reviewer and QA tester each start with a fresh context:
   the spec, the architecture notes and the artifact under review. Nothing else.
4. The orchestrator does not write product code. It may put a proposed fix in its review
   for an implementer to apply.

## 3. Bounded loops and escalation

1. A task gets at most `maxRounds` (default 3) rework rounds. Past that, `task.mjs` escalates it.
2. Escalations go to the orchestrator first. It reviews the problem itself, decides, rewrites
   the task, or cancels it.
3. Going over a task's budget is an escalation, including when the orchestrator is the one looping.
4. The orchestrator asks the user only for **critical decisions**:
   - brand, colours and theme on the first run (including whether a dark mode is wanted at all)
   - anything that costs money (paid services, plans, domains)
   - risk of data loss or deleting anything outside the working tree
   - legal, privacy or compliance questions
   - a scope change that contradicts the user's request
   - at intake, product choices the request leaves open that change what gets built (for example
     typing exact numbers as well as using sliders, extra currencies). Ask them once, together, before
     requirements. Never build an unrequested feature to avoid asking.
   - irreversible or outward-facing actions (production deploy, publishing, sending messages)

   Everything else is decided by the agents and recorded in `specs/<feature>/decisions.md`.
5. Effort is proportional to the request. A small tool gets a few acceptance criteria, a few tests and
   the fewest stages that still catch real problems. The orchestrator sizes every task (`--size`), and
   the requirements gate fails a spec with more criteria than that size allows (`acBudget` in
   `dc.config.json`).
6. Never redo verified work. A check that already passed (a test run, an AC verified in an earlier
   round) is cited, not repeated, unless the code it covers changed since.

## 4. User TODOs never block the cycle

1. When work needs something only the user can provide (API keys, accounts, DNS, GitHub settings),
   add an entry to `USER_TODO.md` and keep going.
2. Work that depends on it uses a mock or placeholder marked in code with `USER_TODO #<n>`.
3. The release gate fails while any `USER_TODO #` marker remains. Mocks never ship.

## 5. Security

1. No secrets in git, memory, reports or logs. Secrets live in `.env*` files, which are gitignored.
2. E2E tests use a test-only account. Playwright's saved session lives in `playwright/.auth/`,
   which is gitignored because it holds live cookies.
3. No destructive commands without orchestrator approval: force-push, history rewrites,
   `rm -rf` outside a task worktree, dropping or resetting non-local databases.
4. Any change touching auth, payments, middleware, migrations, env files or infrastructure runs
   on the risky track. `task.mjs` upgrades the track automatically when the diff touches these paths.

## 6. Git

1. One branch per task: `task/<id>-<slug>`. Never commit straight to `main`.
2. Parallel implementers each get their own worktree in `.worktrees/<id>`.
3. The diff against `main` is what gets reviewed. Commit before submitting a report.
4. Conventional commit messages (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
5. A branch merges only after the task reaches `done`.

## 7. Memory and knowledge

1. `memory/` is shared by all agents. Add new dated entries at the end of a file; never rewrite
   or delete someone else's entry. Only the orchestrator merges, prunes or reorganises memory.
2. Decisions go in one place only: `specs/<feature>/decisions.md`, as short ADR entries.
3. Playbooks (`playbooks/<role>.md`) are edited only by the orchestrator. Every rule cites the
   failure that caused it, every change is logged in `playbooks/CHANGES.md`, and each playbook
   stays under `playbookMaxLines`. To add a rule past the cap, merge or remove one first.

## 8. Context discipline

1. At startup each agent reads exactly what `context/<role>.md` lists, plus its task prompt.
2. Hand work to a Haiku worker only with complete, specific instructions. Workers do not decide.
