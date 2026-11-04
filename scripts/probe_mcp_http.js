#!/usr/bin/env node

/* mcp-config-wizard · Copyright 2026 hupan · SPDX-License-Identifier: Apache-2.0
 * https://github.com/Philip0910732123/mcp-config-wizard
 * 再分发或更名分发须保留本声明与仓库地址（见 LICENSE.txt / NOTICE.txt）。
 * fingerprint: MCPWIZ-FP-2026-HUPAN-7C41 */
/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 * probe_mcp_http.js —— streamableHttp（远端）MCP 连接器协议级实测
 *
 * 与 verify_mcp.js 的分工：
 *   verify_mcp.js       只管 stdio：spawn 进程 → initialize → tools/list
 *   probe_mcp_http.js   只管远端：真对照 → initialize → session → tools/list → 真实调用
 *
 * 用法（推荐按 mcp.json 里的名字验，验的就是宿主实际会用的那份配置）：
 *   node probe_mcp_http.js --name patsnap-patent-legal
 *   node probe_mcp_http.js --name patsnap-patent-legal --call legal_data --args '{"patent_number":"US10000000B2"}'
 *
 * 也可直接给 URL：
 *   node probe_mcp_http.js --url https://host/mcp --token sk-xxx            # Bearer 头
 *   node probe_mcp_http.js --url "https://host/mcp?apikey=sk-xxx"           # URL 参数（自动识别）
 *   node probe_mcp_http.js --url https://host/mcp --header "MINERU_API_TOKEN: tk-xxx"   # 自定义头
 *
 * 关键设计（都是踩过的坑）：
 *   1) 鉴权形态自动识别，不假设「一律 Bearer」。URL 里带 apikey / headers 里的自定义头 /
 *      WorkBuddy 把 env 转发成同名请求头 —— 三种都要能测。
 *   2) 「真对照」按识别到的凭据形态剥离：凭据在 URL 就删 URL 参数，在头里就删头。
 *      只删 Authorization 而不删 URL 里的 apikey，会得出「鉴权未生效」的错误结论。
 *   3) 绝不凭 200 就说「令牌有效」。凭据有效性只有两条硬证据：
 *        a) 无凭据被 401/403 拒绝（证明它必需），且 b) 真实 tools/call 成功（证明它有效）。
 *      握手成功只说明「没被拒」。
 *   4) 每次运行都重新 initialize，天然是宿主会话失效时的旁路客户端（见 SKILL.md）。
 *
 * 退出码：0 = 端点应答且工具已枚举；1 = 握手失败；2 = session/工具/调用失败
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------- 参数解析
function parseArgs(argv) {
  const a = { headers: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      if (k === 'header') a.headers.push(v); else a[k] = v;
    }
  }
  return a;
}

// 这些 query 参数名视为凭据（命中即按 URL-key 型处理）
const SENSITIVE_Q = /^(apikey|api[_-]?key|key|token|access[_-]?token|auth|authorization|secret|sig|signature)$/i;

function maskUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) {
      if (SENSITIVE_Q.test(k)) url.searchParams.set(k, '***');
    }
    return url.toString();
  } catch { return u; }
}

function maskSecret(s) {
  s = String(s == null ? '' : s);
  if (s.length <= 6) return '***';
  return s.slice(0, 4) + '…' + s.slice(-2) + `（${s.length} 字符）`;
}

// ---------------------------------------------------------------- 读 mcp.json
function loadEntry(name, mcpPath) {
  if (!fs.existsSync(mcpPath)) throw new Error(`mcp.json 不存在: ${mcpPath}`);
  const raw = fs.readFileSync(mcpPath, 'utf8').replace(/^\uFEFF/, '');
  const data = JSON.parse(raw);
  const entry = data.mcpServers && data.mcpServers[name];
  if (!entry) {
    throw new Error(`mcp.json 中找不到 "${name}"。现有条目：${Object.keys(data.mcpServers || {}).join(', ')}`);
  }
  if (entry.command) {
    throw new Error(`"${name}" 是 stdio 型（有 command），请改用 verify_mcp.js --name ${name}`);
  }
  if (!entry.url) throw new Error(`"${name}" 没有 url 字段，不是可探测的 http 型条目`);
  return entry;
}

