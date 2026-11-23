#!/usr/bin/env node
// PreToolUse guard. Enforces harness/lib/policy.mjs for every agent. Fails closed: if the
// policy can't be evaluated, the call is denied. Set DC_MAINTAINER=1 when launching Claude Code
// to edit the harness itself.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { loadConfig } from '../../harness/lib/config.mjs';
import { ORCHESTRATOR, decideWrite, decideRead, decideBash, decidePlaybookSize, splitWorktree } from '../../harness/lib/policy.mjs';

const ALLOW = { allow: true };

function respondDeny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[deep-construct] ${reason}` },
  }));
}

function applyEdits(original, edits) {
  return edits.reduce((text, e) => (e.replace_all
    ? text.split(e.old_string).join(e.new_string)
    : text.replace(e.old_string, e.new_string)), original);
}

function newContent(tool, input, abs) {
  if (tool === 'Write') return input.content ?? '';
  const original = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  if (tool === 'Edit') return applyEdits(original, [input]);
  if (tool === 'MultiEdit') return applyEdits(original, input.edits ?? []);
  return original;
}

// A worktree's tests belong to the test engineer only when its task runs the tests stage.
// Unknown task or unreadable state: stay strict.
function engineerOwnsTests(root, rel) {
  const wt = splitWorktree(rel);
  if (!wt) return true;
  try {
    const task = JSON.parse(readFileSync(resolve(root, 'tasks', `${wt.taskDir}.json`), 'utf8'));
    return task.stages.includes('tests');
  } catch {
    return true;
  }
}

function decide({ tool, input, role, root, cwd, config }) {
  const toRel = (p) => relative(root, resolve(cwd, p)).split(sep).join('/') || '.';

  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const abs = resolve(cwd, input.file_path ?? input.notebook_path ?? '');
    const rel = toRel(abs);
    const write = decideWrite({ role, rel, exists: existsSync(abs), config, engineerOwnsTests: engineerOwnsTests(root, rel) });
    if (!write.allow) return write;
    return decidePlaybookSize({ rel, content: newContent(tool, input, abs), maxLines: config.playbookMaxLines });
  }
  if (tool === 'Bash') return decideBash({ role, command: input.command ?? '', cwd, root });
  if (tool === 'Read') return decideRead({ role, rel: toRel(input.file_path ?? ''), kind: 'file', config });
  if (tool === 'Grep' || tool === 'Glob') {
    const abs = resolve(cwd, input.path ?? '.');
    const kind = existsSync(abs) && statSync(abs).isFile() ? 'file' : 'dir';
    return decideRead({ role, rel: toRel(abs), kind, config });
  }
  return ALLOW;
}

function main() {
  if (process.env.DC_MAINTAINER === '1') return;
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? input.cwd);
  const result = decide({
    tool: input.tool_name,
    input: input.tool_input ?? {},
    role: input.agent_type || ORCHESTRATOR,
    root,
    cwd: resolve(input.cwd ?? root),
    config: loadConfig(root),
  });
  if (!result.allow) respondDeny(result.reason);
}

try {
  main();
} catch (err) {
  respondDeny(`guard could not evaluate this call, so it is blocked: ${err.message}`);
}
