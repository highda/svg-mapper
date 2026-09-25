#!/usr/bin/env node
// Deterministic task selection shared by scripts/codex-loop.sh and the manual
// procedure in AGENTS.md §4. Reads open issues as `gh issue list --json
// number,title,url,body,labels` output on stdin and prints a decision as JSON.
//
//   more than one agent:in-progress  -> conflict (surface, never pick)
//   exactly one                      -> resume it
//   else eligible agent:ready leaves -> sort by exact p0..p3, then oldest
//   else eligible prioritized leaves -> promote the first one to agent:ready
//   else                             -> none (report parked external waits)
//
// Eligible means open, not agent:blocked, not a roadmap tracker, and every
// "Depends on" issue is closed (absent from the open list).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PRIORITY = /^p([0-3])$/;

const labelNames = (issue) => (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));

export function priorityOf(issue) {
  for (const name of labelNames(issue)) {
    const match = PRIORITY.exec(name);
    if (match) return Number(match[1]);
  }
  return null;
}

export function isRoadmap(issue) {
  return (
    /^roadmap\b/i.test(issue.title ?? '') ||
    labelNames(issue).some((name) => name === 'roadmap' || name === 'type:roadmap') ||
    /not a claimable implementation issue/i.test(issue.body ?? '')
  );
}

export function dependenciesOf(issue) {
  const deps = new Set();
  for (const line of (issue.body ?? '').split(/\r?\n/)) {
    const at = line.search(/depends on\b/i);
    if (at < 0) continue;
    // Only the clause after "Depends on", up to the end of its sentence.
    const clause = line.slice(at).split(/\.(?:\s|$)/)[0];
    for (const match of clause.matchAll(/(?:issues\/|#)(\d+)/g)) deps.add(Number(match[1]));
  }
  deps.delete(issue.number);
  return [...deps].sort((a, b) => a - b);
}

const byPriorityThenAge = (a, b) =>
  (priorityOf(a) ?? 99) - (priorityOf(b) ?? 99) || a.number - b.number;

export function selectTask(issues) {
  const open = new Set(issues.map((issue) => issue.number));
  const has = (issue, name) => labelNames(issue).includes(name);
  const summary = (issue) => ({ number: issue.number, title: issue.title });

  const active = issues.filter((issue) => has(issue, 'agent:in-progress')).sort((a, b) => a.number - b.number);
  if (active.length > 1) return { kind: 'conflict', issues: active.map(summary) };
  if (active.length === 1) return { kind: 'resume', issue: active[0] };

  const unmet = (issue) => dependenciesOf(issue).filter((n) => open.has(n));
  const eligible = (issue) => !has(issue, 'agent:blocked') && !isRoadmap(issue) && unmet(issue).length === 0;

  const ready = issues.filter((issue) => has(issue, 'agent:ready') && eligible(issue)).sort(byPriorityThenAge);
  if (ready.length) return { kind: 'ready', issue: ready[0] };

  const promotable = issues.filter((issue) => priorityOf(issue) !== null && eligible(issue)).sort(byPriorityThenAge);
  if (promotable.length) return { kind: 'promote', issue: promotable[0] };

  return {
    kind: 'none',
    waits: issues
      .filter((issue) => has(issue, 'agent:blocked') || (!isRoadmap(issue) && unmet(issue).length))
      .sort((a, b) => a.number - b.number)
      .map((issue) => ({ ...summary(issue), blocked: has(issue, 'agent:blocked'), dependsOn: unmet(issue) })),
  };
}

export function renderBrief(decision) {
  const issueJson = (issue) => JSON.stringify(issue, null, 2);
  switch (decision.kind) {
    case 'resume':
      return `# Assigned task: resume #${decision.issue.number}\n\nThis issue holds the serial lock. Continue it (AGENTS.md §4, resuming an active task).\n\n${issueJson(decision.issue)}\n`;
    case 'ready':
    case 'promote':
      return `# Assigned task: claim #${decision.issue.number}\n\nThe highest-priority eligible ready issue. Re-check the lock, then claim it (AGENTS.md §4).\n\n${issueJson(decision.issue)}\n`;
    case 'conflict':
      return `# Serial lock conflict\n\nMore than one open issue carries agent:in-progress: ${decision.issues.map((i) => `#${i.number}`).join(', ')}. Do not start new work. Resolve the conflict per AGENTS.md §2 first.\n\n${JSON.stringify(decision.issues, null, 2)}\n`;
    default: {
      const lines = decision.waits.map((w) =>
        `- #${w.number} ${w.title}: ${w.blocked ? 'parked (agent:blocked)' : `waits on ${w.dependsOn.map((n) => `#${n}`).join(', ')}`}`,
      );
      return `# No eligible task\n\nNo open issue is active, ready, or promotable. Do not invent scope; perform the finite goal assessment in .codex/GOAL.md.\n\nRemaining waits:\n${lines.join('\n') || '- none'}\n`;
    }
  }
}

function main(argv) {
  const briefAt = argv.indexOf('--brief');
  const decision = selectTask(JSON.parse(readFileSync(0, 'utf8')));
  if (briefAt >= 0) writeFileSync(argv[briefAt + 1], renderBrief(decision));
  process.stdout.write(`${JSON.stringify({ kind: decision.kind, number: decision.issue?.number ?? null, ...(decision.issues ? { issues: decision.issues } : {}), ...(decision.waits ? { waits: decision.waits } : {}) })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
