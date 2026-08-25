import fs from 'fs';
import path from 'path';
import { RAW_TOOLS_DATA } from '../src/data/tools.js';
import { analyzeCommunityTexts, analyzeRedditPosts, round } from '../src/utils/scoring.js';

const SNAPSHOT_PATH = path.resolve('src/data/tools.json');
const PUBLIC_SNAPSHOT_PATH = path.resolve('public/data/tools.json');
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [800, 2_000];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson(url, options = {}) {
  let lastError;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error.name === 'AbortError' || error.retryable || error.cause?.code;
      if (!retryable || attempt === RETRY_DELAYS_MS.length) break;
      await wait(RETRY_DELAYS_MS[attempt]);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

async function getGithubMetrics(repo) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'vibe-coding-top20-daily-snapshot',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const data = await fetchJson(`https://api.github.com/repos/${repo}`, { headers });
  return {
    githubStars: data.stargazers_count ?? 0,
    githubForks: data.forks_count ?? 0,
    openIssues: data.open_issues_count ?? 0,
    githubWatchers: data.subscribers_count ?? 0,
    pushedAt: data.pushed_at || null,
    githubUpdatedAt: data.updated_at || null
  };
}

async function getOpenVsxMetrics(openVsx) {
  const data = await fetchJson(`https://open-vsx.org/api/${openVsx.namespace}/${openVsx.extension}`, {
    headers: { 'User-Agent': 'vibe-coding-top20-daily-snapshot' }
  });
  return {
    marketplaceDownloads: data.downloadCount ?? data.downloads ?? 0,
    marketplaceRating: data.averageRating ?? data.rating ?? 0
  };
}

async function getVsMarketplaceMetrics(vsMarketplace) {
  const body = {
    filters: [{
      criteria: [{ filterType: 7, value: `${vsMarketplace.publisher}.${vsMarketplace.extension}` }],
      pageNumber: 1,
      pageSize: 1,
      sortBy: 0,
      sortOrder: 0
    }],
    assetTypes: [],
    flags: 914
  };
  const data = await fetchJson('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: {
      Accept: 'application/json;api-version=7.2-preview.1;excludeUrls=true',
      'Content-Type': 'application/json',
      'User-Agent': 'vibe-coding-top20-daily-snapshot'
    },
    body: JSON.stringify(body)
  });
  const extension = data.results?.[0]?.extensions?.[0];
  if (!extension) throw new Error('Extension not found in VS Code Marketplace');
  const stats = Object.fromEntries((extension.statistics || []).map((item) => [item.statisticName, item.value]));
  return {
    marketplaceDownloads: stats.install ?? stats.downloadCount ?? stats.Install ?? 0,
    marketplaceRating: stats.averagerating ?? stats.averageRating ?? 0,
    marketplaceRatingCount: stats.ratingcount ?? 0
  };
}

async function getRedditMetrics(tool) {
  const query = encodeURIComponent(tool.sources?.redditQuery || `${tool.name} AI coding`);
  const data = await fetchJson(
    `https://www.reddit.com/search.json?q=${query}&sort=new&t=week&limit=50&raw_json=1`,
    { headers: { 'User-Agent': 'vibe-coding-top20-daily-snapshot/2.0' } }
  );
  const analysis = analyzeRedditPosts(data?.data?.children || []);
  if (!analysis) throw new Error('No recent Reddit results');
  return analysis;
}

async function getHackerNewsMetrics(tool) {
  const query = encodeURIComponent(tool.name);
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
  const data = await fetchJson(
    `https://hn.algolia.com/api/v1/search_by_date?query=${query}&tags=story&numericFilters=created_at_i%3E${thirtyDaysAgo}&hitsPerPage=50`,
    { headers: { 'User-Agent': 'vibe-coding-top20-daily-snapshot' } }
  );
  const hits = data?.hits || [];
  const analysis = analyzeCommunityTexts(hits.map((hit) => `${hit.title || ''} ${hit.story_text || ''}`));
  if (!analysis) return { hnMentions: 0, hnSentiment: 52, hnPositiveHits: 0, hnNegativeHits: 0 };
  return {
    hnMentions: analysis.mentions,
    hnSentiment: analysis.sentiment,
    hnPositiveHits: analysis.positiveHits,
    hnNegativeHits: analysis.negativeHits
  };
}

function readPreviousSnapshot() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    return Array.isArray(parsed) ? new Map(parsed.map((tool) => [tool.id, tool])) : new Map();
  } catch (error) {
    console.warn(`Previous snapshot unavailable: ${error.message}`);
    return new Map();
  }
}

function numericDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  return current - previous;
}

function combineCommunityMetrics(live, status) {
  const parts = [];
  if (status.reddit === 'ok') {
    parts.push({ mentions: live.redditMentions || 0, sentiment: live.redditSentiment || 52 });
  }
  if (status.hackerNews === 'ok') {
    parts.push({ mentions: live.hnMentions || 0, sentiment: live.hnSentiment || 52 });
  }
  if (!parts.length) return {};

  const communityMentions = parts.reduce((sum, part) => sum + part.mentions, 0);
  const sentimentWeight = Math.max(communityMentions, parts.length);
  const communitySentiment = parts.reduce(
    (sum, part) => sum + part.sentiment * Math.max(part.mentions, 1),
    0
  ) / sentimentWeight;
  return { communityMentions, communitySentiment: round(communitySentiment) };
}

