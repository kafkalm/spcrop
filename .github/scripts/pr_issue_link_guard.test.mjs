import test from 'node:test';
import assert from 'node:assert/strict';

import { hasLinkedIssue } from './pr_issue_link_guard.mjs';

test('accepts closes keyword with local issue number', () => {
  assert.equal(hasLinkedIssue('Resolves #123'), true);
  assert.equal(hasLinkedIssue('fixes #9\nmore text'), true);
});

test('accepts closes keyword with cross-repo issue', () => {
  assert.equal(hasLinkedIssue('Closes kafkalm/rougeflipper#88'), true);
});

test('accepts issue url in body', () => {
  assert.equal(
    hasLinkedIssue('Tracking issue: https://github.com/kafkalm/rougeflipper/issues/42'),
    true,
  );
});

test('rejects body without issue reference', () => {
  assert.equal(hasLinkedIssue('Implement feature without link'), false);
  assert.equal(hasLinkedIssue('Fixes bug but no id'), false);
  assert.equal(hasLinkedIssue(''), false);
});
