# deep-construct

A multi-agent development engine for [Claude Code](https://claude.com/claude-code). You start an app
from it, describe what you want, and a team of specialised agents takes each feature from
requirements to a merged, reviewed, tested branch. An orchestrator runs the team, and gates
decide whether work moves forward.

## Why

A single coding agent writes code, then judges its own work, and tends to declare success.
deep-construct is built around the opposite assumptions:

- **Nobody grades their own work.** Whoever wrote a diff never reviews it. Tests are written
  from the spec before the implementation exists, by an agent that never reads the implementation.
  Reviewers start from a fresh context with only the spec and the diff.
- **Gates read facts, not claims.** A stage passes on exit codes, findings and acceptance
  criteria. An agent that reports `pass` on a failing gate is logged as *contradicted*.
- **Loops are bounded.** Each task gets a limited number of rework rounds and a budget in USD.
  Past either, it escalates to the orchestrator instead of spinning.
- **You're only interrupted for what matters.** The team asks you only about critical decisions:
  brand, money, data loss, legal, scope changes, anything irreversible. Anything only you can do
  (API keys, accounts, DNS) goes into `USER_TODO.md`, and work continues with a marked mock.
  The release gate fails while any mock is left.
- **It learns from its failures.** Each role has a playbook of rules. A rule is added only for a
  failure that actually happened, with a citation, and every playbook has a line cap.

## How it works

```
you ──► orchestrator (Opus) ──► task.mjs creates a task, branch and worktree
                │
                ├─► stage agent (Sonnet lead, may use Haiku workers) ──► report ──► gate
                │        pass → next stage · fail → rework · over limits → escalate
                ▼
            sign-off ──► merge to main ──► changelog, memory, playbook updates
```

**Tracks.** Each task runs on a track that sets its stages:

| Track | Use for | Stages |
|---|---|---|
| `trivial` | copy, styling, config, tiny fixes | implementation → review → signoff |
| `standard` | any new or changed behaviour | requirements → ux → architecture → tests → implementation → review → qa → release → docs → signoff |
| `risky` | auth, payments, personal data, migrations, infra, CI | standard + a security review |

A task is moved to `risky` automatically when its diff touches a risky path (`riskyPaths` in
`dc.config.json`).

**The team** (`.claude/agents/`):

| Agent | Role |
|---|---|
| orchestrator (main session) | Plans, routes, judges gates, answers escalations, signs off. Never writes product code. |
| `dc-requirements` | User stories and numbered acceptance criteria (`AC-n`) |
| `dc-ux-lead` | Screens, states, copy, visual rules; owns the brand |
| `dc-architect` | Stack, data model, contracts, implementation steps |
| `dc-test-engineer` | Tests from spec and contracts only, before the code exists |
| `dc-implementer` | Production code until tests, lint and typecheck pass |
| `dc-code-reviewer` | Correctness, readability, architecture fit, spec coverage |
| `dc-security-reviewer` | Auth, injection, secrets, data exposure (risky track) |
| `dc-qa-tester` | Clicks through every AC in a real browser with Playwright |
| `dc-release` | CI, env vars, migrations, staging deploy, smoke test |
| `dc-docs` | README, API docs and setup notes that match what was built |
| `dc-scout`, `dc-runner`, `dc-fixer`, `dc-scribe` | Haiku workers for searching, running commands, mechanical edits and notes |

**Enforcement.** Two hooks back the rules up:
- `guard.mjs` (on every tool call) blocks writes to locked files, tester access to implementation
  source, shared state edited inside worktrees, and destructive commands.
- `track-usage.mjs` (when a subagent finishes) prices each subagent's tokens and charges them to its task.

## Getting started

Requirements: Node.js 22.5 or later and git.

### The office (in development)

You work with deep-construct through **the office**, a local 2D app in the browser. You type
what you want into a prompt window, then watch the team work: agents at their desks, reports
handed between them, escalations, spending. You answer the orchestrator's questions in the
same window. No terminal is needed. In the background, the office runs your own installed
Claude Code (signed in with your own account) with the app's agents, hooks and rules loaded.
The office never sees your credentials.

The office is being built on the `office` branch. Until it lands, the team runs in a Claude Code
terminal session (see below).

### 1. Start an app

Each app is a separate repository. It gets a snapshot of the engine with no history or remote
pointing back here.

```bash
git clone <this repo> deep-construct
node deep-construct/harness/bin/init.mjs ~/code/my-app
npm --prefix ~/code/my-app/harness install
```

`init` copies the engine as committed at `HEAD` and writes the engine's version and commit into
the app's `dc.config.json` under `engine`. It refuses a target folder that isn't empty.

### 2. Ask for what you want

Describe the app or feature. The orchestrator splits it into tasks, picks tracks and runs the
stages. On the first run of a product with a UI, it asks you to choose a brand direction.

Until the office lands, run `claude` in the app folder and type your request there.

### 3. Check in when you like

| What | Where |
|---|---|
| Task state | `node harness/bin/task.mjs list` / `show <id>` |
| Spending | `node harness/bin/task.mjs usage [<id>]` |
| Things only you can do | `USER_TODO.md` |
| What shipped and why | `CHANGELOG.md` |
| Requirements, designs, decisions | `specs/<feature>/` |
| What the team has learned | `memory/`, `playbooks/` |

## Configuration

`dc.config.json` holds the project settings: `checks` (the typecheck, lint and test commands the
gates run), `maxRounds`, `budgetsUsd` per track, `riskyPaths`, `testPaths` and `contractPaths`,
`markerScanDirs` for leftover mocks, `playbookMaxLines` and model prices for usage estimates.

## Locked files and maintainer mode

`core/`, `.claude/`, `harness/`, `CLAUDE.md` and `dc.config.json` are locked for every agent,
including the orchestrator. To change them yourself, start Claude Code in maintainer mode:

```bash
DC_MAINTAINER=1 claude
```

Agents that think a rule is wrong write a proposal in `memory/important.md`, and the
orchestrator raises it with you.

## Engine versions

An app stays on the engine version it was started with. Engine updates are never pulled into a
running project. To use a newer engine, start a new project from it and bring your source,
specs and memory over by hand. That way a project's rules never change under a task in progress.

## Layout

```
core/            locked rules, handoff protocol, orchestrator manual, report schemas
.claude/         agent definitions, hooks, settings
context/         what each agent reads at startup
playbooks/       learned rules per role (+ CHANGES.md)
harness/         task state machine, gates and CLI (task.mjs, init.mjs) with tests
memory/          shared knowledge: brand, caveats, important notes
specs/           one folder per feature
tasks/ reports/  runtime state (gitignored)
```

## Developing the engine

```bash
npm --prefix harness install
npm --prefix harness test
```

Work on the engine in maintainer mode (`DC_MAINTAINER=1 claude`). The office IDE, a 2D visual
interface for watching and steering the team, is being built on the `office` branch.
