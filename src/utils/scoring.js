import { DIMENSION_WEIGHTS } from '../data/tools.js';

const POSITIVE_WORDS = [
  'love', 'great', 'best', 'fast', 'good', 'amazing', 'impressive', 'useful',
  'smooth', 'worth', 'solid', 'excellent', 'reliable', 'improved', 'recommend'
];

const NEGATIVE_WORDS = [
  'bad', 'slow', 'bug', 'broken', 'expensive', 'hate', 'worse', 'awful',
  'hallucinate', 'unusable', 'disappointing', 'crash', 'overpriced', 'regression'
];

export const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export const round = (value, digits = 0) => {
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
  if (!Number.isFinite(value) || value <= 0 || maxValue <= 0) return 0;
  return clamp((Math.log10(value + 1) / Math.log10(maxValue + 1)) * 100);
}

function weightedAverage(items, fallback) {
  const valid = items.filter(({ value, weight }) => Number.isFinite(value) && weight > 0);
  if (!valid.length) return fallback;
  const weightTotal = valid.reduce((sum, item) => sum + item.weight, 0);
  return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / weightTotal;
}

function issueHealth(tool) {
  const stars = tool.live?.githubStars;
  const issues = tool.live?.openIssues;
  if (!Number.isFinite(stars) || !Number.isFinite(issues) || stars <= 0) return null;
  const pressure = issues / Math.max(stars, 1);
  return clamp(96 - pressure * 900, 45, 96);
}

function activityRecency(tool) {
  const pushedAt = tool.live?.pushedAt;
  if (!pushedAt) return null;
  const ageDays = (Date.now() - new Date(pushedAt).getTime()) / 86400000;
  if (!Number.isFinite(ageDays)) return null;
  if (ageDays <= 2) return 100;
  if (ageDays <= 7) return 92;
  if (ageDays <= 30) return 78;
  if (ageDays <= 90) return 60;
  return 40;
}

function freshnessScore(tool) {
  const value = tool.live?.lastSuccessfulUpdateAt || tool.live?.updatedAt;
  if (!value) return 35;
  const ageHours = (Date.now() - new Date(value).getTime()) / 3600000;
  if (!Number.isFinite(ageHours)) return 35;
  if (ageHours <= 36) return 100;
  if (ageHours <= 72) return 82;
  if (ageHours <= 168) return 60;
  return 35;
}

function normalizeLiveSignals(tools) {
  const maxStars = Math.max(...tools.map((tool) => tool.live?.githubStars || 0), 1);
  const maxForks = Math.max(...tools.map((tool) => tool.live?.githubForks || 0), 1);
  const maxMentions = Math.max(...tools.map((tool) => tool.live?.communityMentions || tool.live?.redditMentions || 0), 1);
  const maxDownloads = Math.max(...tools.map((tool) => tool.live?.marketplaceDownloads || 0), 1);
  const maxStarGrowth = Math.max(...tools.map((tool) => Math.max(tool.trends?.githubStarsDelta || 0, 0)), 1);
  const maxDownloadGrowth = Math.max(...tools.map((tool) => Math.max(tool.trends?.marketplaceDownloadsDelta || 0, 0)), 1);

  return tools.map((tool) => {
    const hasGithub = Boolean(tool.sources?.githubRepo && Number.isFinite(tool.live?.githubStars));
    const hasMarketplace = Boolean(
      (tool.sources?.openVsx || tool.sources?.vsMarketplace) &&
      Number.isFinite(tool.live?.marketplaceDownloads)
    );
    const communityMentions = tool.live?.communityMentions ?? tool.live?.redditMentions;
    const communitySentiment = tool.live?.communitySentiment ?? tool.live?.redditSentiment;
    const hasCommunity = Number.isFinite(communityMentions) && Number.isFinite(communitySentiment);
    const health = issueHealth(tool);
    const recency = activityRecency(tool);
    const freshness = freshnessScore(tool);

    const githubScore = hasGithub
      ? round(weightedAverage([
          { value: logScore(tool.live.githubStars, maxStars), weight: 0.48 },
          { value: logScore(tool.live.githubForks || 0, maxForks), weight: 0.14 },
          { value: health, weight: 0.12 },
          { value: recency, weight: 0.16 },
          { value: logScore(Math.max(tool.trends?.githubStarsDelta || 0, 0), maxStarGrowth), weight: 0.1 }
        ], 70))
      : null;

    const marketplaceScore = hasMarketplace
      ? round(weightedAverage([
          { value: logScore(tool.live.marketplaceDownloads || 0, maxDownloads), weight: 0.62 },
          {
            value: Number.isFinite(tool.live.marketplaceRating) && tool.live.marketplaceRating > 0
              ? clamp((tool.live.marketplaceRating / 5) * 100)
              : null,
            weight: 0.25
          },
          { value: logScore(Math.max(tool.trends?.marketplaceDownloadsDelta || 0, 0), maxDownloadGrowth), weight: 0.13 }
        ], 70))
      : null;

    const mentionScore = hasCommunity ? round(logScore(communityMentions, maxMentions)) : null;
    const socialScore = hasCommunity
      ? round(weightedAverage([
          { value: clamp(communitySentiment, 35, 98), weight: 0.68 },
          { value: mentionScore, weight: 0.32 }
        ], 70))
      : null;

    // Missing sources are excluded instead of treated as zero, so proprietary tools are not unfairly punished.
    const publicSignalScore = round(weightedAverage([
      { value: githubScore, weight: 0.4 },
      { value: socialScore, weight: 0.4 },
      { value: marketplaceScore, weight: 0.2 }
    ], 70), 1);

    const attempted = Object.values(tool.sourceStatus || {}).filter((status) => status !== 'skip').length;
    const successful = Object.values(tool.sourceStatus || {}).filter((status) => status === 'ok').length;

    return {
      ...tool,
      signals: {
        githubScore,
        mentionScore,
        marketplaceScore,
        socialScore,
        publicSignalScore,
        issueHealth: health == null ? null : round(health),
        activityRecency: recency,
        freshness,
        coverage: attempted ? round((successful / attempted) * 100) : 0,
        sourceFreshness: freshness >= 82 ? '最新' : freshness >= 60 ? '近期' : '过期'
      }
    };
  });
}