// ---------------------------------------------------------------- 鉴权形态识别
// 返回 { mode, ... }，mode ∈ url | bearer | header | env | none
function detectAuth(entry) {
  const url = entry.url || '';
  const headers = { ...(entry.headers || {}) };
  const envVars = { ...(entry.env || {}) };

  // ① URL 参数里的凭据优先级最高：它一定参与鉴权，且最容易被漏测
  let urlParams = [];
  try {
    const u = new URL(url);
    for (const k of u.searchParams.keys()) if (SENSITIVE_Q.test(k)) urlParams.push(k);
  } catch { /* url 非法时交给后面报错 */ }
  if (urlParams.length) {
    return { mode: 'url', params: urlParams, note: 'WorkBuddy 不会改写 url，key 就在 URL 里' };
  }

  // ② Authorization 头
  const authzKey = Object.keys(headers).find((k) => /^authorization$/i.test(k));
  if (authzKey) {
    return { mode: 'bearer', header: authzKey, value: headers[authzKey], all: headers };
  }

  // ③ 其它自定义头（如 X-API-Key）
  const extra = Object.keys(headers).filter((k) => !/^(content-type|accept)$/i.test(k));
  if (extra.length) return { mode: 'header', names: extra, all: headers };

  // ④ WorkBuddy 在 streamableHttp 下会把 env 转发成同名请求头
  //    （MinerU 之类官方配置用 env: {MINERU_API_TOKEN: ...} 即此形态）
  const envKeys = Object.keys(envVars);
  if (envKeys.length) return { mode: 'env', names: envKeys, all: envVars };

  return { mode: 'none' };
}

// 构造「全凭据」与「无凭据」两套请求，供真对照使用
function buildSets(url, auth, extraHeaders) {
  const base = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const full = { ...base };
  if (auth.mode === 'bearer' || auth.mode === 'header') Object.assign(full, auth.all);
  if (auth.mode === 'env') for (const k of auth.names) full[k] = auth.all[k];
  if (extraHeaders) for (const h of extraHeaders) {
    const i = h.indexOf(':');
    if (i > 0) full[h.slice(0, i).trim()] = h.slice(i + 1).trim();
  }

  const bare = { ...full };
  let bareUrl = url;
  if (auth.mode === 'url') {
    const u = new URL(url);
    for (const p of auth.params) u.searchParams.delete(p);
    bareUrl = u.toString();
  } else if (auth.mode === 'bearer') {
    delete bare[auth.header];
  } else if (auth.mode === 'header' || auth.mode === 'env') {
    for (const k of auth.names) delete bare[k];
  }
  return { full, bare, fullUrl: url, bareUrl };
}

// ---------------------------------------------------------------- HTTP
async function post(url, headers, body, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal,
      redirect: 'follow'
    });
    const text = await r.text();
    return {
      status: r.status,
      ok: r.ok,
      headers: r.headers,
      sessionId: r.headers.get('mcp-session-id') || null,
      wwwAuth: r.headers.get('www-authenticate') || null,
      contentType: r.headers.get('content-type') || '',
      text
    };
  } finally {
    clearTimeout(timer);
  }
}

// JSON 与 SSE（text/event-stream）都能解析；SSE 取最后一条可解析的 data:
function parseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* 继续试 SSE */ }
  const objs = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try { objs.push(JSON.parse(payload)); } catch { /* 忽略非 JSON 事件 */ }
  }
  return objs.length ? objs[objs.length - 1] : null;
}

const INIT = (protocolVersion) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'workbuddy-probe-http', version: '1.0' }
  }
});

