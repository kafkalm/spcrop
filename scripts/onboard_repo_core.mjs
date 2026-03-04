const NOTION_ID_REGEX = /^[0-9a-fA-F]{32}$/;
const NOTION_UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function normalizeNotionId(input) {
  const raw = String(input || '').trim();

  if (NOTION_UUID_REGEX.test(raw)) {
    return raw.toLowerCase();
  }

  const compact = raw.replace(/-/g, '');
  if (!NOTION_ID_REGEX.test(compact)) {
    throw new Error(`Invalid Notion ID: ${input}`);
  }

  return compact.replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5',
  ).toLowerCase();
}

export function defaultTaskDbName(repo) {
  const name = String(repo || '').split('/').pop() || 'Repository';
  return `Task Mirror DB - ${name}`;
}

export function defaultPortfolioTitle(repo) {
  return String(repo || '').split('/').pop() || 'Repository';
}

export function buildGithubRepoUrl(repo) {
  return `https://github.com/${repo}`;
}

export function buildPortfolioProjectProperties({ repo, syncedAt = new Date().toISOString() }) {
  const title = defaultPortfolioTitle(repo);
  return {
    Title: {
      title: [{ text: { content: title.slice(0, 1900) } }],
    },
    'Project Key': {
      rich_text: [{ text: { content: repo } }],
    },
    Status: {
      select: { name: 'Active' },
    },
    'Repository URL': {
      url: buildGithubRepoUrl(repo),
    },
    'Last Synced At': {
      date: { start: syncedAt },
    },
  };
}

export function buildTaskMirrorProperties() {
  return {
    Title: { title: {} },
    'GitHub Item Key': { rich_text: {} },
    'GitHub Issue ID': { number: { format: 'number' } },
    Repo: { select: { options: [] } },
    Status: {
      select: {
        options: [
          { name: 'Planned', color: 'default' },
          { name: 'Doing', color: 'blue' },
          { name: 'Reviewing', color: 'purple' },
          { name: 'Blocked', color: 'red' },
          { name: 'Done', color: 'green' },
        ],
      },
    },
    Priority: {
      select: {
        options: [
          { name: 'P0', color: 'red' },
          { name: 'P1', color: 'orange' },
          { name: 'P2', color: 'yellow' },
          { name: 'P3', color: 'green' },
        ],
      },
    },
    Estimate: {
      select: {
        options: [
          { name: 'XS', color: 'gray' },
          { name: 'S', color: 'brown' },
          { name: 'M', color: 'blue' },
          { name: 'L', color: 'purple' },
          { name: 'XL', color: 'pink' },
        ],
      },
    },
    Blocked: { checkbox: {} },
    'GitHub URL': { url: {} },
    'PR URL': { url: {} },
    'Work Type': {
      select: {
        options: [
          { name: 'feature', color: 'blue' },
          { name: 'bug', color: 'red' },
          { name: 'chore', color: 'gray' },
          { name: 'research', color: 'purple' },
        ],
      },
    },
    'Last Synced At': { date: {} },
  };
}

export function notionHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };
}
