// Behavior tests for scripts/select-task.mjs. Run: node --test scripts/test-select-task.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { dependenciesOf, renderBrief, selectTask } from './select-task.mjs';

const issue = (number, labels, extra = {}) => ({
  number,
  title: `Issue ${number}`,
  body: '',
  labels: labels.map((name) => ({ name })),
  ...extra,
});

test('p0 precedes p1 regardless of issue recency', () => {
  const decision = selectTask([issue(5, ['agent:ready', 'p1']), issue(90, ['agent:ready', 'p0'])]);
  assert.equal(decision.kind, 'ready');
  assert.equal(decision.issue.number, 90);
});

test('equal priorities pick the oldest; exact priority labels only', () => {
  const decision = selectTask([
    issue(12, ['agent:ready', 'p1']),
    issue(7, ['agent:ready', 'p1']),
    issue(3, ['agent:ready', 'performance']),
  ]);
  assert.equal(decision.issue.number, 7);
});

test('a single active lock is resumed ahead of ready work', () => {
  const decision = selectTask([issue(2, ['agent:ready', 'p0']), issue(40, ['agent:in-progress', 'p2'])]);
  assert.equal(decision.kind, 'resume');
  assert.equal(decision.issue.number, 40);
});

test('multiple active locks are surfaced as a conflict', () => {
  const decision = selectTask([
    issue(40, ['agent:in-progress', 'p1']),
    issue(41, ['agent:in-progress', 'p1']),
    issue(2, ['agent:ready', 'p0']),
  ]);
  assert.equal(decision.kind, 'conflict');
  assert.deepEqual(decision.issues.map((i) => i.number), [40, 41]);
  assert.match(renderBrief(decision), /#40, #41/);
});

test('blocked, roadmap, and dependency-gated issues are never selected or promoted', () => {
  const issues = [
    issue(113, ['agent:blocked', 'p1'], { body: 'Depends on #112. Keep out of agent:ready.' }),
    issue(131, ['p1'], { title: 'Roadmap: release readiness' }),
    issue(180, ['type:docs'], { body: 'This is a roadmap tracker, **not a claimable implementation issue**.' }),
    issue(156, ['p2'], { body: 'Depends on https://github.com/highda/svg-mapper/issues/155. Promote later.' }),
    issue(155, ['agent:blocked', 'p1']),
    issue(9, ['agent:ready', 'agent:blocked', 'p0']),
  ];
  const decision = selectTask(issues);
  assert.equal(decision.kind, 'none');
  assert.deepEqual(decision.waits.map((w) => w.number), [9, 113, 155, 156]);
  assert.match(renderBrief(decision), /#156 Issue 156: waits on #155/);
});

test('fallback promotes the highest-priority eligible leaf once dependencies close', () => {
  const gated = issue(156, ['p2'], { body: 'Depends on https://github.com/highda/svg-mapper/issues/155.' });
  assert.equal(selectTask([gated, issue(155, ['p1'])]).issue.number, 155);
  const decision = selectTask([gated, issue(300, ['p3'])]);
  assert.equal(decision.kind, 'promote');
  assert.equal(decision.issue.number, 156);
});

test('dependency parsing reads only the Depends on clause', () => {
  const body = 'See #1 for context.\nDepends on #154, https://github.com/o/r/issues/155. Promote after #999 lands.';
  assert.deepEqual(dependenciesOf(issue(177, [], { body })), [154, 155]);
});
