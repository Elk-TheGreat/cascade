import * as store from './store.js';

const n = (id, type, label, x, y, data = {}) => ({ id, type, position: { x, y }, data: { label, ...data } });
const e = (id, source, target, sourceHandle = null) => ({ id, source, target, sourceHandle, targetHandle: null });

const DEMOS = [
  {
    name: 'Morning brief',
    description: 'Fetch the front page of Hacker News every weekday at 08:00 and shape a short brief.',
    cron: '0 8 * * 1-5',
    enabled: true,
    graph: {
      nodes: [
        n('start', 'trigger.schedule', 'Weekdays 08:00', 80, 160, { cron: '0 8 * * 1-5', timezone: 'UTC', enabled: true }),
        n('fetch', 'core.http', 'Fetch front page', 340, 160, { method: 'GET', url: 'https://hn.algolia.com/api/v1/search?tags=front_page', headers: '{}', query: '{}', bodyType: 'none', parse: 'auto', timeoutSeconds: 30 }),
        n('shape', 'core.js', 'Pick top stories', 600, 160, {
          label: 'Pick top stories',
          code: "const hits = input.body?.hits ?? [];\nconst stories = hits.slice(0, 8).map((h) => ({ title: h.title, points: h.points, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}` }));\nconsole.log(`picked ${stories.length} stories`);\nreturn { count: stories.length, stories };",
          timeoutSeconds: 30,
        }),
        n('brief', 'core.transform', 'Format brief', 860, 160, {
          label: 'Format brief',
          expression: "`${input.count} stories today\\n\\n` + input.stories.map((s, i) => `${i + 1}. ${s.title} (${s.points} points)`).join('\\n')",
        }),
      ],
      edges: [e('e1', 'start', 'fetch'), e('e2', 'fetch', 'shape'), e('e3', 'shape', 'brief')],
    },
  },
  {
    name: 'Repo pulse',
    description: 'Check a repository\'s stars and flag it when it crosses a threshold.',
    enabled: false,
    graph: {
      nodes: [
        n('start', 'trigger.manual', 'Start', 80, 160, { note: 'Run it when you want a pulse check.' }),
        n('fetch', 'core.http', 'Read repo stats', 340, 160, { method: 'GET', url: 'https://api.github.com/repos/facebook/react', headers: '{"accept":"application/vnd.github+json"}', query: '{}', bodyType: 'none', parse: 'auto', timeoutSeconds: 30 }),
        n('pick', 'core.js', 'Extract numbers', 600, 160, {
          label: 'Extract numbers',
          code: 'const repo = input.body ?? {};\nreturn { name: repo.full_name, stars: repo.stargazers_count, forks: repo.forks_count, openIssues: repo.open_issues_count };',
          timeoutSeconds: 30,
        }),
        n('check', 'core.condition', 'Over 100k stars?', 860, 160, { label: 'Over 100k stars?', expression: 'number(input.stars) > 100000' }),
        n('hot', 'core.transform', 'Flag as major', 1120, 60, { label: 'Flag as major', expression: '({ ...input, tier: "major" })' }),
        n('steady', 'core.transform', 'Keep on watch', 1120, 260, { label: 'Keep on watch', expression: '({ ...input, tier: "steady" })' }),
      ],
      edges: [
        e('e1', 'start', 'fetch'), e('e2', 'fetch', 'pick'), e('e3', 'pick', 'check'),
        e('e4', 'check', 'hot', 'true'), e('e5', 'check', 'steady', 'false'),
      ],
    },
  },
  {
    name: 'Batch scoring',
    description: 'Score a batch of numbers in Python inside a For each, then aggregate the results.',
    enabled: false,
    graph: {
      nodes: [
        n('start', 'trigger.manual', 'Start', 80, 200, { note: 'Tries the loop runtime.' }),
        n('seed', 'core.js', 'Build batch', 340, 200, {
          label: 'Build batch',
          code: 'return { batch: [12, 4, 38, 7, 21, 3, 44, 9] };',
          timeoutSeconds: 30,
        }),
        n('loop', 'core.loop', 'Score each value', 600, 200, { label: 'Score each value', items: '{{ steps.build_batch.json.batch }}', maxIterations: 100 }),
        n('score', 'core.python', 'Score value', 860, 120, {
          label: 'Score value',
          code: '# item is the current value, index its position\nscore = round(float(item) ** 1.5, 2)\nprint("scored", item, "->", score)\nresult = {"value": item, "score": score, "band": "high" if score > 100 else "low"}',
          timeoutSeconds: 30,
        }),
        n('end', 'core.loopEnd', 'End item', 1120, 120, { label: 'End item' }),
        n('summary', 'core.js', 'Summarise batch', 1120, 320, {
          label: 'Summarise batch',
          code: 'const rows = input.results ?? [];\nconst high = rows.filter((r) => r.band === "high").length;\nreturn { count: rows.length, high, average: rows.reduce((a, r) => a + r.score, 0) / (rows.length || 1) };',
          timeoutSeconds: 30,
        }),
      ],
      edges: [
        e('e1', 'start', 'seed'), e('e2', 'seed', 'loop'),
        e('e3', 'loop', 'score', 'each'), e('e4', 'score', 'end'),
        e('e5', 'loop', 'summary', 'done'),
      ],
    },
  },
];

export function seedIfEmpty() {
  if (store.listWorkflows().length) return 0;
  let created = 0;
  for (const demo of DEMOS) {
    try {
      store.createWorkflow(demo);
      created += 1;
    } catch (err) {
      console.error('[seed] failed to create', demo.name, err.message);
    }
  }
  return created;
}
