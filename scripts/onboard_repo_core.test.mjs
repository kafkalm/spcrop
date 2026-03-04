import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeNotionId,
  defaultTaskDbName,
  buildTaskMirrorProperties,
  defaultPortfolioTitle,
  buildPortfolioProjectProperties,
} from './onboard_repo_core.mjs';

test('normalizeNotionId accepts 32-char id and returns hyphenated UUID', () => {
  const raw = '31424215b1ed8100bbd1d8a3aa91ae79';
  assert.equal(normalizeNotionId(raw), '31424215-b1ed-8100-bbd1-d8a3aa91ae79');
});

test('normalizeNotionId accepts hyphenated UUID and normalizes casing', () => {
  const raw = '31424215-B1ED-8100-BBD1-D8A3AA91AE79';
  assert.equal(normalizeNotionId(raw), '31424215-b1ed-8100-bbd1-d8a3aa91ae79');
});

test('normalizeNotionId throws on invalid input', () => {
  assert.throws(() => normalizeNotionId('not-a-valid-id'), /Invalid Notion ID/);
});

test('defaultTaskDbName uses repo name suffix', () => {
  assert.equal(defaultTaskDbName('kafkalm/Bossman'), 'Task Mirror DB - Bossman');
});

test('buildTaskMirrorProperties contains required keys', () => {
  const props = buildTaskMirrorProperties();

  assert.ok(props.Title);
  assert.ok(props['GitHub Item Key']);
  assert.ok(props['GitHub Issue ID']);
  assert.ok(props.Repo);
  assert.ok(props.Status);
  assert.ok(props.Priority);
  assert.ok(props.Estimate);
  assert.ok(props.Blocked);
  assert.ok(props['GitHub URL']);
  assert.ok(props['PR URL']);
  assert.ok(props['Work Type']);
  assert.ok(props['Last Synced At']);

  const statusNames = props.Status.select.options.map((o) => o.name);
  assert.deepEqual(statusNames, ['Planned', 'Doing', 'Reviewing', 'Blocked', 'Done']);
});

test('defaultPortfolioTitle uses repo name suffix', () => {
  assert.equal(defaultPortfolioTitle('kafkalm/rougeflipper'), 'rougeflipper');
});

test('buildPortfolioProjectProperties creates stable project key row', () => {
  const props = buildPortfolioProjectProperties({
    repo: 'kafkalm/rougeflipper',
    syncedAt: '2026-02-27T12:00:00.000Z',
  });

  assert.equal(props.Title.title[0].text.content, 'rougeflipper');
  assert.equal(props['Project Key'].rich_text[0].text.content, 'kafkalm/rougeflipper');
  assert.equal(props.Status.select.name, 'Active');
  assert.equal(props.Health, undefined);
  assert.equal(props['Repository URL'].url, 'https://github.com/kafkalm/rougeflipper');
  assert.equal(props['Last Synced At'].date.start, '2026-02-27T12:00:00.000Z');
});
