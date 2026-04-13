const config = require("../config.js") as any;
const usageStore = require("../utils/usageStore.js") as typeof import("../utils/usageStore.js");

function formatExpiresIn(expiresAt?: number): string {
  if (!expiresAt || Number.isNaN(expiresAt)) {
    return "Unknown";
  }

  const minutes = Math.round((expiresAt - Date.now()) / 60000);
  if (minutes <= 0) {
    return "Expired";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain === 0 ? `${hours} h` : `${hours} h ${remain} min`;
}

function resolveAccountStatus(credentials: any, authManager: any, accountId: string): "valid" | "expired" | "unknown" {
  if (!credentials) {
    return "unknown";
  }
  return authManager.isAccountValid(accountId) ? "valid" : "expired";
}

function buildUsageByAccount(qwenAPI: any): Map<string, any> {
  const usageByAccount = new Map<string, any>();
  for (const [accountId, entries] of qwenAPI.tokenUsage.entries()) {
    const today = entries.find((entry: any) => entry.date === qwenAPI.lastResetDate);
    usageByAccount.set(accountId, today || null);
  }
  return usageByAccount;
}

function aggregateDailyUsageRows(): { rows: any[]; totals: any } {
  const usageDays = usageStore.getAllUsage();
  const rows: any[] = [];
  const dailyTotals = new Map<string, any>();

  for (const [accountId, days] of usageDays.entries()) {
    for (const day of days) {
      rows.push({
        accountId,
        date: day.date,
        requests: day.requests,
        requestsKnown: day.requestsKnown,
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        totalTokens: day.inputTokens + day.outputTokens,
        cacheReadTokens: day.cacheReadTokens,
        cacheWriteTokens: day.cacheWriteTokens,
        cacheTypes: day.cacheTypes,
      });

      const daily = dailyTotals.get(day.date) || {
        date: day.date,
        chatRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      daily.chatRequests += day.requests;
      daily.inputTokens += day.inputTokens;
      daily.outputTokens += day.outputTokens;
      dailyTotals.set(day.date, daily);
    }
  }

  rows.sort((a, b) => `${b.date}:${b.accountId}`.localeCompare(`${a.date}:${a.accountId}`));

  const totals = Array.from(dailyTotals.values())
    .map((day: any) => ({
      ...day,
      totalTokens: day.inputTokens + day.outputTokens,
    }))
    .sort((a: any, b: any) => b.date.localeCompare(a.date));

  return { rows, totals };
}

async function buildAdminSnapshot(qwenAPI: any, fileLogger: any): Promise<any> {
  await qwenAPI.loadRequestCounts();
  await qwenAPI.authManager.loadAllAccounts();

  const accountIds = qwenAPI.authManager.getAccountIds().slice().sort((a: string, b: string) => a.localeCompare(b));
  const usageByAccount = buildUsageByAccount(qwenAPI);
  const accountCounts = usageStore.getAllTodayRequestCounts(qwenAPI.lastResetDate);

  const accounts = accountIds.map((accountId: string) => {
    const credentials = qwenAPI.authManager.getAccountCredentials(accountId);
    const usage = usageByAccount.get(accountId);
    const needsRefresh = credentials ? qwenAPI.authManager.shouldRefreshToken(credentials, accountId) : false;
    return {
      id: accountId,
      isDefault: config.defaultAccount === accountId,
      status: resolveAccountStatus(credentials, qwenAPI.authManager, accountId),
      expiresAt: typeof credentials?.expiry_date === "number" ? credentials.expiry_date : null,
      expiresIn: formatExpiresIn(credentials?.expiry_date),
      todayRequests: qwenAPI.getRequestCount(accountId),
      persistedRequests: accountCounts.get(accountId) || 0,
      inputTokens: usage?.inputTokens || 0,
      outputTokens: usage?.outputTokens || 0,
      totalTokens: (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
      cacheReadTokens: usage?.cacheReadTokens || 0,
      cacheWriteTokens: usage?.cacheWriteTokens || 0,
      webSearchRequests: qwenAPI.getWebSearchRequestCount(accountId),
      webSearchResults: qwenAPI.getWebSearchResultCount(accountId),
      hasResourceUrl: Boolean(credentials?.resource_url),
      needsRefresh,
    };
  });

  const summaryTotals = accounts.reduce((acc: any, item: any) => {
    acc.requests += item.todayRequests;
    acc.inputTokens += item.inputTokens;
    acc.outputTokens += item.outputTokens;
    acc.webSearchRequests += item.webSearchRequests;
    return acc;
  }, { requests: 0, inputTokens: 0, outputTokens: 0, webSearchRequests: 0 });

  const healthy = accounts.filter((item: any) => item.status === "valid").length;
  const expired = accounts.filter((item: any) => item.status === "expired").length;
  const refreshRisk = accounts.filter((item: any) => item.needsRefresh).length;
  const usage = aggregateDailyUsageRows();
  const logStatus = await fileLogger.getRuntimeStatus();

  return {
    summary: {
      serverState: "running",
      host: config.host,
      port: config.port,
      defaultAccount: config.defaultAccount || null,
      accountCount: accounts.length,
      healthyCount: healthy,
      expiredCount: expired,
      refreshRiskCount: refreshRisk,
      todayRequests: summaryTotals.requests,
      todayInputTokens: summaryTotals.inputTokens,
      todayOutputTokens: summaryTotals.outputTokens,
      todayTotalTokens: summaryTotals.inputTokens + summaryTotals.outputTokens,
      todayWebSearchRequests: summaryTotals.webSearchRequests,
      lastResetDate: qwenAPI.lastResetDate,
      logLevel: logStatus.currentLogLevel,
    },
    accounts,
    usageRows: usage.rows,
    usageTotals: usage.totals,
  };
}

function renderAdminPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Qwen Proxy Admin</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, Segoe UI, Arial, sans-serif; background: #0b1020; color: #e5e7eb; }
    .page { max-width: 1320px; margin: 0 auto; padding: 24px; }
    h1, h2, h3 { margin: 0; }
    .sub { color: #94a3b8; margin-top: 8px; }
    .grid { display: grid; gap: 16px; }
    .cards { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-top: 20px; }
    .main { grid-template-columns: 2fr 1fr; margin-top: 16px; align-items: start; }
    .stack { display: grid; gap: 16px; }
    .panel, .card { background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 16px; }
    .card .label { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .card .value { font-size: 26px; font-weight: 700; margin-top: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #1f2937; text-align: left; vertical-align: top; }
    th { color: #94a3b8; font-weight: 600; }
    .status { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; }
    .status.valid { background: rgba(34,197,94,.15); color: #86efac; }
    .status.expired { background: rgba(239,68,68,.15); color: #fca5a5; }
    .status.unknown { background: rgba(234,179,8,.15); color: #fde68a; }
    .status.risk { background: rgba(245,158,11,.15); color: #fcd34d; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
    button, input { border-radius: 10px; border: 1px solid #334155; }
    button { background: #2563eb; color: white; padding: 10px 14px; cursor: pointer; }
    button.secondary { background: #1f2937; }
    button.danger { background: #7f1d1d; }
    button:disabled { opacity: .6; cursor: not-allowed; }
    input { width: 100%; background: #0f172a; color: #e5e7eb; padding: 10px 12px; }
    label { display: block; font-size: 13px; color: #cbd5e1; margin-bottom: 6px; }
    .field { margin-top: 12px; }
    .muted { color: #94a3b8; }
    .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    .hidden { display: none; }
    .notice { margin-top: 12px; color: #cbd5e1; white-space: pre-wrap; }
    .toolbar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; }
    .small { font-size: 12px; }
    .usage-wrap { margin-top: 16px; }
    .hint { margin-top: 8px; color: #94a3b8; font-size: 12px; }
    @media (max-width: 980px) { .main { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="page">
    <h1>Qwen Proxy Admin</h1>
    <div class="sub">覆盖当前 CLI 的核心管理能力：账号列表、添加、删除、counts、usage/tokens 汇总。</div>

    <div id="summary" class="grid cards"></div>

    <div class="grid main">
      <div class="stack">
        <section class="panel">
          <div class="toolbar">
            <div>
              <h2>Accounts</h2>
              <div class="sub">对应 CLI 的 auth list / auth counts。</div>
            </div>
            <div class="actions" style="margin-top:0">
              <button id="refreshBtn" class="secondary">Refresh</button>
            </div>
          </div>
          <div id="accountsTable" style="margin-top:16px"></div>
          <div class="hint">轮询仍然有效，默认账号只是优先账号，不是唯一账号。</div>
        </section>

        <section class="panel">
          <h2>Daily Usage Summary</h2>
          <div class="sub">对应 CLI 的 usage / tokens 每日汇总。</div>
          <div id="usageTotalsTable" style="margin-top:16px"></div>
        </section>

        <section class="panel">
          <h2>Usage By Account</h2>
          <div class="sub">按账号和日期查看请求、input/output token 以及 cache 数据。</div>
          <div id="usageTable" style="margin-top:16px"></div>
        </section>

        <section class="panel">
          <h2>Integration Guide</h2>
          <div class="sub">网页端接入文档，指导你把当前代理接到其他工具或代码里。</div>
          <div id="integrationGuide" style="margin-top:16px"></div>
        </section>
      </div>

      <aside class="stack">
        <section class="panel">
          <h2>Connection</h2>
          <div class="sub">管理页请求会使用这里保存的 API Key。</div>
          <div class="field">
            <label for="apiKeyInput">API Key</label>
            <input id="apiKeyInput" placeholder="输入 API Key，例如 qwen-proxy-local-dev-key" />
          </div>
          <div class="actions">
            <button id="saveApiKeyBtn" class="secondary">Save API Key</button>
            <button id="clearApiKeyBtn" class="secondary">Clear</button>
          </div>
          <div class="hint">仅保存在当前浏览器 localStorage，不会回显服务端完整密钥。</div>
        </section>

        <section class="panel">
          <h2>Add Account</h2>
          <div class="sub">对应 CLI 的 auth add。</div>
          <div class="actions">
            <button id="startAuthBtn">Start Auth</button>
          </div>
          <div id="authFlow" class="hidden">
            <div class="field">
              <label>User Code</label>
              <div id="userCode" class="mono"></div>
            </div>
            <div class="field">
              <label>Verification URL</label>
              <div><a id="verifyLink" class="mono" target="_blank" rel="noreferrer">open</a></div>
            </div>
            <div class="field">
              <label for="accountId">Account ID</label>
              <input id="accountId" placeholder="例如: myaccount" />
            </div>
            <div class="actions">
              <button id="completeAuthBtn">Complete Add</button>
            </div>
          </div>
          <div id="notice" class="notice muted"></div>
        </section>

        <section class="panel">
          <h2>Selected Account</h2>
          <div class="sub">查看账号详情，并执行删除或设为默认。</div>
          <div id="accountDetail" class="notice muted" style="margin-top:16px">Select an account row.</div>
          <div class="actions">
            <button id="setDefaultBtn" class="secondary" disabled>Set as Default</button>
            <button id="deleteBtn" class="danger" disabled>Delete Account</button>
          </div>
        </section>

        <section class="panel">
          <h2>Logging</h2>
          <div class="sub">对应 runtime/log-level。</div>
          <div id="logLevelInfo" class="notice muted" style="margin-top:16px">Loading...</div>
          <div class="actions">
            <button class="secondary log-level-btn" data-level="off">off</button>
            <button class="secondary log-level-btn" data-level="error">error</button>
            <button class="secondary log-level-btn" data-level="error-debug">error-debug</button>
            <button class="secondary log-level-btn" data-level="debug">debug</button>
          </div>
        </section>
      </aside>
    </div>
  </div>

  <script>
    let currentFlow = null;
    let selectedAccountId = null;
    let latestSnapshot = null;

    function getApiKey() {
      return localStorage.getItem('qwenProxyAdminApiKey') || '';
    }

    function updateApiKeyUi() {
      const input = document.getElementById('apiKeyInput');
      if (input) {
        input.value = getApiKey();
      }
    }

    async function request(path, options) {
      const nextOptions = options ? { ...options } : {};
      const headers = { ...(nextOptions.headers || {}) };
      const apiKey = getApiKey();
      if (apiKey) {
        headers['Authorization'] = 'Bearer ' + apiKey;
      }
      nextOptions.headers = headers;

      const res = await fetch(path, nextOptions);
      const contentType = res.headers.get('content-type') || '';
      const body = contentType.includes('application/json') ? await res.json() : await res.text();
      if (!res.ok) {
        const nestedError = body && typeof body === 'object' ? body.error : null;
        const message = typeof body === 'string'
          ? body
          : (nestedError && typeof nestedError === 'object' ? nestedError.message : nestedError) || ('HTTP ' + res.status);
        throw new Error(message);
      }
      return body;
    }

    function setNotice(message, isError) {
      const el = document.getElementById('notice');
      el.textContent = message || '';
      el.style.color = isError ? '#fca5a5' : '#cbd5e1';
    }

    function renderSummary(summary) {
      const root = document.getElementById('summary');
      const items = [
        ['Accounts', summary.accountCount],
        ['Healthy', summary.healthyCount],
        ['Expired', summary.expiredCount],
        ['Refresh Risk', summary.refreshRiskCount],
        ['Default', summary.defaultAccount || 'None'],
        ['Requests Today', summary.todayRequests],
        ['Log Level', summary.logLevel],
        ['Address', summary.host + ':' + summary.port],
      ];
      root.innerHTML = items.map(([label, value]) => '<div class="card"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>').join('');
    }

    function renderAccountDetail() {
      const root = document.getElementById('accountDetail');
      const deleteBtn = document.getElementById('deleteBtn');
      const setDefaultBtn = document.getElementById('setDefaultBtn');
      if (!latestSnapshot || !selectedAccountId) {
        root.textContent = 'Select an account row.';
        deleteBtn.disabled = true;
        setDefaultBtn.disabled = true;
        return;
      }
      const account = latestSnapshot.accounts.find((item) => item.id === selectedAccountId);
      if (!account) {
        root.textContent = 'Select an account row.';
        deleteBtn.disabled = true;
        setDefaultBtn.disabled = true;
        return;
      }
      deleteBtn.disabled = false;
      setDefaultBtn.disabled = !!account.isDefault;
      root.innerHTML = [
        '<div><span class="muted">ID:</span> <span class="mono">' + account.id + '</span></div>',
        '<div><span class="muted">Status:</span> ' + account.status + (account.needsRefresh ? ' <span class="status risk">needs refresh</span>' : '') + '</div>',
        '<div><span class="muted">Expires:</span> ' + account.expiresIn + '</div>',
        '<div><span class="muted">Requests today:</span> ' + account.todayRequests + '</div>',
        '<div><span class="muted">Persisted counts:</span> ' + account.persistedRequests + '</div>',
        '<div><span class="muted">Input / Output:</span> ' + account.inputTokens + ' / ' + account.outputTokens + '</div>',
        '<div><span class="muted">Cache read / write:</span> ' + account.cacheReadTokens + ' / ' + account.cacheWriteTokens + '</div>',
        '<div><span class="muted">Web search:</span> ' + account.webSearchRequests + ' requests, ' + account.webSearchResults + ' results</div>',
        '<div><span class="muted">resource_url:</span> ' + (account.hasResourceUrl ? 'present' : 'missing') + '</div>',
      ].join('');
    }

    function renderLogLevel(summary) {
      document.getElementById('logLevelInfo').innerHTML = '<div><span class="muted">Current level:</span> <span class="mono">' + summary.logLevel + '</span></div>';
      document.querySelectorAll('.log-level-btn').forEach((btn) => {
        btn.style.borderColor = btn.getAttribute('data-level') === summary.logLevel ? '#2563eb' : '#334155';
      });
    }

    function renderAccounts(accounts) {
      const root = document.getElementById('accountsTable');
      if (!accounts.length) {
        root.innerHTML = '<div class="muted">No accounts yet.</div>';
        renderAccountDetail();
        return;
      }
      const rows = accounts.map((acc) => {
        const risk = acc.needsRefresh ? ' <span class="status risk">refresh soon</span>' : '';
        const selected = acc.id === selectedAccountId ? ' style="background:#0f172a"' : '';
        return '<tr data-account-id="' + acc.id + '"' + selected + '>' +
          '<td class="mono">' + acc.id + (acc.isDefault ? ' <span class="muted">(default)</span>' : '') + '</td>' +
          '<td><span class="status ' + acc.status + '">' + acc.status + '</span>' + risk + '</td>' +
          '<td>' + acc.expiresIn + '</td>' +
          '<td>' + acc.todayRequests + '</td>' +
          '<td>' + acc.persistedRequests + '</td>' +
          '<td>' + acc.inputTokens + ' / ' + acc.outputTokens + '</td>' +
          '<td>' + acc.webSearchRequests + '</td>' +
          '<td>' + (acc.hasResourceUrl ? 'yes' : 'no') + '</td>' +
          '</tr>';
      }).join('');
      root.innerHTML = '<table><thead><tr><th>ID</th><th>Status</th><th>Expires</th><th>Req Now</th><th>Req DB</th><th>In / Out</th><th>Web</th><th>resource_url</th></tr></thead><tbody>' + rows + '</tbody></table>';
      root.querySelectorAll('tbody tr').forEach((row) => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
          selectedAccountId = row.getAttribute('data-account-id');
          renderAccounts(latestSnapshot.accounts);
        });
      });
      if (!selectedAccountId && accounts.length) {
        selectedAccountId = accounts[0].id;
      }
      renderAccountDetail();
    }

    function renderUsageTotals(rows) {
      const root = document.getElementById('usageTotalsTable');
      if (!rows.length) {
        root.innerHTML = '<div class="muted">No usage data yet.</div>';
        return;
      }
      const body = rows.map((row) => '<tr>' +
        '<td>' + row.date + '</td>' +
        '<td>' + row.chatRequests + '</td>' +
        '<td>' + row.inputTokens + '</td>' +
        '<td>' + row.outputTokens + '</td>' +
        '<td>' + row.totalTokens + '</td>' +
        '</tr>').join('');
      root.innerHTML = '<table><thead><tr><th>Date</th><th>Chat Req</th><th>Input</th><th>Output</th><th>Total</th></tr></thead><tbody>' + body + '</tbody></table>';
    }

    function renderUsage(rows) {
      const root = document.getElementById('usageTable');
      if (!rows.length) {
        root.innerHTML = '<div class="muted">No usage data yet.</div>';
        return;
      }
      const body = rows.slice(0, 80).map((row) => '<tr>' +
        '<td class="mono">' + row.accountId + '</td>' +
        '<td>' + row.date + '</td>' +
        '<td>' + row.requests + (row.requestsKnown ? '' : '+') + '</td>' +
        '<td>' + row.inputTokens + '</td>' +
        '<td>' + row.outputTokens + '</td>' +
        '<td>' + row.totalTokens + '</td>' +
        '<td>' + row.cacheReadTokens + '</td>' +
        '<td>' + row.cacheWriteTokens + '</td>' +
        '</tr>').join('');
      root.innerHTML = '<table><thead><tr><th>Account</th><th>Date</th><th>Req</th><th>Input</th><th>Output</th><th>Total</th><th>CacheRd</th><th>CacheWr</th></tr></thead><tbody>' + body + '</tbody></table>';
    }

    function renderIntegrationGuide(summary) {
      const root = document.getElementById('integrationGuide');
      const baseUrl = 'http://' + summary.host + ':' + summary.port + '/v1';
      const maskedKey = getApiKey() ? getApiKey() : '在右侧 Connection 里填写 API Key';
      const curlExample = [
        'curl -X POST ' + baseUrl + '/chat/completions',
        '  -H "Content-Type: application/json"',
        '  -H "Authorization: Bearer ' + maskedKey + '"',
        "  -d '{",
        '    "model": "coder-model",',
        '    "messages": [{"role": "user", "content": "Hello!"}]',
        "  }'",
      ].join('\\n');
      const pythonExample = [
        'from openai import OpenAI',
        '',
        'client = OpenAI(',
        '    api_key="' + maskedKey + '",',
        '    base_url="' + baseUrl + '"',
        ')',
        '',
        'resp = client.chat.completions.create(',
        '    model="coder-model",',
        '    messages=[{"role": "user", "content": "Hello!"}]',
        ')',
        'print(resp.choices[0].message.content)',
      ].join('\\n');
      const jsExample = [
        'import OpenAI from "openai";',
        '',
        'const client = new OpenAI({',
        '  apiKey: "' + maskedKey + '",',
        '  baseURL: "' + baseUrl + '"',
        '});',
        '',
        'const resp = await client.chat.completions.create({',
        '  model: "coder-model",',
        '  messages: [{ role: "user", content: "Hello!" }]',
        '});',
        '',
        'console.log(resp.choices[0].message.content);',
      ].join('\\n');
      const healthExample = [
        'GET http://' + summary.host + ':' + summary.port + '/health',
        'GET ' + baseUrl + '/models',
      ].join('\\n');

      root.innerHTML = [
        '<div class="field"><label>Base URL</label><div class="mono">' + baseUrl + '</div></div>',
        '<div class="field"><label>API Key</label><div class="mono">' + maskedKey + '</div></div>',
        '<div class="field"><label>Recommended Models</label><div class="mono">coder-model / qwen3-coder-plus / qwen3-coder-flash</div></div>',
        '<div class="field"><label>curl</label><pre class="mono">' + curlExample + '</pre></div>',
        '<div class="field"><label>Python OpenAI SDK</label><pre class="mono">' + pythonExample + '</pre></div>',
        '<div class="field"><label>JavaScript / Node</label><pre class="mono">' + jsExample + '</pre></div>',
        '<div class="field"><label>Desktop Clients</label><div>在 Cherry Studio、NextChat、LobeChat、Open WebUI 或其他 OpenAI 兼容客户端里填写：</div><ul><li>Provider: OpenAI-compatible</li><li>Base URL: <span class="mono">' + baseUrl + '</span></li><li>API Key: <span class="mono">' + maskedKey + '</span></li><li>Model: <span class="mono">coder-model</span></li></ul></div>',
        '<div class="field"><label>Health / Models</label><pre class="mono">' + healthExample + '</pre></div>',
        '<div class="hint">如果你启用了 API_KEY，所有 /v1 请求都必须带 Authorization: Bearer &lt;API_KEY&gt;。</div>',
      ].join('');
    }

    async function refreshAll() {
      latestSnapshot = await request('/admin/api/overview');
      renderSummary(latestSnapshot.summary);
      renderAccounts(latestSnapshot.accounts);
      renderLogLevel(latestSnapshot.summary);
      renderUsageTotals(latestSnapshot.usageTotals);
      renderUsage(latestSnapshot.usageRows);
      renderIntegrationGuide(latestSnapshot.summary);
    }

    async function startAuth() {
      setNotice('Starting auth flow...');
      const flow = await request('/admin/api/accounts/initiate', { method: 'POST' });
      currentFlow = flow;
      document.getElementById('authFlow').classList.remove('hidden');
      document.getElementById('userCode').textContent = flow.userCode;
      const verifyLink = document.getElementById('verifyLink');
      verifyLink.textContent = flow.verificationUriComplete;
      verifyLink.href = flow.verificationUriComplete;
      setNotice('Open the authorization page, complete consent, then enter an account ID and click Complete Add.');
    }

    async function completeAuth() {
      if (!currentFlow) {
        setNotice('Start auth first.', true);
        return;
      }
      const accountId = document.getElementById('accountId').value.trim();
      if (!accountId) {
        setNotice('Account ID is required.', true);
        return;
      }
      setNotice('Waiting for token polling to complete...');
      await request('/admin/api/accounts/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          deviceCode: currentFlow.deviceCode,
          codeVerifier: currentFlow.codeVerifier,
        }),
      });
      currentFlow = null;
      document.getElementById('authFlow').classList.add('hidden');
      document.getElementById('accountId').value = '';
      setNotice('Account added successfully.');
      await refreshAll();
    }

    async function deleteSelectedAccount() {
      if (!selectedAccountId) {
        setNotice('Select an account first.', true);
        return;
      }
      if (!confirm('Delete account ' + selectedAccountId + '?')) {
        return;
      }
      await request('/admin/api/accounts/' + encodeURIComponent(selectedAccountId), { method: 'DELETE' });
      setNotice('Account deleted.');
      selectedAccountId = null;
      await refreshAll();
    }

    async function setDefaultAccount() {
      if (!selectedAccountId) {
        setNotice('Select an account first.', true);
        return;
      }
      await request('/admin/api/default-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccountId }),
      });
      setNotice('Default account updated.');
      await refreshAll();
    }

    async function setLogLevel(level) {
      await request('/admin/api/log-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, persist: true }),
      });
      setNotice('Log level updated to ' + level + '.');
      await refreshAll();
    }

    function saveApiKey() {
      const value = document.getElementById('apiKeyInput').value.trim();
      localStorage.setItem('qwenProxyAdminApiKey', value);
      setNotice('API Key saved in browser. Click Refresh to reload data.');
    }

    function clearApiKey() {
      localStorage.removeItem('qwenProxyAdminApiKey');
      updateApiKeyUi();
      setNotice('API Key cleared from browser.');
    }

    updateApiKeyUi();
    document.getElementById('refreshBtn').addEventListener('click', () => refreshAll().catch((err) => setNotice(err.message, true)));
    document.getElementById('saveApiKeyBtn').addEventListener('click', () => saveApiKey());
    document.getElementById('clearApiKeyBtn').addEventListener('click', () => clearApiKey());
    document.getElementById('startAuthBtn').addEventListener('click', () => startAuth().catch((err) => setNotice(err.message, true)));
    document.getElementById('completeAuthBtn').addEventListener('click', () => completeAuth().catch((err) => setNotice(err.message, true)));
    document.getElementById('setDefaultBtn').addEventListener('click', () => setDefaultAccount().catch((err) => setNotice(err.message, true)));
    document.getElementById('deleteBtn').addEventListener('click', () => deleteSelectedAccount().catch((err) => setNotice(err.message, true)));
    document.querySelectorAll('.log-level-btn').forEach((btn) => {
      btn.addEventListener('click', () => setLogLevel(btn.getAttribute('data-level')).catch((err) => setNotice(err.message, true)));
    });

    refreshAll().catch((err) => setNotice(err.message, true));
  </script>
</body>
</html>`;
}

export function registerAdminUi(app: any, qwenAPI: any, runtimeConfigStore: any, fileLogger: any): void {
  app.get("/admin", (_req: any, res: any) => {
    res.type("html").send(renderAdminPage());
  });

  app.get("/admin/api/overview", async (_req: any, res: any) => {
    try {
      const snapshot = await buildAdminSnapshot(qwenAPI, fileLogger);
      res.json(snapshot);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load admin overview" });
    }
  });

  app.post("/admin/api/accounts/initiate", async (_req: any, res: any) => {
    try {
      const flow = await qwenAPI.authManager.initiateDeviceFlow();
      res.json({
        deviceCode: flow.device_code,
        userCode: flow.user_code,
        verificationUri: flow.verification_uri,
        verificationUriComplete: flow.verification_uri_complete,
        codeVerifier: flow.code_verifier,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to initiate auth flow" });
    }
  });

  app.post("/admin/api/accounts/complete", async (req: any, res: any) => {
    try {
      const accountId = typeof req.body?.accountId === "string" ? req.body.accountId.trim() : "";
      const deviceCode = typeof req.body?.deviceCode === "string" ? req.body.deviceCode.trim() : "";
      const codeVerifier = typeof req.body?.codeVerifier === "string" ? req.body.codeVerifier.trim() : "";

      if (!accountId || !deviceCode || !codeVerifier) {
        res.status(400).json({ error: "accountId, deviceCode and codeVerifier are required" });
        return;
      }

      await qwenAPI.authManager.pollForToken(deviceCode, codeVerifier, accountId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to complete auth flow" });
    }
  });

  app.delete("/admin/api/accounts/:accountId", async (req: any, res: any) => {
    try {
      const accountId = typeof req.params?.accountId === "string" ? req.params.accountId.trim() : "";
      if (!accountId) {
        res.status(400).json({ error: "accountId is required" });
        return;
      }
      await qwenAPI.authManager.removeAccount(accountId);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete account" });
    }
  });

  app.post("/admin/api/default-account", async (req: any, res: any) => {
    try {
      const accountId = typeof req.body?.accountId === "string" ? req.body.accountId.trim() : "";
      if (!accountId) {
        res.status(400).json({ error: "accountId is required" });
        return;
      }
      await qwenAPI.authManager.loadAllAccounts();
      if (!qwenAPI.authManager.getAccountIds().includes(accountId)) {
        res.status(404).json({ error: "Account not found" });
        return;
      }
      config.defaultAccount = accountId;
      if (runtimeConfigStore?.setDefaultAccount) {
        await runtimeConfigStore.setDefaultAccount(accountId);
      }
      res.json({ ok: true, defaultAccount: accountId });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to set default account" });
    }
  });

  app.post("/admin/api/log-level", async (req: any, res: any) => {
    try {
      const level = String(req.body?.level || "").toLowerCase();
      const persist = req.body?.persist !== false;
      const status = await fileLogger.setRuntimeLogLevel(level, persist);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to set log level" });
    }
  });

  app.post("/admin/api/accounts/import", async (req: any, res: any) => {
    try {
      const accountId = typeof req.body?.accountId === "string" ? req.body.accountId.trim() : "";
      const credentials = req.body?.credentials;
      const setDefault = req.body?.setDefault === true;

      if (!accountId) {
        res.status(400).json({ error: "accountId is required" });
        return;
      }

      if (!credentials || typeof credentials !== "object") {
        res.status(400).json({ error: "credentials object is required" });
        return;
      }

      const accessToken = typeof credentials.access_token === "string" ? credentials.access_token.trim() : "";
      const refreshToken = typeof credentials.refresh_token === "string" ? credentials.refresh_token.trim() : "";
      const expiryDate = Number(credentials.expiry_date);

      if (!accessToken || !refreshToken || !Number.isFinite(expiryDate) || expiryDate <= 0) {
        res.status(400).json({ error: "credentials.access_token, credentials.refresh_token and credentials.expiry_date are required" });
        return;
      }

      const normalizedCredentials = {
        ...credentials,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: typeof credentials.token_type === "string" && credentials.token_type.trim() ? credentials.token_type.trim() : "Bearer",
        expiry_date: expiryDate,
      };

      await qwenAPI.authManager.saveCredentials(normalizedCredentials, accountId);

      if (setDefault) {
        config.defaultAccount = accountId;
        if (runtimeConfigStore?.setDefaultAccount) {
          await runtimeConfigStore.setDefaultAccount(accountId);
        }
      }

      res.json({ ok: true, accountId, defaultAccount: setDefault ? accountId : config.defaultAccount || null });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to import account" });
    }
  });
}
