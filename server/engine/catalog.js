/**
 * Single source of truth for node types: it drives the palette, the inspector
 * form and the executor's lookups.
 */
const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
const out = (id = 'main', label = 'out') => ({ id, label });

export const CATEGORIES = [
  { id: 'trigger', label: 'Triggers' },
  { id: 'flow', label: 'Flow control' },
  { id: 'code', label: 'Code' },
  { id: 'browser', label: 'Browser' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'integration', label: 'Integrations' },
  { id: 'ai', label: 'AI' },
];

export const NODE_TYPES = [
  {
    type: 'trigger.manual', label: 'Manual start', category: 'trigger', icon: 'play',
    description: 'Entry point for a run you start yourself.',
    inputs: [], outputs: [out()],
    fields: [f('note', 'Note', 'text', { placeholder: 'What does this workflow do?' })],
  },
  {
    type: 'trigger.schedule', label: 'Schedule', category: 'trigger', icon: 'clock',
    description: 'Run on a cron schedule. Saved with the workflow.',
    inputs: [], outputs: [out()],
    fields: [
      f('cron', 'Cron expression', 'cron', { default: '0 9 * * *', required: true, help: 'minute hour day month weekday — e.g. 0 9 * * 1-5' }),
      f('timezone', 'Timezone', 'text', { default: 'UTC', placeholder: 'UTC' }),
      f('enabled', 'Schedule enabled', 'checkbox', { default: true }),
    ],
  },
  {
    type: 'trigger.webhook', label: 'Webhook', category: 'trigger', icon: 'webhook',
    description: 'Runs when an HTTP request hits the workflow URL.',
    inputs: [], outputs: [out()],
    fields: [
      f('path', 'Hook path', 'text', { default: '', placeholder: 'auto-generated', help: 'POST /api/hooks/<path>' }),
      f('secret', 'Shared secret header', 'text', { placeholder: 'optional x-cascade-secret' }),
    ],
  },
  {
    type: 'core.js', label: 'JavaScript', category: 'code', icon: 'braces',
    description: 'Run JavaScript in an isolated Node process.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('code', 'Code', 'code', {
        language: 'javascript', rows: 14, required: true,
        default: "// input: merged upstream data. ctx.nodes holds every node output.\nconst total = input.items.reduce((a, b) => a + b, 0);\nconsole.log('total', total);\nreturn { total, count: input.items.length };",
      }),
      f('timeoutSeconds', 'Timeout (s)', 'number', { default: 30 }),
    ],
  },
  {
    type: 'core.python', label: 'Python', category: 'code', icon: 'terminal',
    description: 'Run Python 3 in an isolated process.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('code', 'Code', 'code', {
        language: 'python', rows: 14, required: true,
        default: "# input: merged upstream data. print() is captured in the log.\nresult = {\n    'received': input,\n    'squares': [n * n for n in range(5)],\n}",
      }),
      f('timeoutSeconds', 'Timeout (s)', 'number', { default: 30 }),
    ],
  },
  {
    type: 'core.http', label: 'HTTP request', category: 'code', icon: 'globe',
    description: 'Call any HTTP API.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('method', 'Method', 'select', { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' }),
      f('url', 'URL', 'text', { required: true, placeholder: 'https://api.example.com/items', wide: true }),
      f('credentialId', 'Credential', 'credential', { help: 'Adds auth headers and a base URL if set.' }),
      f('headers', 'Headers (JSON)', 'json', { rows: 4, default: '{}' }),
      f('query', 'Query params (JSON)', 'json', { rows: 3, default: '{}' }),
      f('bodyType', 'Body', 'select', { options: ['none', 'json', 'text'], default: 'none' }),
      f('body', 'Body content', 'code', { language: 'json', rows: 8, showIf: { key: 'bodyType', notIn: ['none'] } }),
      f('parse', 'Parse response as', 'select', { options: ['auto', 'json', 'text'], default: 'auto' }),
      f('timeoutSeconds', 'Timeout (s)', 'number', { default: 30 }),
      f('continueOnError', 'Continue on error', 'checkbox', { default: false }),
    ],
  },
  {
    type: 'core.condition', label: 'Condition', category: 'flow', icon: 'git-branch',
    description: 'Branch the flow on a JavaScript expression.',
    inputs: [out('main', 'in')], outputs: [out('true', 'true'), out('false', 'false')],
    fields: [
      f('expression', 'Expression', 'code', {
        language: 'javascript', rows: 3, required: true, default: 'input.value > 10',
        help: 'Truthy goes down the true branch. Everything else takes false.',
      }),
    ],
  },
  {
    type: 'core.transform', label: 'Transform', category: 'flow', icon: 'wand',
    description: 'Reshape data with a JavaScript expression.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('expression', 'Expression', 'code', {
        language: 'javascript', rows: 8, required: true,
        default: "({ greeting: `Hello ${input.name || 'world'}`, receivedAt: new Date().toISOString() })",
      }),
    ],
  },
  {
    type: 'core.delay', label: 'Delay', category: 'flow', icon: 'hourglass',
    description: 'Pause the flow for a number of seconds.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [f('seconds', 'Seconds', 'number', { default: 2, required: true })],
  },
  {
    type: 'core.loop', label: 'For each', category: 'flow', icon: 'repeat',
    description: 'Run the body once per item, then continue.',
    inputs: [out('main', 'in')], outputs: [out('each', 'each'), out('done', 'done')],
    fields: [
      f('items', 'Items', 'text', { required: true, default: '{{ input.items }}', wide: true, help: 'Expression or template resolving to an array.' }),
      f('maxIterations', 'Max iterations', 'number', { default: 100 }),
      f('concurrency', 'Concurrency', 'number', { default: 1, help: 'Keep at 1 for browser/desktop steps.' }),
    ],
  },
  {
    type: 'core.loopEnd', label: 'Loop end', category: 'flow', icon: 'corner-down-left',
    description: 'Closes a For each body.',
    inputs: [out('main', 'in')], outputs: [], fields: [],
  },
  {
    type: 'core.workflow', label: 'Run workflow', category: 'flow', icon: 'workflow',
    description: 'Call another workflow and wait for its result.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('workflowId', 'Workflow', 'workflow', { required: true }),
      f('payload', 'Input payload (JSON)', 'code', { language: 'json', rows: 6, default: '{{ input }}' }),
      f('continueOnError', 'Continue on error', 'checkbox', { default: false }),
    ],
  },
  {
    type: 'browser.action', label: 'Browser', category: 'browser', icon: 'mouse-pointer-click',
    description: 'Drive a real Chromium page with Playwright.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('session', 'Session', 'text', { default: 'main', help: 'Sessions persist across nodes in one run.' }),
      f('action', 'Action', 'select', {
        default: 'goto',
        options: ['goto', 'click', 'fill', 'type', 'press', 'waitFor', 'extractText', 'extractHtml', 'extractAttribute', 'evaluate', 'screenshot', 'scroll', 'hover', 'selectOption', 'setViewport', 'close'],
      }),
      f('url', 'URL', 'text', { showIf: { key: 'action', in: ['goto'] }, placeholder: 'https://example.com', wide: true }),
      f('selector', 'Selector', 'text', { showIf: { key: 'action', in: ['click', 'fill', 'type', 'waitFor', 'extractText', 'extractHtml', 'extractAttribute', 'hover', 'selectOption', 'press'] }, placeholder: 'css=#main, text=Sign in' }),
      f('value', 'Value', 'text', { showIf: { key: 'action', in: ['fill', 'type', 'selectOption', 'press'] }, wide: true }),
      f('attribute', 'Attribute', 'text', { showIf: { key: 'action', in: ['extractAttribute'] }, default: 'href' }),
      f('expression', 'Page expression', 'code', { language: 'javascript', rows: 5, showIf: { key: 'action', in: ['evaluate'] }, default: 'document.title' }),
      f('fullPage', 'Full page screenshot', 'checkbox', { default: true, showIf: { key: 'action', in: ['screenshot'] } }),
      f('width', 'Viewport width', 'number', { showIf: { key: 'action', in: ['setViewport'] }, default: 1280 }),
      f('height', 'Viewport height', 'number', { showIf: { key: 'action', in: ['setViewport'] }, default: 800 }),
      f('timeoutMs', 'Timeout (ms)', 'number', { default: 20000 }),
      f('continueOnError', 'Continue on error', 'checkbox', { default: false }),
    ],
  },
  {
    type: 'desktop.action', label: 'Desktop', category: 'desktop', icon: 'monitor',
    description: 'Control the Linux desktop (Xvfb + xdotool).',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('action', 'Action', 'select', {
        default: 'screenshot',
        options: ['screenshot', 'move', 'click', 'doubleClick', 'rightClick', 'type', 'key', 'scroll', 'launch', 'activateWindow', 'waitForWindow'],
      }),
      f('x', 'X', 'number', { showIf: { key: 'action', in: ['move', 'click', 'doubleClick', 'rightClick', 'scroll'] }, default: 120 }),
      f('y', 'Y', 'number', { showIf: { key: 'action', in: ['move', 'click', 'doubleClick', 'rightClick', 'scroll'] }, default: 120 }),
      f('text', 'Text', 'text', { showIf: { key: 'action', in: ['type'] }, wide: true }),
      f('key', 'Key combo', 'text', { showIf: { key: 'action', in: ['key'] }, placeholder: 'Return, ctrl+s, alt+F4' }),
      f('amount', 'Scroll amount', 'number', { showIf: { key: 'action', in: ['scroll'] }, default: 3, help: 'Wheel clicks; negative scrolls up.' }),
      f('windowTitle', 'Window title (regex)', 'text', { showIf: { key: 'action', in: ['activateWindow', 'waitForWindow'] }, wide: true }),
      f('command', 'Command', 'text', { showIf: { key: 'action', in: ['launch'] }, placeholder: 'xterm -fa Mono -fs 12', wide: true, help: 'Launched on the workflow display.' }),
      f('continueOnError', 'Continue on error', 'checkbox', { default: false }),
    ],
  },
  {
    type: 'integration.http', label: 'Custom integration', category: 'integration', icon: 'plug',
    description: 'Saved API connection with encrypted credentials.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('credentialId', 'Connection', 'credential', { required: true, help: 'Create one under Connections; its base URL and auth are reused.' }),
      f('method', 'Method', 'select', { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'POST' }),
      f('path', 'Path / URL', 'text', { default: '/', wide: true, placeholder: '/v1/messages' }),
      f('headers', 'Headers (JSON)', 'json', { rows: 3, default: '{}' }),
      f('body', 'Body', 'code', { language: 'json', rows: 8, default: '{{ input }}' }),
      f('parse', 'Parse response as', 'select', { options: ['auto', 'json', 'text'], default: 'auto' }),
    ],
  },
  {
    type: 'integration.slack', label: 'Slack message', category: 'integration', icon: 'message-square',
    description: 'Post to a Slack incoming webhook.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('credentialId', 'Slack connection', 'credential', { required: true, help: 'Type: Slack webhook' }),
      f('text', 'Message', 'code', { language: 'markdown', rows: 6, default: 'Workflow finished: {{ input }}' }),
    ],
  },
  {
    type: 'integration.discord', label: 'Discord message', category: 'integration', icon: 'message-circle',
    description: 'Post to a Discord webhook.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('credentialId', 'Discord connection', 'credential', { required: true }),
      f('text', 'Message', 'code', { language: 'markdown', rows: 6, default: 'Workflow finished: {{ input }}' }),
    ],
  },
  {
    type: 'integration.email', label: 'Send email', category: 'integration', icon: 'mail',
    description: 'Send mail through an SMTP connection.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('credentialId', 'SMTP connection', 'credential', { required: true }),
      f('to', 'To', 'text', { required: true, wide: true, placeholder: 'ops@example.com' }),
      f('subject', 'Subject', 'text', { default: 'Cascade workflow report', wide: true }),
      f('text', 'Body', 'code', { language: 'markdown', rows: 8, default: 'Workflow finished.\n\n{{ input }}' }),
    ],
  },
  {
    type: 'ai.prompt', label: 'AI prompt', category: 'ai', icon: 'sparkles',
    description: 'Ask a language model, with workflow data in context.',
    inputs: [out('main', 'in')], outputs: [out()],
    fields: [
      f('credentialId', 'AI connection', 'credential', { help: 'Leave empty to use the server environment (OPENAI_API_KEY / ANTHROPIC_API_KEY).' }),
      f('system', 'System prompt', 'textarea', { rows: 2, default: 'You are a precise automation assistant. Answer concisely.' }),
      f('prompt', 'Prompt', 'code', { language: 'markdown', rows: 8, required: true, default: 'Summarise this data in two sentences:\n\n{{ input }}' }),
      f('includeInput', 'Include upstream data as JSON', 'checkbox', { default: true }),
      f('maxTokens', 'Max tokens', 'number', { default: 800 }),
      f('temperature', 'Temperature', 'number', { default: 0.2 }),
      f('continueOnError', 'Continue on error', 'checkbox', { default: false }),
    ],
  },
];

