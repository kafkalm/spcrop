import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferPriority,
  inferWorkType,
  mapNotionStatus,
  buildTaskProperties,
  buildGithubItemKey,
  buildPortfolioProjectProperties,
} from './notion_sync_core.mjs';

test('inferPriority maps labels to priority', () => {
  assert.equal(inferPriority([{ name: 'prio:p0' }]), 'P0');
  assert.equal(inferPriority([{ name: 'prio:p1' }]), 'P1');
  assert.equal(inferPriority([{ name: 'something-else' }]), 'P2');
});

test('inferWorkType maps labels to work type', () => {
  assert.equal(inferWorkType([{ name: 'type:bug' }]), 'bug');
  assert.equal(inferWorkType([{ name: 'type:feature' }]), 'feature');
  assert.equal(inferWorkType([]), 'chore');
});

test('mapNotionStatus resolves blocked and done first', () => {
  assert.equal(mapNotionStatus({ issueState: 'open', labels: [{ name: 'blocked' }] }), 'Blocked');
  assert.equal(mapNotionStatus({ issueState: 'closed', labels: [] }), 'Done');
  assert.equal(mapNotionStatus({ issueState: 'open', labels: [{ name: 'status:review' }] }), 'Reviewing');
});

test('buildGithubItemKey is deterministic', () => {
  assert.equal(buildGithubItemKey('kafkalm/Bossman', 123), 'kafkalm/Bossman#123');
});

test('buildTaskProperties creates required Notion fields', () => {
  const props = buildTaskProperties({
    repo: 'kafkalm/Bossman',
    number: 77,
    title: 'Test title',
    url: 'https://github.com/kafkalm/Bossman/issues/77',
    issueState: 'open',
    labels: [{ name: 'type:feature' }, { name: 'prio:p1' }],
    body: 'Estimate: L',
    createdAt: '2026-02-20T00:00:00.000Z',
    doneAt: '2026-02-22T12:00:00.000Z',
    syncedAt: '2026-02-23T00:00:00.000Z',
    projectPageId: '31424215-b1ed-81d0-8d66-df4193c5838e',
  });

  assert.equal(props['GitHub Issue ID'].number, 77);
  assert.equal(props.Repo.select.name, 'kafkalm/Bossman');
  assert.equal(props.Priority.select.name, 'P1');
  assert.equal(props.Estimate.select.name, 'L');
  assert.equal(props['Work Type'].select.name, 'feature');
  assert.equal(props['GitHub Item Key'].rich_text[0].text.content, 'kafkalm/Bossman#77');
  assert.equal(props['Created At'].date.start, '2026-02-20T00:00:00.000Z');
  assert.equal(props['Started At'].date.start, '2026-02-20T00:00:00.000Z');
  assert.equal(props['Done At'].date.start, '2026-02-22T12:00:00.000Z');
  assert.equal(props['Cycle Hours'], undefined);
  assert.equal(props['Lead Hours'], undefined);
  assert.equal(props['Done In Last 7d'], undefined);
  assert.equal(props['GitHub PR ID'], undefined);
  assert.deepEqual(props['Portfolio DB'].relation, [{ id: '31424215-b1ed-81d0-8d66-df4193c5838e' }]);
});

test('buildPortfolioProjectProperties creates stable project row properties', () => {
  const props = buildPortfolioProjectProperties({
    repo: 'kafkalm/rougeflipper',
    syncedAt: '2026-02-27T12:00:00.000Z',
  });

  assert.equal(props.Title.title[0].text.content, 'rougeflipper');
  assert.equal(props['Project Key'].rich_text[0].text.content, 'kafkalm/rougeflipper');
  assert.equal(props.Status.select.name, 'Active');
  assert.equal(props['Repository URL'].url, 'https://github.com/kafkalm/rougeflipper');
  assert.equal(props['Last Synced At'].date.start, '2026-02-27T12:00:00.000Z');
});

test('buildTaskProperties keeps timeline fields empty for planned open issue', () => {
  const props = buildTaskProperties({
    repo: 'kafkalm/Bossman',
    number: 78,
    title: 'Backlog item',
    url: 'https://github.com/kafkalm/Bossman/issues/78',
    issueState: 'open',
    labels: [{ name: 'status:backlog' }],
    body: '',
    createdAt: '2026-02-20T00:00:00.000Z',
    syncedAt: '2026-02-23T00:00:00.000Z',
  });

  assert.equal(props.Status.select.name, 'Planned');
  assert.equal(props['Created At'].date.start, '2026-02-20T00:00:00.000Z');
  assert.equal(props['Started At'].date, null);
  assert.equal(props['Done At'].date, null);
  assert.equal(props['Cycle Hours'], undefined);
  assert.equal(props['Lead Hours'], undefined);
  assert.equal(props['Done In Last 7d'], undefined);
  assert.equal(props['GitHub PR ID'], undefined);
});

test('buildTaskProperties writes GitHub PR ID when provided', () => {
  const props = buildTaskProperties({
    repo: 'kafkalm/Bossman',
    number: 79,
    title: 'PR linked issue',
    url: 'https://github.com/kafkalm/Bossman/issues/79',
    issueState: 'open',
    labels: [],
    body: '',
    prUrl: 'https://github.com/kafkalm/Bossman/pull/100',
    prNumber: 100,
    createdAt: '2026-02-20T00:00:00.000Z',
    syncedAt: '2026-02-23T00:00:00.000Z',
  });

  assert.equal(props['GitHub PR ID'].number, 100);
  assert.equal(props['PR URL'].url, 'https://github.com/kafkalm/Bossman/pull/100');
});
