import React, { useEffect, useMemo, useState } from 'react';
import {
  DATA_SOURCES,
  DIMENSION_LABELS,
  DIMENSION_WEIGHTS,
  RAW_TOOLS_DATA
} from './data/tools';
import TOOLS_SNAPSHOT from './data/tools.json';
import { calculateScores, compactNumber } from './utils/scoring';

const sortOptions = [
  { id: 'score', label: '综合排名' },
  { id: 'intelligence', label: '智力质量' },
  { id: 'workflow', label: '响应速度' },
  { id: 'cost', label: '性价比' },
  { id: 'context', label: '上下文' },
  { id: 'community', label: '社区热度' }
];

const radarLabels = [
  ['iq', '智商'],
  ['speed', '速度'],
  ['value', '性价比'],
  ['context', '上下文'],
  ['reputation', '口碑']
];

const INITIAL_TOOLS = Array.isArray(TOOLS_SNAPSHOT) && TOOLS_SNAPSHOT.length ? TOOLS_SNAPSHOT : RAW_TOOLS_DATA;

function formatDate(value) {
  if (!value) return '未刷新';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatDelta(value) {
  if (!Number.isFinite(value) || value === 0) return '—';
  return `${value > 0 ? '+' : ''}${compactNumber(value)}`;
}

function statusTone(status) {
  if (status === 'ok') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'error') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (status === 'empty') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-zinc-50 text-zinc-500 border-zinc-200';
}

function SourceBadge({ label, status }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-1 text-[11px] font-medium ${statusTone(status)}`}>
      {label}: {status || 'skip'}
    </span>
  );
}

function RadarChart({ tool, size = 190 }) {
  const center = size / 2;
  const radius = size * 0.34;
  const levels = [0.25, 0.5, 0.75, 1];

  const point = (index, value = 100) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / radarLabels.length;
    const distance = radius * (value / 100);
    return [center + Math.cos(angle) * distance, center + Math.sin(angle) * distance];
  };

  const polygon = radarLabels
    .map(([key], index) => point(index, tool.radar[key]).join(','))
    .join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-[190px] w-[190px]" role="img" aria-label={`${tool.name} 雷达图`}>
      {levels.map((level) => (
        <polygon
          key={level}
          points={radarLabels.map((_, index) => point(index, level * 100).join(',')).join(' ')}
          fill="none"
          stroke="#d4d4d8"
          strokeWidth="1"
        />
      ))}
      {radarLabels.map(([, label], index) => {
        const [x, y] = point(index, 120);
        const [x2, y2] = point(index, 100);
        return (
          <g key={label}>
            <line x1={center} y1={center} x2={x2} y2={y2} stroke="#e4e4e7" strokeWidth="1" />
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-zinc-600 text-[10px] font-semibold"
            >
              {label}
            </text>
          </g>
        );
      })}
      <polygon points={polygon} fill={tool.color} fillOpacity="0.22" stroke={tool.color} strokeWidth="2.5" />
      {radarLabels.map(([key], index) => {
        const [x, y] = point(index, tool.radar[key]);
        return <circle key={key} cx={x} cy={y} r="3.5" fill={tool.color} />;
      })}
    </svg>
  );
}

function SentimentBar({ value }) {
  const safeValue = Math.max(0, Math.min(100, value || 0));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
        <span>吐槽</span>
        <span className="font-semibold text-zinc-900">{safeValue}% 喜爱</span>
        <span>推荐</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-gradient-to-r from-red-400 via-amber-300 to-emerald-500">
        <div
          className="h-full border-r-4 border-zinc-950 bg-white/35"
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}

function DimensionBars({ tool }) {
  return (
    <div className="grid gap-2">
      {Object.entries(DIMENSION_LABELS).map(([key, label]) => (
        <div key={key} className="grid grid-cols-[92px_1fr_34px] items-center gap-2 text-xs">
          <span className="truncate text-zinc-500">{label}</span>
          <div className="h-2 overflow-hidden rounded bg-zinc-200">
            <div className="h-full rounded" style={{ width: `${tool.dimensions[key]}%`, backgroundColor: tool.color }} />
          </div>
          <span className="text-right font-semibold text-zinc-800">{Math.round(tool.dimensions[key])}</span>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-zinc-950">{value}</div>
    </div>
  );
}

function ToolCard({ tool, rank, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(tool.id)}
      className={`grid w-full gap-4 rounded-lg border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        active ? 'border-zinc-950 ring-2 ring-zinc-950/10' : 'border-zinc-200'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-700">
              #{rank}
            </span>
            <span className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-500">{tool.type}</span>
          </div>
          <h3 className="mt-3 truncate text-lg font-bold text-zinc-950">{tool.name}</h3>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-600">{tool.description}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-3xl font-black tabular-nums" style={{ color: tool.color }}>
            {tool.score}
          </div>
          <div className="text-[11px] text-zinc-500">综合分</div>
        </div>
      </div>

      <SentimentBar value={tool.live?.communitySentiment ?? tool.live?.redditSentiment} />

      <div className="grid grid-cols-4 gap-3 border-t border-zinc-100 pt-3">
        <Metric label="Stars" value={compactNumber(tool.live?.githubStars)} />
        <Metric label="Forks" value={compactNumber(tool.live?.githubForks)} />
        <Metric label="近期待讨论" value={tool.live?.communityMentions ?? tool.live?.redditMentions ?? 'N/A'} />
        <Metric label="Stars 日增量" value={formatDelta(tool.trends?.githubStarsDelta)} />
      </div>
    </button>
  );
}