export const NODE_MAP = new Map(NODE_TYPES.map((n) => [n.type, n]));

export const CREDENTIAL_TYPES = [
  {
    type: 'http', label: 'HTTP / API', icon: 'globe',
    fields: [
      f('baseUrl', 'Base URL', 'text', { placeholder: 'https://api.example.com' }),
      f('authType', 'Auth', 'select', { options: ['none', 'bearer', 'basic', 'header'], default: 'bearer' }),
      f('token', 'Token', 'secret', { showIf: { key: 'authType', in: ['bearer'] } }),
      f('username', 'Username', 'text', { showIf: { key: 'authType', in: ['basic'] } }),
      f('password', 'Password', 'secret', { showIf: { key: 'authType', in: ['basic'] } }),
      f('headerName', 'Header name', 'text', { showIf: { key: 'authType', in: ['header'] }, placeholder: 'X-API-Key' }),
      f('headerValue', 'Header value', 'secret', { showIf: { key: 'authType', in: ['header'] } }),
      f('headers', 'Default headers (JSON)', 'json', { rows: 3, default: '{}' }),
    ],
  },
  { type: 'slack', label: 'Slack webhook', icon: 'message-square', fields: [f('webhookUrl', 'Webhook URL', 'secret', { required: true, wide: true })] },
  { type: 'discord', label: 'Discord webhook', icon: 'message-circle', fields: [f('webhookUrl', 'Webhook URL', 'secret', { required: true, wide: true })] },
  {
    type: 'smtp', label: 'SMTP email', icon: 'mail',
    fields: [
      f('host', 'Host', 'text', { required: true }),
      f('port', 'Port', 'number', { default: 587 }),
      f('secure', 'Use TLS', 'checkbox', { default: false }),
      f('user', 'Username', 'text'),
      f('pass', 'Password', 'secret'),
      f('from', 'From address', 'text', { placeholder: 'automation@example.com' }),
    ],
  },
  {
    type: 'openai', label: 'OpenAI-compatible', icon: 'sparkles',
    fields: [
      f('apiKey', 'API key', 'secret', { required: true }),
      f('baseUrl', 'Base URL', 'text', { default: 'https://api.openai.com/v1' }),
      f('model', 'Model', 'text', { default: 'gpt-4o-mini' }),
    ],
  },
  {
    type: 'anthropic', label: 'Anthropic', icon: 'sparkles',
    fields: [
      f('apiKey', 'API key', 'secret', { required: true }),
      f('baseUrl', 'Base URL', 'text', { default: 'https://api.anthropic.com' }),
      f('model', 'Model', 'text', { default: 'claude-sonnet-4-5' }),
    ],
  },
];

export const CREDENTIAL_MAP = new Map(CREDENTIAL_TYPES.map((c) => [c.type, c]));
