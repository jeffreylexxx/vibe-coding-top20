import { DIMENSION_WEIGHTS } from '../data/tools.js';

const POSITIVE_WORDS = [
  'love',
  'great',
  'best',
  'fast',
  'good',
  'amazing',
  'impressive',
  'useful',
  'smooth',
  'worth',
  'solid',
  'excellent',
  'reliable'
];

const NEGATIVE_WORDS = [
  'bad',
  'slow',
  'bug',
  'broken',
  'expensive',
  'hate',
  'worse',
  'awful',
  'hallucinate',
  'unusable',
  'disappointing',
  'crash',
  'overpriced'
];

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const round = (value, digits = 0) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

export function compactNumber(value = 0) {
  if (!value) return 'N/A';
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: value >= 100000 ? 1 : 0
  }).format(value);
}

function logScore(value = 0, maxValue = 1) {
  if (!value || !maxValue) return 0;
  return clamp((Math.log10(value + 1) / Math.log10(maxValue + 1)) * 100);
}

function issueHealth(tool) {
  const stars = tool.live?.githubStars || 0;
  const issues = tool.live?.openIssues || 0;
  if (!stars || !issues) return 80;
  const pressure = issues / Math.max(stars, 1);
  return clamp(96 - pressure * 900, 48, 96);
}

function normalizeLiveSignals(tools) {
  const maxStars = Math.max(...tools.map((tool) => tool.live?.githubStars || 0), 1);
  const maxForks = Math.max(...tools.map((tool) => tool.live?.githubForks || 0), 1);
  const maxMentions = Math.max(...tools.map((tool) => tool.live?.redditMentions || 0), 1);
  const maxDownloads = Math.max(...tools.map((tool) => tool.live?.marketplaceDownloads || 0), 1);

  return tools.map((tool) => {
    const githubScore = round(
      logScore(tool.live?.githubStars || 0, maxStars) * 0.72 +
        logScore(tool.live?.githubForks || 0, maxForks) * 0.18 +
        issueHealth(tool) * 0.1
    );
    const mentionScore = round(logScore(tool.live?.redditMentions || 0, maxMentions));
    const marketplaceScore = round(
      logScore(tool.live?.marketplaceDownloads || 0, maxDownloads) * 0.72 +
        clamp(((tool.live?.marketplaceRating || 0) / 5) * 100) * 0.28
    );
    const redditSentiment = clamp(tool.live?.redditSentiment ?? 72, 35, 98);
    const socialScore = round(redditSentiment * 0.66 + mentionScore * 0.24 + marketplaceScore * 0.1);

    return {
      ...tool,
      signals: {
        githubScore,
        mentionScore,
        marketplaceScore,
        socialScore,
        issueHealth: round(issueHealth(tool)),
        sourceFreshness: tool.live?.updatedAt ? '实时' : '快照'
      }
    };
  });
}

export function calculateScores(tools) {
  const normalized = normalizeLiveSignals(tools);

  return normalized
    .map((tool) => {
      const dimensions = {
        intelligence: clamp(tool.dimensions.intelligence * 0.82 + tool.signals.socialScore * 0.08 + tool.signals.githubScore * 0.1),
        workflow: clamp(tool.dimensions.workflow * 0.88 + tool.signals.socialScore * 0.12),
        cost: clamp(tool.dimensions.cost),
        context: clamp(tool.dimensions.context * 0.9 + tool.signals.githubScore * 0.1),
        safety: clamp(tool.dimensions.safety * 0.88 + tool.signals.issueHealth * 0.12),
        community: clamp(tool.dimensions.community * 0.55 + tool.signals.socialScore * 0.25 + tool.signals.githubScore * 0.2)
      };

      const score = Object.entries(DIMENSION_WEIGHTS).reduce(
        (sum, [key, weight]) => sum + dimensions[key] * weight,
        0
      );

      return {
        ...tool,
        dimensions,
        score: round(score, 1),
        radar: {
          iq: round(dimensions.intelligence),
          speed: round(dimensions.workflow),
          value: round(dimensions.cost),
          context: round(dimensions.context),
          reputation: round(dimensions.community * 0.72 + (tool.live?.redditSentiment || 72) * 0.28)
        }
      };
    })
    .sort((a, b) => b.score - a.score);
}

function countWordHits(text, words) {
  return words.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
}

export function analyzeRedditPosts(posts = []) {
  if (!posts.length) return null;

  let positive = 0;
  let negative = 0;

  posts.forEach((post) => {
    const data = post?.data || {};
    const text = `${data.title || ''} ${data.selftext || ''}`.toLowerCase();
    positive += countWordHits(text, POSITIVE_WORDS);
    negative += countWordHits(text, NEGATIVE_WORDS);
  });

  const total = Math.max(positive + negative, 1);
  const ratio = positive / total;
  const sentiment = clamp(52 + ratio * 44 + Math.min(posts.length, 30) * 0.3 - negative * 1.2, 38, 96);

  return {
    redditSentiment: round(sentiment),
    redditMentions: posts.length,
    positiveHits: positive,
    negativeHits: negative
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchGithub(tool) {
  const repo = tool.sources?.githubRepo;
  if (!repo) return { patch: {}, status: 'skip' };

  const data = await fetchJson(`https://api.github.com/repos/${repo}`);
  return {
    patch: {
      githubStars: data.stargazers_count || 0,
      githubForks: data.forks_count || 0,
      openIssues: data.open_issues_count || 0,
      pushedAt: data.pushed_at
    },
    status: 'ok'
  };
}

async function fetchOpenVsx(tool) {
  const openVsx = tool.sources?.openVsx;
  if (!openVsx) return { patch: {}, status: 'skip' };

  const data = await fetchJson(`https://open-vsx.org/api/${openVsx.namespace}/${openVsx.extension}`);
  return {
    patch: {
      marketplaceDownloads: data.downloadCount || data.downloads || tool.live?.marketplaceDownloads || 0,
      marketplaceRating: data.averageRating || data.rating || tool.live?.marketplaceRating || 0
    },
    status: 'ok'
  };
}

async function fetchReddit(tool) {
  const query = encodeURIComponent(tool.sources?.redditQuery || `${tool.name} AI coding`);
  const data = await fetchJson(`https://www.reddit.com/search.json?q=${query}&sort=relevance&t=month&limit=30`);
  const posts = data?.data?.children || [];
  const analysis = analyzeRedditPosts(posts);
  return {
    patch: analysis || {},
    status: analysis ? 'ok' : 'empty'
  };
}

export async function enrichToolWithLiveMetrics(tool) {
  const tasks = await Promise.allSettled([fetchGithub(tool), fetchOpenVsx(tool), fetchReddit(tool)]);
  const sourceNames = ['github', 'openVsx', 'reddit'];
  const sourceStatus = {};
  const patch = {};

  tasks.forEach((result, index) => {
    const source = sourceNames[index];
    if (result.status === 'fulfilled') {
      Object.assign(patch, result.value.patch);
      sourceStatus[source] = result.value.status;
    } else {
      sourceStatus[source] = 'error';
    }
  });

  return {
    ...tool,
    live: {
      ...tool.live,
      ...patch,
      updatedAt: new Date().toISOString()
    },
    sourceStatus
  };
}
