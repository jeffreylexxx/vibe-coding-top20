import fs from 'fs';
import path from 'path';
import { RAW_TOOLS_DATA } from '../src/data/tools.js';
import { analyzeRedditPosts } from '../src/utils/scoring.js';

const SNAPSHOT_PATH = path.resolve('src/data/tools.json');

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getGithubMetrics(repo) {
  if (!repo) return {};
  const data = await fetchJson(`https://api.github.com/repos/${repo}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ai-code-showdown-snapshot'
    }
  });

  return {
    githubStars: data.stargazers_count || 0,
    githubForks: data.forks_count || 0,
    openIssues: data.open_issues_count || 0,
    pushedAt: data.pushed_at
  };
}

async function getOpenVsxMetrics(openVsx) {
  if (!openVsx) return {};
  const data = await fetchJson(`https://open-vsx.org/api/${openVsx.namespace}/${openVsx.extension}`);

  return {
    marketplaceDownloads: data.downloadCount || data.downloads || 0,
    marketplaceRating: data.averageRating || data.rating || 0
  };
}

async function getVsMarketplaceMetrics(vsMarketplace) {
  if (!vsMarketplace) return {};

  const body = {
    filters: [
      {
        criteria: [
          { filterType: 7, value: `${vsMarketplace.publisher}.${vsMarketplace.extension}` }
        ],
        pageNumber: 1,
        pageSize: 1,
        sortBy: 0,
        sortOrder: 0
      }
    ],
    assetTypes: [],
    flags: 914
  };

  const data = await fetchJson('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: {
      Accept: 'application/json;api-version=7.2-preview.1;excludeUrls=true',
      'Content-Type': 'application/json',
      'User-Agent': 'ai-code-showdown-snapshot'
    },
    body: JSON.stringify(body)
  });

  const extension = data.results?.[0]?.extensions?.[0];
  if (!extension) return {};

  const stats = Object.fromEntries((extension.statistics || []).map((item) => [item.statisticName, item.value]));
  return {
    marketplaceDownloads: stats.install || stats.downloadCount || stats.Install || 0,
    marketplaceRating: stats.averagerating || stats.averageRating || 0
  };
}

async function getRedditMetrics(tool) {
  const query = encodeURIComponent(tool.sources?.redditQuery || `${tool.name} AI coding`);
  const data = await fetchJson(`https://www.reddit.com/search.json?q=${query}&sort=relevance&t=month&limit=30`, {
    headers: {
      'User-Agent': 'ai-code-showdown-snapshot'
    }
  });

  return analyzeRedditPosts(data?.data?.children || []) || {};
}

async function getToolSnapshot(tool) {
  console.log(`Updating ${tool.name}`);
  const tasks = await Promise.allSettled([
    getGithubMetrics(tool.sources?.githubRepo),
    getOpenVsxMetrics(tool.sources?.openVsx),
    getVsMarketplaceMetrics(tool.sources?.vsMarketplace),
    getRedditMetrics(tool)
  ]);

  const patch = {};
  tasks.forEach((task) => {
    if (task.status === 'fulfilled') Object.assign(patch, task.value);
  });

  return {
    ...tool,
    live: {
      ...tool.live,
      ...patch,
      updatedAt: new Date().toISOString()
    }
  };
}

async function main() {
  console.log('Generating public-data snapshot for AI Code Showdown...');
  const updated = [];

  for (const tool of RAW_TOOLS_DATA) {
    updated.push(await getToolSnapshot(tool));
  }

  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`Snapshot written to ${SNAPSHOT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