// ---------------------------------------------------------------- 主流程
(async () => {
  const a = parseArgs(process.argv.slice(2));
  const timeoutMs = a.timeout ? parseInt(a.timeout, 10) : 20000;
  const protocolVersion = a.protocol || '2025-03-26';

  // ---- 拿到目标与凭据形态 ----
  let entry;
  if (a.name) {
    const mcpPath = a['mcp-json'] || path.join(os.homedir(), '.workbuddy', 'mcp.json');
    try {
      entry = loadEntry(a.name, mcpPath);
    } catch (e) {
      console.error('✗ ' + e.message);
      process.exit(1);
    }
  } else if (a.url) {
    entry = { url: a.url, headers: {}, env: {} };
    if (a.token) entry.headers.Authorization = 'Bearer ' + a.token;
  } else {
    console.error(
      '用法：\n' +
      '  node probe_mcp_http.js --name <mcp.json 里的名字> [--call <工具> --args <json>]\n' +
      '  node probe_mcp_http.js --url <url> [--token <t> | --header "K: V"] [--call ...]\n' +
      '可选：--no-contrast 跳过鉴权对照 | --timeout <ms> | --protocol <版本> | --mcp-json <路径>'
    );
    process.exit(1);
  }
  // 命令行追加的头（可多个）
  if (a.headers.length) {
    entry.headers = entry.headers || {};
    for (const h of a.headers) {
      const i = h.indexOf(':');
      if (i > 0) entry.headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
    }
  }

  const auth = detectAuth(entry);
  const sets = buildSets(entry.url, auth, null);

  console.log('=== streamableHttp MCP 实测 ===');
  console.log('目标    : ' + maskUrl(entry.url));
  if (a.name) console.log('条目    : ' + a.name + '（读自 mcp.json，验的是宿主实际会用的配置）');
  // 注意：不能写成对象字面量再取键——那样所有分支都会被求值，
  // 其它形态缺失的 params/names 会直接抛 TypeError。必须按 mode 分支取。
  let authDesc;
  if (auth.mode === 'url') authDesc = `URL 参数（${auth.params.join(', ')}）`;
  else if (auth.mode === 'bearer') authDesc = `Authorization 头（${maskSecret(String(auth.value || '').replace(/^Bearer\s+/i, ''))}）`;
  else if (auth.mode === 'header') authDesc = `自定义请求头（${auth.names.join(', ')}）`;
  else if (auth.mode === 'env') authDesc = `env 转发头（${auth.names.join(', ')}）`;
  else authDesc = '未发现任何凭据字段';
  console.log('鉴权形态: ' + auth.mode + ' —— ' + authDesc);
  if (auth.mode === 'none') {
    console.log('          ⚠️ 没识别到凭据字段。若该端点其实需要鉴权，说明配置里漏了（或缺 key）。');
  }
  console.log('');

  const findings = [];
  const done = [];

  // ---- ① 真对照：剥掉识别到的凭据再握手 ----
  let contrastStatus = null;
  let contrastHadResult = false;
  if (!a['no-contrast'] && auth.mode !== 'none') {
    console.log('[1/4] 鉴权对照 —— 移除识别到的凭据后 initialize');
    try {
      const r = await post(sets.bareUrl, sets.bare, INIT(protocolVersion), timeoutMs);
      contrastStatus = r.status;
      const o = parseBody(r.text);
      contrastHadResult = !!(o && o.result);
      console.log('      HTTP ' + r.status + (r.wwwAuth ? '  WWW-Authenticate: ' + r.wwwAuth : ''));
      if (r.status === 401 || r.status === 403) {
        console.log('      ✓ 无凭据被拒绝 —— 该凭据确为必需，且服务端真的在校验它');
      } else if (r.status === 200 && contrastHadResult) {
        console.log('      ⚠ 无凭据也能握手成功 —— 服务端未校验这个凭据');
        console.log('        可能原因：① 凭据字段名/位置不对（配了但服务端不认）；');
        console.log('                  ② 端点本就公开，或鉴权靠 IP 白名单等其它途径；');
        console.log('                  ③ 你测的凭据不是这个端点要的那个。');
        console.log('        → 必须向用户说明这一点，别直接说"配好了"。');
      } else {
        console.log('      · 无凭据 → HTTP ' + r.status + '（非 401/403/200，不足以判定，正文：' + r.text.slice(0, 160) + '）');
      }
    } catch (e) {
      console.log('      ERR ' + e.name + ': ' + e.message + '（对照失败不影响主流程）');
    }
    console.log('');
  } else {
    console.log('[1/4] 鉴权对照 —— 跳过' + (a['no-contrast'] ? '（--no-contrast）' : '（未识别到凭据）'));
    console.log('');
  }

  // ---- ② 带凭据 initialize ----
  console.log('[2/4] initialize（带凭据）');
  let r1;
  try {
    r1 = await post(sets.fullUrl, sets.full, INIT(protocolVersion), timeoutMs);
  } catch (e) {
    console.log('      ERR ' + e.name + ': ' + e.message);
    console.log('      → 网络层就不通：查 URL / 代理 / 证书 / 域名解析，跟 mcp.json 字段无关。');
    process.exit(1);
  }
  console.log('      HTTP ' + r1.status + '  ct=' + (r1.contentType || '-'));
  if (r1.status !== 200) {
    console.log('      ✗ 握手失败。正文：' + r1.text.slice(0, 300));
    if (r1.status === 401) {
      console.log('      → 401：凭据无效 / 过期 / 字段名不对。优先核对「字段名」与「Bearer 前缀」，');
      console.log('        别急着换令牌——不同服务的鉴权字段不一样（URL 参数 / Bearer / 自定义头 / env 转发头）。');
    }
    if (r1.status === 403) {
      console.log('      → 403：凭据被识别但无权。多为 scope/白名单问题，见下方「反查 scope」技巧。');
    }
    if (r1.status === 404) {
      console.log('      → 404：路径不对（少 /mcp、多 /mcp）。也可能是服务端自身后端 404，需对比官方端点。');
    }
    process.exit(1);
  }

  const o1 = parseBody(r1.text);
  if (!o1 || !o1.result) {
    console.log('      ✗ 200 但拿不到 result。正文：' + r1.text.slice(0, 300));
    console.log('      → 常见于：端点把错误包装成 200 返回、或返回的是 SSE 但格式非标准。');
    process.exit(1);
  }
  const si = o1.result.serverInfo || {};
  const caps = o1.result.capabilities || {};
  console.log('      serverInfo : ' + (si.name || '?') + ' v' + (si.version || '?'));
  console.log('      protocol   : ' + (o1.result.protocolVersion || o1.result.protocolVersion || '(未声明)'));
  console.log('      capabilities: ' + (Object.keys(caps).join(', ') || '(空)'));
  // _identity / note 是金矿：常含令牌绑定的身份、字段口径、调用约束
  for (const k of ['_identity', 'identity', 'note']) {
    if (o1.result[k]) {
      console.log('      ' + k.padEnd(11) + ': ' + JSON.stringify(o1.result[k]).slice(0, 400));
      findings.push('服务端在 initialize 里给了 ' + k + '（含身份/使用约束，务必转述用户）');
    }
  }
  const sid = r1.sessionId;
  console.log('      session-id : ' + (sid || '(未返回，可能是无状态服务)'));
  console.log('');

  // ---- ③ initialized 通知 + tools/list ----
  const withSid = sid ? { 'Mcp-Session-Id': sid } : undefined;
  if (sid) {
    try {
      await post(sets.fullUrl, sets.full, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, timeoutMs)
        .then((r) => { /* 通知一般无响应体，忽略 */ });
    } catch { /* 通知失败不致命 */ }
  } else {
    // 无 session 的服务端也发一次，部分实现要求收到才放行 tools/list
    try {
      await post(sets.fullUrl, sets.full, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, timeoutMs);
    } catch { /* 忽略 */ }
  }

  console.log('[3/4] tools/list');
  const reqTools = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
  let r2;
  try {
    r2 = await post(sets.fullUrl, withSid ? Object.assign({}, sets.full, withSid) : sets.full, reqTools, timeoutMs);
  } catch (e) {
    console.log('      ERR ' + e.name + ': ' + e.message);
    process.exit(2);
  }
  console.log('      HTTP ' + r2.status);
  const o2 = parseBody(r2.text);
  if (o2 && o2.error) {
    console.log('      ✗ ' + (o2.error.code != null ? o2.error.code : '') + ' ' + (o2.error.message || JSON.stringify(o2.error)));
    if (/session/i.test(o2.error.message || '')) {
      if (sid) {
        console.log('      → 你**带着** session 却被拒：说明这个 session 已失效。');
        console.log('        这是宿主客户端持有的会话过期，不是配置错、也不是令牌失效。');
        console.log('        旁路：本脚本每次运行都重新握手，可直接用 --call 继续干活；');
        console.log('        根治：让用户重连该 MCP / 重启 WorkBuddy 刷新会话。');
      } else {
        console.log('      → 服务端没给 session 却要 session：先补 notifications/initialized（本脚本已发）。');
        console.log('        若仍失败，说明该实现要求特定请求头，查官方文档。');
      }
    }
    process.exit(2);
  }

  const tools = (o2 && o2.result && o2.result.tools) || [];
  if (!tools.length) {
    console.log('      ✗ 未取到工具。正文：' + r2.text.slice(0, 300));
    process.exit(2);
  }
  console.log('      ✓ 共 ' + tools.length + ' 个工具：');
  tools.forEach((t, i) => {
    const desc = t.description ? '  — ' + String(t.description).replace(/\s+/g, ' ').slice(0, 60) : '';
    console.log('      ' + String(i + 1).padStart(2, ' ') + '. ' + t.name + desc);
  });
  console.log('');
  console.log('      ⚠ 清单 ≠ 权限：tools/list 列的是服务端全部工具，不代表这把凭据都能调。');
  console.log('        权限以真实调用为准（下面第 4 步）。');
  console.log('');

  // ---- ④ 真实调用（可选，但这是「凭据有效」唯一的硬证据） ----
  const callIdx = process.argv.indexOf('--call');
  let callOk = false;
  let callFailed = false;
  if (callIdx > 0) {
    const toolName = process.argv[callIdx + 1];
    const argsIdx = process.argv.indexOf('--args');
    let toolArgs = {};
    if (argsIdx > 0) {
      try {
        toolArgs = JSON.parse(process.argv[argsIdx + 1]);
      } catch (e) {
        console.log('[4/4] ✗ --args 不是合法 JSON：' + e.message);
        process.exit(2);
      }
    }
    console.log('[4/4] tools/call ' + toolName + ' ' + JSON.stringify(toolArgs).slice(0, 200));
    let r3;
    try {
      r3 = await post(
        sets.fullUrl,
        withSid ? Object.assign({}, sets.full, withSid) : sets.full,
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: toolName, arguments: toolArgs } },
        timeoutMs
      );
    } catch (e) {
      console.log('      ERR ' + e.name + ': ' + e.message);
      process.exit(2);
    }
    console.log('      HTTP ' + r3.status);
    const o3 = parseBody(r3.text);
    const resObj = (o3 && o3.result) || null;

    if (o3 && o3.error) {
      // 协议层错误（JSON-RPC error）
      const msg = o3.error.message || '';
      console.log('      ✗ ' + (o3.error.code != null ? o3.error.code : '') + ' ' + msg);
      if (/未授权|not authori|forbidden|permission|allowed|允许/i.test(msg)) {
        console.log('      → 「凭据被识别但无这个工具的权限」（scope 白名单），不是配置错。');
        console.log('        报错里若回显了允许的工具清单，直接抄给用户当 scope 说明。');
      }
      if (/additionalProperties|invalid|Unexpected|required/i.test(msg + JSON.stringify(o3.error.data || ''))) {
        console.log('      → 参数被拒：字段名以 schema 为准（描述常过时）。先传最简参数打通，再补全。');
      }
      callFailed = true;
    } else if (resObj && resObj.isError) {
      // 🔴 最阴的一类：MCP 把业务错误包在 result.isError 里，HTTP 仍是 200、也没有 JSON-RPC error。
      //    只看 o3.error 会把「执行失败」误判成「调用成功」——凭据有效性的结论就假了。
      console.log('      ✗ 工具执行失败（MCP 把它包在 result.isError 里，HTTP 仍 200）');
      const tail = JSON.stringify(resObj).slice(0, 600);
      console.log('        ' + tail.split('\n').join('\n        '));
      console.log('      → 这不算「凭据有效」的证据：工具被调到了，但执行失败。');
      console.log('        先核对参数名与取值（schema 以实测为准）；业务错误码见 _meta.error_code。');
      callFailed = true;
    } else {
      callOk = true;
      console.log('      ✓ 调用返回：');
      const pretty = JSON.stringify(resObj, null, 2) || '(空)';
      const lines = pretty.split('\n');
      console.log(lines.slice(0, 25).join('\n').split('\n').map((l) => '      ' + l).join('\n'));
      if (lines.length > 25) console.log('      …（已截断，共 ' + lines.length + ' 行）');
    }
  } else {
    console.log('[4/4] 真实调用 —— 跳过（没给 --call）');
    console.log('      ⚠ 没有这一步，「凭据有效」这句话是证明不了的：握手成功只说明没被拒。');
    console.log('        建议补一次只读工具：--call <工具名> --args \'{}\'');
  }
  console.log('');

  // ---- 结论（措辞严格对齐证据强度） ----
  console.log('=== 结论 ===');
  console.log('· 端点应答：✓（initialize 200，serverInfo=' + (si.name || '?') + '）');
  if (contrastStatus === 401 || contrastStatus === 403) {
    console.log('· 凭据必需：✓ 已被证明（无凭据 → ' + contrastStatus + '）');
  } else if (contrastStatus === 200 && contrastHadResult) {
    console.log('· 凭据必需：✗ 未证明（无凭据也能握手，该端点未校验此凭据）');
  } else {
    let why;
    if (a['no-contrast']) why = '--no-contrast';
    else if (auth.mode === 'none') why = '条目里没有凭据字段，属公开端点，无需对照';
    else why = '对照未得出明确状态';
    console.log('· 凭据必需：未测（' + why + '）');
  }
  if (callOk) {
    console.log('· 凭据有效：✓ 已被证明（真实调用成功）');
  } else if (callFailed) {
    console.log('· 凭据有效：未证明（真实调用失败，原因见上；这不等于凭据无效）');
  } else if (contrastStatus === 401 || contrastStatus === 403) {
    console.log('· 凭据有效：部分证明（无凭据被拒 + 带凭据能握手，但没做真实调用）');
  } else {
    console.log('· 凭据有效：未证明（要证明请加 --call <只读工具>）');
  }
  console.log('· 工具枚举：✓ ' + tools.length + ' 个（清单 ≠ 权限，权限需逐个真实调用验证）');
  for (const f of findings) console.log('· ' + f);
  console.log('');
  console.log('提示：新配置的连接器不会自动激活 —— 需在连接器管理页右上角「自定义连接器」点「信任」，' +
    '改过 mcp.json 还要重启 WorkBuddy。');

  // 调用失败给 2，其余 0（端点应答 + 工具已枚举即算通过）
  process.exitCode = callFailed ? 2 : 0;
})();
