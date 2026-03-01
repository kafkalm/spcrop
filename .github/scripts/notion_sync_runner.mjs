import fs from 'node:fs';
import {
  buildTaskProperties,
  ensurePortfolioTaskRelation,
  toTaskPayloadFromIssue,
  upsertPortfolioProjectPage,
  upsertTaskPage,
} from './notion_sync_core.mjs';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function loadEventPayload() {
  const eventPath = requireEnv('GITHUB_EVENT_PATH');
  const raw = fs.readFileSync(eventPath, 'utf8');
  return JSON.parse(raw);
}

async function githubRequest(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'codex-notion-sync',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API failed: ${response.status} ${text}`);
  }

  return response.json();
}

function extractClosingIssueNumbers(body = '') {
  const numbers = new Set();
  const regex = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)\b/gi;
  for (const match of body.matchAll(regex)) {
    const number = Number(match[1]);
    if (Number.isInteger(number) && number > 0) {
      numbers.add(number);
    }
  }
  return [...numbers];
}

async function toSyncInputs({ payload, repo, githubToken }) {
  if (payload.issue) {
    if (payload.issue.pull_request) {
      return [];
    }
    return [toTaskPayloadFromIssue({ repo, issue: payload.issue })];
  }

  if (payload.pull_request) {
    const pr = payload.pull_request;
    const linkedIssueNumbers = extractClosingIssueNumbers(pr.body || '');
    if (!linkedIssueNumbers.length) {
      return [];
    }

    const results = [];
    for (const issueNumber of linkedIssueNumbers) {
      const issue = await githubRequest(`/repos/${repo}/issues/${issueNumber}`, githubToken);
      if (issue.pull_request) {
        continue;
      }
      results.push({
        ...toTaskPayloadFromIssue({ repo, issue }),
        url: issue.html_url,
        prUrl: pr.html_url,
        prNumber: pr.number,
        hasOpenPr: pr.state === 'open',
        doneAt: pr.merged_at || issue.closed_at || null,
        syncedAt: new Date().toISOString(),
      });
    }

    return results;
  }

  return [];
}

async function main() {
  const notionToken = requireEnv('NOTION_TOKEN');
  const taskDbId = requireEnv('NOTION_TASK_DB_ID');
  const portfolioDbId = requireEnv('NOTION_PORTFOLIO_DB_ID');
  const repo = requireEnv('GITHUB_REPOSITORY');
  const githubToken = requireEnv('GITHUB_TOKEN');

  const payload = loadEventPayload();
  const syncInputs = await toSyncInputs({ payload, repo, githubToken });

  if (!syncInputs.length) {
    console.log('No issue/pr payload found. Skip.');
    return;
  }

  const portfolioProject = await upsertPortfolioProjectPage({
    token: notionToken,
    dbId: portfolioDbId,
    repo,
  });
  let synced = 0;
  for (const syncInput of syncInputs) {
    const properties = buildTaskProperties({
      ...syncInput,
      projectPageId: portfolioProject.id,
    });
    const result = await upsertTaskPage({ token: notionToken, dbId: taskDbId, properties });
    await ensurePortfolioTaskRelation({
      token: notionToken,
      portfolioPageId: portfolioProject.id,
      taskPageId: result.id,
    });
    console.log(`Notion ${result.mode}: ${result.id}`);
    console.log(`Synced ${repo}#${syncInput.number}`);
    if (result.deduped) {
      console.log(`Task deduped: archived ${result.deduped} duplicate pages`);
    }
    synced += 1;
  }
  console.log(`Portfolio ${portfolioProject.mode}: ${portfolioProject.id}`);
  console.log(`Synced total rows: ${synced}`);
  if (portfolioProject.deduped) {
    console.log(`Portfolio deduped: archived ${portfolioProject.deduped} duplicate pages`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
