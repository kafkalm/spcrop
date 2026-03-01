import {
  buildTaskProperties,
  ensurePortfolioTaskRelation,
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

async function githubRequest(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'codex-notion-reconcile',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API failed: ${response.status} ${text}`);
  }

  return response.json();
}

function sinceIso(days) {
  const now = Date.now();
  const delta = days * 24 * 60 * 60 * 1000;
  return new Date(now - delta).toISOString();
}

async function main() {
  const notionToken = requireEnv('NOTION_TOKEN');
  const taskDbId = requireEnv('NOTION_TASK_DB_ID');
  const portfolioDbId = requireEnv('NOTION_PORTFOLIO_DB_ID');
  const githubToken = requireEnv('GITHUB_TOKEN');
  const repo = requireEnv('GITHUB_REPOSITORY');
  const days = Number(process.env.RECONCILE_DAYS || '30');

  const portfolioProject = await upsertPortfolioProjectPage({
    token: notionToken,
    dbId: portfolioDbId,
    repo,
  });

  const issues = await githubRequest(
    `/repos/${repo}/issues?state=all&since=${encodeURIComponent(sinceIso(days))}&per_page=100`,
    githubToken,
  );

  let synced = 0;
  for (const issue of issues) {
    if (issue.pull_request) {
      continue;
    }
    const properties = buildTaskProperties({
      repo,
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      issueState: issue.state,
      labels: issue.labels || [],
      body: issue.body || '',
      prUrl: null,
      prNumber: null,
      hasOpenPr: false,
      createdAt: issue.created_at || null,
      doneAt: issue.closed_at || null,
      syncedAt: new Date().toISOString(),
      projectPageId: portfolioProject.id,
    });

    const result = await upsertTaskPage({ token: notionToken, dbId: taskDbId, properties });
    await ensurePortfolioTaskRelation({
      token: notionToken,
      portfolioPageId: portfolioProject.id,
      taskPageId: result.id,
    });
    synced += 1;
  }

  console.log(`Reconciled ${synced} items for ${repo}`);
  console.log(`Portfolio ${portfolioProject.mode}: ${portfolioProject.id}`);
  if (portfolioProject.deduped) {
    console.log(`Portfolio deduped: archived ${portfolioProject.deduped} duplicate pages`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
