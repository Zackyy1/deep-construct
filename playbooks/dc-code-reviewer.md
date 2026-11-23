# Playbook: dc-code-reviewer

Rules learned from real failures. Edited only by the orchestrator. Max lines: see `playbookMaxLines`
in `dc.config.json`. To add a rule past the cap, merge or remove one first. Log every change in `playbooks/CHANGES.md`.

<!-- Format:
## P-001 · 2026-11-23 · cause: reports/archive/T-0003/review-r1.json
<The rule, one or two sentences, phrased as an instruction.>
-->

## P-001 · 2026-11-23 · cause: my-test-app reports/archive/T-0002/review-r1.json
Review the diff against the ACs in Scope and run the project's own checks (typecheck, lint, tests). Don't
start dev servers, open a browser or write probe scripts: that is QA's job. (T-0002 review r1 took 32 turns
doing both.)
