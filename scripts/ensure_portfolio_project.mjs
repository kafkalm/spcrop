import {
  buildPortfolioProjectProperties,
  normalizeNotionId,
  notionHeaders,
} from './onboard_repo_core.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function notionRequest(path, { token, method = 'GET', body = undefined }) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: notionHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Notion API ${method} ${path} failed: ${response.status} ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

async function findPortfolioProjectPage({ token, portfolioDbId, projectKey }) {
  const result = await notionRequest(`/databases/${portfolioDbId}/query`, {
    token,
    method: 'POST',
    body: {
      page_size: 100,
      filter: {
        property: 'Project Key',
        rich_text: {
          equals: projectKey,
        },
      },
    },
  });

  return result.results || [];
}

function selectCanonicalAndDuplicates(pages = []) {
  if (!pages.length) {
    return { canonical: null, duplicates: [] };
  }
  const sorted = [...pages].sort((a, b) => {
    const ta = a.created_time || '';
    const tb = b.created_time || '';
    if (ta !== tb) return ta.localeCompare(tb);
    return (a.id || '').localeCompare(b.id || '');
  });
  return { canonical: sorted[0], duplicates: sorted.slice(1) };
}

async function archivePages({ token, pages = [] }) {
  for (const page of pages) {
    await notionRequest(`/pages/${page.id}`, {
      token,
      method: 'PATCH',
      body: { archived: true },
    });
  }
}

async function upsertPortfolioProjectPage({ token, portfolioDbId, repo }) {
  const properties = buildPortfolioProjectProperties({
    repo,
    syncedAt: new Date().toISOString(),
  });

  const all = await findPortfolioProjectPage({
    token,
    portfolioDbId,
    projectKey: repo,
  });
  const { canonical, duplicates } = selectCanonicalAndDuplicates(all);

  if (canonical) {
    const updated = await notionRequest(`/pages/${canonical.id}`, {
      token,
      method: 'PATCH',
      body: { properties },
    });
    if (duplicates.length) {
      await archivePages({ token, pages: duplicates });
    }
    return { mode: 'updated', id: updated.id, url: updated.url, deduped: duplicates.length };
  }

  const created = await notionRequest('/pages', {
    token,
    method: 'POST',
    body: {
      parent: { database_id: portfolioDbId },
      properties,
    },
  });

  return { mode: 'created', id: created.id, url: created.url, deduped: 0 };
}

async function main() {
  const token = required('NOTION_TOKEN');
  const portfolioDbId = normalizeNotionId(required('NOTION_PORTFOLIO_DB_ID'));
  const repo = required('TARGET_REPO');

  const result = await upsertPortfolioProjectPage({
    token,
    portfolioDbId,
    repo,
  });

  process.stdout.write(`${JSON.stringify({
    repo,
    portfolio_project_mode: result.mode,
    portfolio_project_id: result.id,
    portfolio_project_url: result.url,
    portfolio_project_deduped: result.deduped,
  })}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
