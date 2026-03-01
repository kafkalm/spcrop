import fs from 'node:fs';

const CLOSING_KEYWORD_ISSUE_REGEX = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+\b/i;
const ISSUE_URL_REGEX = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+\b/i;

export function hasLinkedIssue(body = '') {
  const text = String(body || '');
  return CLOSING_KEYWORD_ISSUE_REGEX.test(text) || ISSUE_URL_REGEX.test(text);
}

function loadPrBodyFromEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH is required');
  }

  const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const body = payload?.pull_request?.body || '';
  return body;
}

function main() {
  const body = loadPrBodyFromEvent();
  if (hasLinkedIssue(body)) {
    console.log('PR body includes linked issue reference.');
    return;
  }

  console.error('PR must link an Issue. Add e.g. `Resolves #123` or issue URL in PR body.');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  }
}
