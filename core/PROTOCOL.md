# Handoff Protocol (LOCKED)

How every agent receives work, reports back, uses memory and delegates. Read with `core/RULES.md`.

## 1. What a task prompt contains

The orchestrator (or a lead, for Haiku workers) always gives:

```
Task: T-0007 · <title>
Stage: review · Round: 2 · Track: standard · Size: small (AC budget 8)
Root: /abs/path/to/project            # tasks/, specs/, memory/, reports/ live here
Worktree: /abs/path/.worktrees/T-0007 # where the code for this task is checked out
Branch: task/T-0007-login-form
Spec: specs/login-form/
Report to: reports/inbox/T-0007-review-r2.json
Scope: AC-15..AC-18                  # the acceptance criteria this task adds or changes
Start from: src/App.tsx, src/calc.ts # files from the last report's artifacts, or "find them"
Previous gate result: <reasons from the last failed round, verbatim, or "none">
Instructions: <what to do>
```

Spec, memory and report paths are relative to **Root**. Code paths are relative to **Worktree**.
Size says how much work the request deserves. Scale your output to it: a small task gets a short
spec, a few tests and a brief report. If anything you need is missing, say so in your report. Don't guess.

Put the round from your prompt in your report. If it is off, the harness corrects it and warns; a report
written before the stage was last started is rejected as stale.

## 2. Startup

1. Read `context/<your-agent-name>.md` and exactly the files it lists. Nothing else up front.
2. Read `playbooks/<your-agent-name>.md`. Its rules come from past failures; follow them.
3. Read only the ACs in **Scope**, not the whole spec, and start from the files in **Start from**.
   Open more only when the code leads you there, and only within what your role may see.

## 3. Stage reports (leads only)

Write one JSON file to the **Report to** path, matching its schema in `core/schemas/`:

| Stage | Schema |
|---|---|
| review | `report-review.schema.json` |
| security | `report-security.schema.json` |
| qa | `report-qa.schema.json` |
| tests | `report-tests.schema.json` |
| everything else | `report-generic.schema.json` |

Required on every report: `taskId`, `stage`, `role`, `round`, `verdict` (`pass`/`fail`), `summary` (≤2000 chars).
Optional: `artifacts` (paths you produced), `returnTo` (an earlier stage, on fail), `askOrchestrator`
(a question or a request for the orchestrator to review something you're unsure about).

Be honest. The gate checks your claims. A `pass` on a failing gate is logged as **contradicted**.
Calling `fail` with a clear reason is always better than a false `pass`.

Do not submit the report yourself. The orchestrator does that.

## 4. What you return to your parent

Your final message is short. The detail lives in the report file.

```
REPORT: reports/inbox/T-0007-review-r2.json
VERDICT: pass | fail
SUMMARY: <1-3 sentences>
MEMORY: <files you added entries to, or "none">
USER_TODO: <numbers you added, or "none">
ASK: <question for the orchestrator, or "none">
```

## 5. Delegating to Haiku workers (leads only)

Workers: `dc-scout` (finds and summarises code), `dc-runner` (runs commands, reports raw results),
`dc-fixer` (makes exact mechanical edits), `dc-scribe` (writes docs and notes from given facts).

- Start every worker prompt with the `Task: <id> · <title>` line, so its usage is charged to the task.
- Give complete instructions: exact files, exact change, exact command. Workers don't make decisions.
- Never let a worker decide whether something passed. Read `EXIT_CODE` yourself.
- Check a worker's edits before you report on them. You own the result.
- Do the work yourself when explaining it would take longer than doing it.

Workers return:

```
STATUS: done | failed | unclear
EXIT_CODE: <raw exit code, for commands>
RESULT: <the facts; failing test names and errors copied word for word>
```

## 6. Memory

Before starting, skim `memory/important.md` and `memory/caveats.md` if your context file lists them.
Add an entry (format in `memory/README.md`) when you learn something another agent would otherwise
have to rediscover: a trap, a constraint, a convention. Don't log routine progress; that's in reports.

## 7. User TODOs

If you need something only the user can provide, add a row to `USER_TODO.md` (next free number),
put a mock or placeholder in code marked `USER_TODO #<n>`, and carry on. Never stop and wait.