function sourceTasks(tool) {
  const tasks = [
    { name: 'reddit', run: () => getRedditMetrics(tool) },
    { name: 'hackerNews', run: () => getHackerNewsMetrics(tool) }
  ];
  if (tool.sources?.githubRepo) tasks.push({ name: 'github', run: () => getGithubMetrics(tool.sources.githubRepo) });
  if (tool.sources?.openVsx) tasks.push({ name: 'openVsx', run: () => getOpenVsxMetrics(tool.sources.openVsx) });
  if (tool.sources?.vsMarketplace) {
    tasks.push({ name: 'vsMarketplace', run: () => getVsMarketplaceMetrics(tool.sources.vsMarketplace) });
  }
  return tasks;
}

async function getToolSnapshot(tool, previous) {
  console.log(`Updating ${tool.name}`);
  const tasks = sourceTasks(tool);
  const results = await Promise.allSettled(tasks.map((task) => task.run()));
  const now = new Date().toISOString();
  const patch = {};
  const sourceStatus = {};
  const sourceErrors = {};
  const sourceUpdatedAt = { ...(previous?.live?.sourceUpdatedAt || {}) };

  results.forEach((result, index) => {
    const source = tasks[index].name;
    if (result.status === 'fulfilled') {
      Object.assign(patch, result.value);
      sourceStatus[source] = 'ok';
      sourceUpdatedAt[source] = now;
    } else {
      sourceStatus[source] = 'error';
      sourceErrors[source] = String(result.reason?.message || result.reason).slice(0, 160);
    }
  });

  const live = {
    ...tool.live,
    ...previous?.live,
    ...patch,
    sourceUpdatedAt
  };
  Object.assign(live, combineCommunityMetrics(live, sourceStatus));

  const successCount = Object.values(sourceStatus).filter((status) => status === 'ok').length;
  if (successCount) {
    live.updatedAt = now;
    live.lastSuccessfulUpdateAt = now;
  }

  const previousLive = previous?.live || {};
  const trends = {
    githubStarsDelta: numericDelta(live.githubStars, previousLive.githubStars),
    githubForksDelta: numericDelta(live.githubForks, previousLive.githubForks),
    openIssuesDelta: numericDelta(live.openIssues, previousLive.openIssues),
    marketplaceDownloadsDelta: numericDelta(live.marketplaceDownloads, previousLive.marketplaceDownloads),
    communityMentionsDelta: numericDelta(live.communityMentions, previousLive.communityMentions),
    comparedWith: previousLive.updatedAt || null
  };

  return {
    ...tool,
    live,
    trends,
    sourceStatus,
    sourceErrors,
    updateSummary: { attempted: tasks.length, successful: successCount, failed: tasks.length - successCount }
  };
}

function validateSnapshot(updated) {
  if (updated.length !== RAW_TOOLS_DATA.length) {
    throw new Error(`Snapshot count mismatch: expected ${RAW_TOOLS_DATA.length}, received ${updated.length}`);
  }

  const attempted = updated.reduce((sum, tool) => sum + tool.updateSummary.attempted, 0);
  const successful = updated.reduce((sum, tool) => sum + tool.updateSummary.successful, 0);
  const githubSuccesses = updated.filter((tool) => tool.sourceStatus.github === 'ok').length;
  const requiredSuccesses = Math.max(5, Math.floor(attempted * 0.25));

  if (successful < requiredSuccesses) {
    throw new Error(`Only ${successful}/${attempted} source requests succeeded; refusing to publish a stale snapshot`);
  }
  if (githubSuccesses === 0) {
    throw new Error('All GitHub requests failed; refusing to publish the snapshot');
  }

  console.log(`Validation passed: ${successful}/${attempted} sources succeeded; ${githubSuccesses} GitHub repositories refreshed.`);
}

async function main() {
  console.log('Generating daily public-data snapshot for Vibe Coding Top 20...');
  const previousById = readPreviousSnapshot();
  const updated = [];

  // Limit concurrency to avoid rate spikes while keeping the workflow fast.
  for (let index = 0; index < RAW_TOOLS_DATA.length; index += 4) {
    const batch = RAW_TOOLS_DATA.slice(index, index + 4);
    updated.push(...await Promise.all(batch.map((tool) => getToolSnapshot(tool, previousById.get(tool.id)))));
  }

  validateSnapshot(updated);
  const payload = `${JSON.stringify(updated, null, 2)}\n`;
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(PUBLIC_SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, payload);
  fs.writeFileSync(PUBLIC_SNAPSHOT_PATH, payload);
  console.log(`Snapshot written to ${SNAPSHOT_PATH}`);
  console.log(`Public snapshot written to ${PUBLIC_SNAPSHOT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