export default function App() {
  const [rawTools, setRawTools] = useState(INITIAL_TOOLS);
  const [sortBy, setSortBy] = useState('score');
  const [selectedId, setSelectedId] = useState(INITIAL_TOOLS[0].id);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLog, setRefreshLog] = useState('已载入构建时公开数据快照。');

  const scoredTools = useMemo(() => calculateScores(rawTools), [rawTools]);

  const visibleTools = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = keyword
      ? scoredTools.filter((tool) =>
          [tool.name, tool.vendor, tool.type, tool.description, ...(tool.tags || [])]
            .join(' ')
            .toLowerCase()
            .includes(keyword)
        )
      : scoredTools;

    return [...filtered].sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score;
      return (b.dimensions?.[sortBy] || 0) - (a.dimensions?.[sortBy] || 0);
    });
  }, [query, scoredTools, sortBy]);

  const selectedTool = scoredTools.find((tool) => tool.id === selectedId) || visibleTools[0] || scoredTools[0];
  const leader = scoredTools[0];
  const openSourceCount = rawTools.filter((tool) => tool.tags?.includes('Open Source')).length;
  const liveCoverage = rawTools.filter((tool) => tool.sources?.githubRepo || tool.sources?.openVsx).length;

  const refreshMetrics = async () => {
    setRefreshing(true);
    setRefreshLog('正在读取本站数据快照，避免浏览器跨域与 API 限流错误。');

    try {
      const response = await fetch(`${import.meta.env.BASE_URL}data/tools.json?ts=${Date.now()}`, {
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const snapshot = await response.json();
      if (!Array.isArray(snapshot) || !snapshot.length) {
        throw new Error('数据快照为空');
      }

      setRawTools(snapshot);
      const newest = snapshot
        .map((tool) => tool.live?.lastSuccessfulUpdateAt || tool.live?.updatedAt)
        .filter(Boolean)
        .sort()
        .at(-1);
      setRefreshLog(`已读取公开数据快照：${snapshot.length} 个工具；最近更新时间 ${formatDate(newest)}。`);
    } catch (error) {
      setRefreshLog(`快照读取失败，继续使用内置数据：${error.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refreshMetrics();
  }, []);

  useEffect(() => {
    if (!visibleTools.some((tool) => tool.id === selectedId) && visibleTools[0]) {
      setSelectedId(visibleTools[0].id);
    }
  }, [selectedId, visibleTools]);

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">AI Coding App Live Ranking</div>
              <h1 className="mt-2 text-3xl font-black tracking-normal text-zinc-950 md:text-5xl">
                AI 编程工具实时打分排名
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 md:text-base">
                每日抓取 GitHub、Reddit、Hacker News、Open VSX 与 VS Code Marketplace 的公开指标，并结合产品能力基线动态生成排名。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={refreshMetrics}
                disabled={refreshing}
                className="rounded-lg border border-zinc-950 bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
              >
                {refreshing ? '读取中' : '读取数据快照'}
              </button>
              <a
                href="https://api.github.com"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:border-zinc-950"
              >
                数据 API
              </a>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 md:gap-3">
            <div className="min-w-0 rounded-lg border border-zinc-200 bg-[#f9fafb] p-2 md:p-4">
              <div className="truncate text-[10px] uppercase tracking-wide text-zinc-500 md:text-xs">收录工具</div>
              <div className="mt-1 text-xl font-black md:mt-2 md:text-3xl">{rawTools.length}</div>
            </div>
            <div className="min-w-0 rounded-lg border border-zinc-200 bg-[#f9fafb] p-2 md:p-4">
              <div className="truncate text-[10px] uppercase tracking-wide text-zinc-500 md:text-xs">开源工具</div>
              <div className="mt-1 text-xl font-black md:mt-2 md:text-3xl">{openSourceCount}</div>
            </div>
            <div className="min-w-0 rounded-lg border border-zinc-200 bg-[#f9fafb] p-2 md:p-4">
              <div className="truncate text-[10px] uppercase tracking-wide text-zinc-500 md:text-xs">可实时拉取</div>
              <div className="mt-1 text-xl font-black md:mt-2 md:text-3xl">{liveCoverage}</div>
            </div>
            <div className="min-w-0 rounded-lg border border-zinc-200 bg-[#f9fafb] p-2 md:p-4">
              <div className="truncate text-[10px] uppercase tracking-wide text-zinc-500 md:text-xs">当前第一</div>
              <div className="mt-1 truncate text-lg font-black md:mt-2 md:text-3xl">{leader?.name}</div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_390px] lg:px-8">
        <section className="grid gap-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索工具、厂商、类型或标签"
                className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-zinc-950"
              />
              <div className="flex flex-wrap gap-2">
                {sortOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSortBy(option.id)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      sortBy === option.id
                        ? 'border-zinc-950 bg-zinc-950 text-white'
                        : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-950'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-500">{refreshLog}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {visibleTools.map((tool, index) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                rank={scoredTools.findIndex((item) => item.id === tool.id) + 1}
                active={selectedTool?.id === tool.id}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        </section>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Selected Tool</div>
                <h2 className="mt-2 truncate text-2xl font-black">{selectedTool.name}</h2>
                <p className="mt-1 text-sm text-zinc-500">{selectedTool.vendor} · {selectedTool.status}</p>
              </div>
              <div className="text-right">
                <div className="text-4xl font-black" style={{ color: selectedTool.color }}>
                  {selectedTool.score}
                </div>
                <div className="text-[11px] text-zinc-500">综合分</div>
              </div>
            </div>

            <div className="mt-5 flex justify-center border-y border-zinc-100 py-4">
              <RadarChart tool={selectedTool} />
            </div>

            <div className="mt-5">
              <SentimentBar value={selectedTool.live?.communitySentiment ?? selectedTool.live?.redditSentiment} />
            </div>

            <div className="mt-5">
              <DimensionBars tool={selectedTool} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Metric label="GitHub Stars" value={compactNumber(selectedTool.live?.githubStars)} />
              <Metric label="Forks" value={compactNumber(selectedTool.live?.githubForks)} />
              <Metric label="Stars 日增量" value={formatDelta(selectedTool.trends?.githubStarsDelta)} />
              <Metric label="近期社区讨论" value={selectedTool.live?.communityMentions ?? selectedTool.live?.redditMentions ?? 'N/A'} />
            </div>

            <p className="mt-4 text-xs leading-5 text-zinc-500">
              最近成功更新：{formatDate(selectedTool.live?.lastSuccessfulUpdateAt || selectedTool.live?.updatedAt)} · 数据覆盖 {selectedTool.signals?.coverage ?? 0}%
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <SourceBadge label="GitHub" status={selectedTool.sourceStatus?.github || (selectedTool.sources?.githubRepo ? 'snapshot' : 'skip')} />
              <SourceBadge label="Reddit" status={selectedTool.sourceStatus?.reddit || 'snapshot'} />
              <SourceBadge label="Hacker News" status={selectedTool.sourceStatus?.hackerNews || 'snapshot'} />
              <SourceBadge label="OpenVSX" status={selectedTool.sourceStatus?.openVsx || (selectedTool.sources?.openVsx ? 'snapshot' : 'skip')} />
              <SourceBadge label="VS Marketplace" status={selectedTool.sourceStatus?.vsMarketplace || (selectedTool.sources?.vsMarketplace ? 'snapshot' : 'skip')} />
            </div>

            <a
              href={selectedTool.officialUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex w-full items-center justify-center rounded-lg border border-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-950 hover:text-white"
            >
              打开官网 / 仓库
            </a>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-[0.16em] text-zinc-500">Scoring Formula</h2>
            <div className="mt-4 grid gap-2">
              {Object.entries(DIMENSION_WEIGHTS).map(([key, weight]) => (
                <div key={key} className="grid grid-cols-[1fr_48px] items-center gap-3 text-sm">
                  <span className="text-zinc-700">{DIMENSION_LABELS[key]}</span>
                  <span className="text-right font-bold">{Math.round(weight * 100)}%</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-zinc-500">
              综合分由 82% 产品能力维度与 18% 当日公开信号合成；公开信号包含活跃度、热度、评分、近期讨论和日增量。缺失来源不按 0 分处理，避免惩罚闭源产品。
            </p>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-[0.16em] text-zinc-500">Live Sources</h2>
            <div className="mt-4 grid gap-3">
              {DATA_SOURCES.map((source) => (
                <a
                  key={source.name}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-zinc-200 p-3 transition hover:border-zinc-950"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-zinc-950">{source.name}</span>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${source.live ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
                      {source.live ? '可直连' : '快照抓取'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{source.signal}</p>
                </a>
              ))}
            </div>
          </section>
        </aside>
      </main>

      <footer className="border-t border-zinc-200 bg-white px-4 py-5 text-center text-xs text-zinc-500">
        AI Code Showdown · GitHub Pages ready · 数据由脚本或 GitHub Actions 抓取公开来源后生成快照
      </footer>
    </div>
  );
}
