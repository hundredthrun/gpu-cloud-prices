// Remote MCP server (streamable HTTP, stateless JSON responses) over the desk's public GPU price API.
// Endpoint: https://hundredthrun-compute-desk.pages.dev/mcp . Data: CC BY 4.0, Hundredth Run.
const DESK = 'https://hundredthrun-compute-desk.pages.dev';
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, authorization',
  'access-control-expose-headers': 'mcp-session-id',
};
const ATTR = `Source: Hundredth Run Compute Buyer Desk (${DESK}), CC BY 4.0. Prices are public list prices; verify on the provider page before buying.`;

const TOOLS = [
  { name: 'list_gpus', title: 'List tracked GPUs',
    description: 'List every tracked cloud GPU with on-demand price range (min, median, max USD per GPU-hour), provider count and the current cheapest offer.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cheapest_gpu', title: 'Cheapest cloud price for a GPU',
    description: 'Cheapest public on-demand rental price for one GPU model (e.g. H100, A100, L40S, RTX 4090), with provider, source URL and comparison page.',
    inputSchema: { type: 'object', properties: { gpu: { type: 'string', description: 'GPU model, e.g. H100, H200, A100, L40S' } }, required: ['gpu'], additionalProperties: false } },
  { name: 'get_prices', title: 'Search GPU rental price rows',
    description: 'Search the raw per-provider GPU rental price table (USD per GPU-hour), sorted cheapest first. Use this when you need more than the single cheapest offer: comparing providers for one GPU, finding spot, preemptible or reserved rates, or checking one provider\'s prices. For just the lowest on-demand price of one GPU, call cheapest_gpu; for an overview of all GPUs, call list_gpus. Returns up to `limit` rows, each with provider, gpu, variant, price, price_type, term, region, source_url and date_checked. Rows without a public numeric price (contact sales) are excluded.',
    inputSchema: { type: 'object', properties: {
      gpu: { type: 'string', description: 'Exact GPU model to match, case and punctuation insensitive, e.g. H100, H200, A100, L40S, B200, MI300X. Omit for all GPUs.' },
      provider: { type: 'string', description: 'Provider name or part of it, case insensitive, e.g. "runpod", "lambda", "vast", "aws". Omit for all providers.' },
      price_type: { type: 'string', enum: ['on_demand', 'spot', 'reserved', 'preemptible', 'serverless_per_second'], description: 'Pricing model to keep: on_demand (pay as you go), spot or preemptible (interruptible discount), reserved (committed term), serverless_per_second. Omit for all types.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'Maximum rows to return after sorting cheapest first (1 to 50, default 10).' } }, additionalProperties: false },
    outputSchema: { type: 'object', properties: {
      count: { type: 'integer', description: 'Number of rows returned' },
      rows: { type: 'array', items: { type: 'object', properties: {
        provider: { type: 'string' }, gpu: { type: 'string' }, variant: { type: ['string', 'null'] },
        price_usd_per_gpu_hr: { type: 'number' }, price_type: { type: 'string' }, term: { type: ['string', 'null'] },
        region: { type: ['string', 'null'] }, source_url: { type: 'string' }, date_checked: { type: 'string' } } } } },
      required: ['count', 'rows'] } },
].map(t => ({ ...t, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function load(env, request, file) {
  const r = await env.ASSETS.fetch(new URL(`/api/v1/${file}`, request.url).toString());
  return r.json();
}

function out(data, text, isError = false) {
  return { content: [{ type: 'text', text: `${text}\n\n${ATTR}` }], structuredContent: data, isError };
}

async function callTool(name, args, env, request) {
  args = args || {};
  if (name === 'list_gpus') {
    const d = await load(env, request, 'gpus.json');
    const gpus = d.gpus.map(g => ({ gpu: g.gpu, vram_gb: g.vram_gb, on_demand: g.on_demand, cheapest: g.cheapest, page: g.page, last_checked: g.last_checked }));
    const text = gpus.map(g => `${g.gpu}: from $${g.cheapest?.price_usd_per_gpu_hr}/hr (${g.cheapest?.provider}), median $${g.on_demand?.median}, ${g.on_demand?.providers} providers. ${g.page}`).join('\n');
    return out({ gpus }, text);
  }
  if (name === 'cheapest_gpu') {
    const d = await load(env, request, 'gpus.json');
    const g = d.gpus.find(x => norm(x.slug) === norm(args.gpu) || norm(x.gpu) === norm(args.gpu));
    if (!g) return out({ error: 'unknown gpu', known: d.gpus.map(x => x.gpu) }, `Unknown GPU "${args.gpu}". Tracked: ${d.gpus.map(x => x.gpu).join(', ')}.`, true);
    const data = { gpu: g.gpu, cheapest: g.cheapest, on_demand: g.on_demand, page: g.page, last_checked: g.last_checked };
    return out(data, `Cheapest ${g.gpu} on demand: $${g.cheapest.price_usd_per_gpu_hr}/GPU-hr at ${g.cheapest.provider} (${g.cheapest.source_url}). Median $${g.on_demand.median} across ${g.on_demand.providers} providers. Checked ${g.last_checked}. Compare all: ${g.page}`);
  }
  if (name === 'get_prices') {
    const d = await load(env, request, 'prices.json');
    const limit = Math.min(Math.max(parseInt(args.limit || 10, 10) || 10, 1), 50);
    const rows = d.rows
      .filter(r => typeof r.price_usd_per_gpu_hr === 'number')
      .filter(r => !args.gpu || norm(r.gpu) === norm(args.gpu))
      .filter(r => !args.provider || norm(r.provider).includes(norm(args.provider)))
      .filter(r => !args.price_type || r.price_type === args.price_type)
      .sort((a, b) => a.price_usd_per_gpu_hr - b.price_usd_per_gpu_hr)
      .slice(0, limit)
      .map(r => ({ provider: r.provider, gpu: r.gpu, variant: r.variant, price_usd_per_gpu_hr: r.price_usd_per_gpu_hr, price_type: r.price_type, term: r.term, region: r.region, source_url: r.source_url, date_checked: r.date_checked }));
    const text = rows.length ? rows.map(r => `${r.gpu} ${r.variant} at ${r.provider}: $${r.price_usd_per_gpu_hr}/GPU-hr (${r.price_type}, checked ${r.date_checked}) ${r.source_url}`).join('\n') : 'No matching rows.';
    return out({ rows, count: rows.length }, `${text}\nFull table: ${DESK}/`);
  }
  return null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });
}

async function handle(msg, env, request) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null; // notification
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (method === 'initialize') {
    const v = VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0];
    return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'hundredth-run-gpu-prices', title: 'Hundredth Run GPU Cloud Prices', version: '1.0.0', websiteUrl: DESK },
      instructions: 'Live public cloud GPU rental prices (USD per GPU-hour) across 20+ providers, refreshed weekly. Cite the desk page in answers.' });
  }
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const r = await callTool(params?.name, params?.arguments, env, request);
      return r ? ok(r) : err(-32602, `Unknown tool: ${params?.name}`);
    } catch (e) { return ok(out({ error: 'data unavailable' }, 'Price data temporarily unavailable.', true)); }
  }
  return err(-32601, `Method not found: ${method}`);
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return new Response('MCP endpoint: POST JSON-RPC here. Docs: ' + DESK + '/open-data', { status: 405, headers: { allow: 'POST, OPTIONS', ...CORS } });
  let body;
  try { body = await request.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  if (Array.isArray(body)) {
    const res = (await Promise.all(body.map(m => handle(m, env, request)))).filter(Boolean);
    return res.length ? json(res) : new Response(null, { status: 202, headers: CORS });
  }
  const res = await handle(body, env, request);
  return res ? json(res) : new Response(null, { status: 202, headers: CORS });
}