export function calculateScores(tools) {
  const normalized = normalizeLiveSignals(tools);

  return normalized
    .map((tool) => {
      const github = tool.signals.githubScore;
      const social = tool.signals.socialScore;
      const marketplace = tool.signals.marketplaceScore;
      const publicSignals = tool.signals.publicSignalScore;
      const communityLive = weightedAverage([
        { value: social, weight: 0.5 },
        { value: github, weight: 0.3 },
        { value: marketplace, weight: 0.2 }
      ], tool.dimensions.community);

      const dimensions = {
        intelligence: clamp(tool.dimensions.intelligence * 0.88 + publicSignals * 0.12),
        workflow: clamp(tool.dimensions.workflow * 0.78 + weightedAverage([
          { value: tool.signals.activityRecency, weight: 0.6 },
          { value: publicSignals, weight: 0.4 }
        ], tool.dimensions.workflow) * 0.22),
        cost: clamp(tool.dimensions.cost),
        context: clamp(tool.dimensions.context * 0.88 + (github ?? tool.dimensions.context) * 0.12),
        safety: clamp(tool.dimensions.safety * 0.86 + (tool.signals.issueHealth ?? tool.dimensions.safety) * 0.14),
        community: clamp(tool.dimensions.community * 0.45 + communityLive * 0.55)
      };

      const dimensionScore = Object.entries(DIMENSION_WEIGHTS).reduce(
        (sum, [key, weight]) => sum + dimensions[key] * weight,
        0
      );
      // 82% product capability + 18% current public evidence keeps the ranking responsive without becoming a popularity contest.
      const score = dimensionScore * 0.82 + publicSignals * 0.18;

      return {
        ...tool,
        dimensions,
        score: round(score, 1),
        radar: {
          iq: round(dimensions.intelligence),
          speed: round(dimensions.workflow),
          value: round(dimensions.cost),
          context: round(dimensions.context),
          reputation: round(dimensions.community * 0.75 + publicSignals * 0.25)
        }
      };
    })
    .sort((a, b) => b.score - a.score);
}

function countWordHits(text, words) {
  return words.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
}

export function analyzeCommunityTexts(texts = []) {
  const cleanTexts = texts.map((text) => String(text || '').toLowerCase()).filter(Boolean);
  if (!cleanTexts.length) return null;

  let positive = 0;
  let negative = 0;
  cleanTexts.forEach((text) => {
    positive += countWordHits(text, POSITIVE_WORDS);
    negative += countWordHits(text, NEGATIVE_WORDS);
  });

  const total = Math.max(positive + negative, 1);
  const sentiment = clamp(52 + (positive / total) * 40 + Math.min(cleanTexts.length, 50) * 0.18 - negative, 38, 96);
  return { sentiment: round(sentiment), mentions: cleanTexts.length, positiveHits: positive, negativeHits: negative };
}

export function analyzeRedditPosts(posts = []) {
  const result = analyzeCommunityTexts(posts.map((post) => `${post?.data?.title || ''} ${post?.data?.selftext || ''}`));
  if (!result) return null;
  return {
    redditSentiment: result.sentiment,
    redditMentions: result.mentions,
    positiveHits: result.positiveHits,
    negativeHits: result.negativeHits
  };
}
