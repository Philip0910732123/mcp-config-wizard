#!/usr/bin/env node
'use strict';
// scaffold_mcp.js — MCP 配置向导主脚本（纯 Node，无第三方依赖）
// 支持：云端 JSON/URL、本地包目录/zip、已有 index.js、自写骨架。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const lib = require('./lib');
const lang = require('./lang');

function usage() {
  console.log(`MCP 配置向导 · scaffold_mcp.js

用法:
  node scaffold_mcp.js --name <服务名> <来源选项> [通用选项]

来源选项（五选一 + 包抓取）:
  --from-url <url>          云端 MCP（streamableHttp），只给一个 URL
  --from-json <json|路径>   用户给的 JSON（含 mcpServers）或裸 URL 字符串
  --from-dir <目录>         本地 MCP 包目录（Node/Python/Go/Rust/Java 等，自动识别语言）；--name 可省略（自动从目录名推断）
  --from-zip <zip>          本地 MCP 包 zip，解压后按语言处理；--name 可省略（自动从文件名推断）
  --from-template           生成零依赖骨架（仅“自己新写 MCP”用；第三方服务禁用）
  --index <index.js路径>    已有 index.js（Node）
  --pkg <npm包名>           npx 方式拉取（Node 包，无需本地下载）
  --uvx-pkg <uv包名>        uvx 方式拉取（Python 包，如 kegg-mcp-server；可配 --uvx-with 加 --with 依赖）
  --uvx-python <版本>       配合 --uvx-pkg 钉扎解释器（如 3.12）。uvx 默认用最新 Python，
                            遇到 pydantic-core / onnxruntime 等无预编译 wheel 的包会退化成源码编译，
                            常见症状：日志里出现 cargo/maturin、启动超时、Failed to connect。钉 3.12 可绕开。

通用选项:
  --mcp-json <路径>         mcp.json 路径（默认 ~/.workbuddy/mcp.json）
  --api-key <key>           替换 URL/JSON 里的 {your_api_key} 等占位
  --env <json>              追加环境变量（如 '{"DB_USER":"u","DB_PASSWORD":"p"}'）
  --install-dir <目录>      本地包安装目录（默认 ~/.workbuddy/mcp-servers/<服务名>）
  --lang <node|python|go|rust|java|dotnet|ruby|php>  强制指定语言（默认按标记文件自动识别）
  --entry <入口文件>        Python 等语言手动指定入口（如 server.py）；不指定则自动识别
  --bin <可执行文件>        直接注册一个现成的可执行程序（Go/Rust 等作者发布的 .exe，免装工具链）
  --bin-args "<参数>"       配合 --bin 传给该程序的参数（如 "--stdio"）
  --uv                      Python 条目用可移植的 "uv --directory run"（默认用 venv 绝对路径，最稳）
  --node <node路径>         command 用的 node（默认 "node"，可移植；仅当你确知目标机 PATH 无 node 时手动传绝对路径覆盖）
  --npm-install             本地 Node 包缺 node_modules 时执行 npm install（需联网）
  --overwrite               安装目录已存在时覆盖
  --dry-run                 只打印，不落盘（不复制、不安装）
  --self-check              写入后启动 MCP 做握手自检，检查服务器是否广播非标准 experimental 能力
  --harden                  自检发现非标准 experimental 广播时，自动剥离并重新编译（未知包可用；已知包已由 curated 补丁处理）

说明: 本地包会自动识别运行时类型（Node=package.json / Python=pyproject.toml / Go=go.mod / Rust=Cargo.toml /
  Java=pom.xml / .NET=*.csproj / Ruby=Gemfile / PHP=composer.json）。识别后按该语言装依赖、找入口、生成 command，
  无需你手动判断语言。详见 SKILL.md「运行时类型速查表」。

设计说明: 本地型 command 默认用可移植的裸 "node"（依赖宿主 PATH 解析）；
  脚本会识别目标平台（扩展点，当前支持 workbuddy）并预检 node 可达性，但不自动改写为绝对路径
  （以免跨机/跨平台分享失效）。如目标机 PATH 确无 node，请用 --node 手动指定绝对路径。
`);
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      a[k] = v;
    }
  }
  return a;
}

const KEY_PATTERNS = [
  /\{your[_-]?api[_-]?key\}/gi,
  /<your[_-]?api[_-]?key>/gi,
  /\{\{?api[_-]?key\}?\}/gi,
  /__API_KEY__/g,
  /YOUR_API_KEY/g,
  /REPLACE_ME/g,
];
function subStr(s, key) { if (!key) return s; let r = s; for (const re of KEY_PATTERNS) r = r.replace(re, key); return r; }
function subDeep(v, key) {
  if (typeof v === 'string') return subStr(v, key);
  if (Array.isArray(v)) return v.map(x => subDeep(x, key));
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = subDeep(v[k], key); return o; }
  return v;
}
function hasPlaceholder(v) { return /(\{your[_-]?api[_-]?key\}|<your[_-]?api[_-]?key>|YOUR_API_KEY|__API_KEY__|REPLACE_ME)/i.test(JSON.stringify(v)); }

function defaultMcpJson() { return path.join(os.homedir(), '.workbuddy', 'mcp.json'); }
function defaultInstallDir(name) { return path.join(os.homedir(), '.workbuddy', 'mcp-servers', name); }

// 从路径自动推断服务名（当用户没显式给 --name 时兜底；例如 gdc-mcp-server-source.zip → gdc-mcp-server）
function inferName(p) {
  let base = path.basename(String(p));
  base = base.replace(/\.(zip|tar\.gz|tgz|tar)$/i, '');
  base = base.replace(/[-_]?source$/i, '');
  return sanitizeName(base);
}

// 服务名规范：只允许字母、数字、点、下划线、连字符。
// 空格 / 中文 / 斜杠会让宿主在工具路由、连接器页显示上出问题，部分平台直接拒收。
function sanitizeName(s) {
  const n = String(s == null ? '' : s).trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return n || 'mcp';
}
function assertName(s) {
  const n = String(s == null ? '' : s).trim();
  if (!/^[A-Za-z0-9._-]+$/.test(n)) {
    const hint = sanitizeName(n);
    throw new Error(
      `服务名 "${n}" 含非法字符。只允许字母、数字、点、下划线、连字符（例：patsnap-patent-legal）。` +
      (hint !== 'mcp' ? ` 建议改成：${hint}` : '')
    );
  }
  return n;
}

function readMcpJson(p) {
  if (!fs.existsSync(p)) return { mcpServers: {} };
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const j = JSON.parse(raw);
  if (!j.mcpServers) j.mcpServers = {};
  return j;
}

// ---- 输出脱敏 ----
// dry-run 与「条目:」回显会把配置打到终端，而 mcp.json 里通常是明文凭据
// （URL 里的 apikey、headers 的 Authorization、env 的 *_KEY/*_TOKEN）。
// 这些输出一旦被粘贴进聊天记录、工单或截图就泄露了，所以打印前统一脱敏。
const MASK_Q = /^(apikey|api[_-]?key|key|token|access[_-]?token|auth|authorization|secret|password|passwd|sig|signature)$/i;
const MASK_KV = /(key|token|secret|password|passwd|pwd|credential)/i;

function maskValue(s) {
  const t = String(s);
  if (t.length <= 8) return '***';
  return t.slice(0, 4) + '…' + t.slice(-2) + `(${t.length})`;
}

function maskDeep(v, keyHint) {
  if (typeof v === 'string') {
    // 形如 https://h/mcp?apikey=xxx 的 URL：只替换凭据参数的值，保留结构便于核对
    if (/^https?:\/\//i.test(v)) {
      try {
        const u = new URL(v);
        let touched = false;
        for (const k of [...u.searchParams.keys()]) {
          if (MASK_Q.test(k)) { u.searchParams.set(k, '***'); touched = true; }
        }
        return touched ? u.toString() : v;
      } catch { return v; }
    }
    // 凭据类字段（env 的 DB_PASSWORD、headers 的 Authorization 等）直接掩码
    if (keyHint && MASK_KV.test(keyHint)) return maskValue(v);
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, keyHint));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) o[k] = maskDeep(v[k], k);
    return o;
  }
  return v;
}
// 执行台账：每次安装/失败追加一行 JSONL，便于批量配多个 MCP 时核对"哪些已做、哪些没做"。
// 台账写失败绝不影响主流程（静默忽略）。
const INSTALL_LOG = path.join(os.homedir(), '.workbuddy', 'mcp-servers', '.install-log.jsonl');
function logInstall(rec) {
  try {
    fs.mkdirSync(path.dirname(INSTALL_LOG), { recursive: true });
    fs.appendFileSync(INSTALL_LOG, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n', 'utf8');
  } catch { /* 台账不是关键路径 */ }
}

// 写配置：先序列化自校验 -> 备份旧文件 -> 临时文件 + 原子改名替换。
// 目的：即使写入过程中断电/被杀进程/磁盘满，也不会留下半截 JSON 把整个 MCP 配置弄坏。
function writeMcpJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = JSON.stringify(data, null, 2) + '\n';
  JSON.parse(body); // 防御：写出的内容必须可被解析
  if (fs.existsSync(p)) {
    try { fs.copyFileSync(p, p + '.bak'); }
    catch (e) { console.warn('⚠️ 旧配置备份失败（仍继续写入）:', e.message); }
  }
  const tmp = p + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, p); // 同分区原子替换
  } catch (e) {
    try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch { }
    throw new Error('写入配置失败: ' + e.message + (fs.existsSync(p + '.bak') ? `\n（原配置已备份在 ${p}.bak，可还原）` : ''));
  }
}

// 本地包的语言识别与按语言分发已移至 lang.js（detectLang / resolveLocalPackage），
// 支持 Node / Python / Go / Rust / Java / .NET / Ruby / PHP 等，无需在此重复。

function resolveEnv(a) {
  let env = {};
  if (a.env) { try { env = JSON.parse(a.env); } catch (e) { throw new Error('--env JSON 解析失败: ' + e.message); } }
  return env;
}

// ——— 目标平台识别（扩展点）———
// 当前可识别 workbuddy / unknown。未来要支持 Codex / OpenCode / 豆包工作 等平台，
// 只需在此函数加分支（并可在对应分支里注入平台特有的配置策略）。
// 注意：本函数只做"识别 + 返回标签"，不直接决定 command 形态——
// command 默认统一用可移植的裸 "node"，以保证跨用户/跨平台分享最稳。
function detectTargetPlatform() {
  if (process.env.WORKBUDDY || process.env.WORKBUDDY_HOME) return 'workbuddy';
  try { if (fs.existsSync(path.join(os.homedir(), '.workbuddy'))) return 'workbuddy'; } catch { }
  return 'unknown';
}

// ——— node 预检（兜底，不改写 command）———
// 确认裸 "node" 在当前环境 PATH 可达。不可达时搜常见位置仅作"参考提示"，
// 默认仍输出裸 "node"（保持跨机/跨平台可移植）。绝对路径加固（--node 手动指定除外）
// 已按设计决定暂不自动执行，因为主流 AI 平台 spawn MCP 时基本都会提供 node。
function preflightNodeCheck() {
  const r = spawnSync('node', ['--version'], { encoding: 'utf8', shell: false });
  if (!r.error && r.status === 0) return { ok: true, version: (r.stdout || '').trim() || 'unknown' };
  const candidates = [];
  const home = os.homedir();
  const binName = process.platform === 'win32' ? 'node.exe' : 'node';
  const sub = process.platform === 'win32' ? (v => v) : (v => path.join('bin', 'node'));
  // WorkBuddy 托管 node
  try {
    const wb = path.join(home, '.workbuddy', 'binaries', 'node', 'versions');
    if (fs.existsSync(wb)) for (const v of fs.readdirSync(wb)) { const p = path.join(wb, v, sub(v)); if (fs.existsSync(p)) candidates.push(p); }
  } catch { }
  // nvm
  try {
    const nvm = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvm)) for (const v of fs.readdirSync(nvm)) { const p = path.join(nvm, v, sub(v)); if (fs.existsSync(p)) candidates.push(p); }
  } catch { }
  // 系统常见位置
  const sys = process.platform === 'win32'
    ? ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files (x86)\\nodejs\\node.exe']
    : ['/usr/local/bin/node', '/usr/bin/node', '/opt/node/bin/node'];
  for (const p of sys) { try { if (fs.existsSync(p)) candidates.push(p); } catch { } }
  return { ok: false, error: (r.error && r.error.message) || 'node --version 失败', candidates };
}

function extractZip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  // 1) 优先用 unzip（Git Bash / Linux / macOS 常见）
  const r = spawnSync('unzip', ['-o', zip, '-d', dest], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    // 2) 回退到系统自带解压（Windows: Expand-Archive）
    const cmd = `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`;
    const ps = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
    if (ps.error || ps.status !== 0) {
      // 两种方式都失败时必须给出可读原因——不要甩空错误，否则用户只会看到「解压失败:」然后放弃。
      const reason = (ps.error && ps.error.message)
        || (ps.stderr || '').toString().trim()
        || (r.error && r.error.message)
        || (r.stderr || '').toString().trim()
        || '系统未提供可用的解压工具（unzip 与系统解压均不可用）';
      throw new Error(
        '解压失败：' + reason.slice(0, 300) +
        '\n解决：① 手动把 zip 解压到任意目录，改用 --from-dir "<解压后的目录>"；' +
        '\n     ② 或让用户直接提供已解压的文件夹。'
      );
    }
  }
}

// 本地包的语言识别、依赖安装、入口定位、command 生成已全部移至 lang.js
// （resolveLocalPackage 内部按 Node / Python / Go / Rust / Java 等分发），此处不再保留 Node 专属实现。

// 自检：启动 MCP，发 initialize，检查服务器返回的 capabilities（捕获非标准 experimental 广播）
// spawnCmd 为 [命令, ...参数]，由各语言 handler 提供（Node=node+入口，Python=venv python+入口 或 uv run）
// selfCheck 必须带上该条目真实的环境变量（如 PYTHONIOENCODING=utf-8），
// 否则自检跑的环境和宿主实际跑的环境不一致，会给出假阴性/假阳性。
function selfCheck(spawnCmd, timeoutMs = 30000, extraEnv = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(spawnCmd[0], spawnCmd.slice(1), { env: { ...process.env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ ok: false, error: e.message }); }
    let buf = '', done = false;
    let errBuf = '';
    child.stderr.on('data', d => { errBuf += d.toString(); });
    const timer = setTimeout(() => {
      if (done) return; done = true; try { child.kill(); } catch { }
      const enc = /UnicodeEncodeError/i.test(errBuf);
      resolve({ ok: false, error: enc ? 'UnicodeEncodeError（GBK 无法打印该服务端的 emoji/中文，需加 env PYTHONIOENCODING=utf-8）' : 'timeout' });
    }, timeoutMs);
    child.stdout.on('data', d => {
      if (done) return; buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1 && m.result) {
          done = true; clearTimeout(timer); try { child.kill(); } catch {}
          resolve({ ok: true, capabilities: m.result.capabilities || null, serverInfo: m.result.serverInfo || null });
        } else if (m.id === 1 && m.error) {
          done = true; clearTimeout(timer); try { child.kill(); } catch {}
          resolve({ ok: false, error: JSON.stringify(m.error) });
        }
      }
    });
    child.on('error', e => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: e.message }); } });
    // 自检只探测「服务器是否在响应里广播 experimental」，因此客户端请求保持干净（capabilities:{}）。
    // 旧实现会在请求里塞 experimental 客户端能力（且值为布尔），新版 SDK(>=1.25) 服务器会严格校验
    // 客户端能力并拒绝非法值，导致对干净服务器产生假阴性。检测服务器广播应看「响应」而非「请求」。
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-config-wizard-selfcheck', version: '1.0' } } }) + '\n');
  });
}

function doHardenAndRebuild(installDir) {
  const n = lib.hardenCapabilities(installDir);
  console.log(n ? `🔧 已剥离 ${n} 个文件中的 experimental 广播` : '（未找到可剥离的 experimental 广播）');
  let pj = {}; try { pj = JSON.parse(fs.readFileSync(path.join(installDir, 'package.json'), 'utf8')); } catch {}
  if (pj.scripts && pj.scripts.build) {
    console.log('重新编译...');
    spawnSync('npm', ['run', 'build'], { cwd: installDir, encoding: 'utf8', shell: true, stdio: 'inherit' });
  }
}

async function selfCheckAndHeal(meta, name, a) {
  console.log(`\n🔍 自检 ${name}：握手并检查服务器返回的 capabilities...`);
  const r = await selfCheck(meta.verifyCmd, 30000, meta.env || {});
  if (!r.ok) {
    console.warn(`⚠️ 自检握手失败：${r.error}（配置已写入，但该 MCP 可能起不来）`);
    console.warn('   如需撤销本次写入：把同目录下的「配置文件名.bak」覆盖回原配置即可。');
    return;
  }
  const exp = r.capabilities && r.capabilities.experimental;
  if (exp && Object.keys(exp).length) {
    console.warn(`⚠️ 服务器在 initialize 返回了非标准 capabilities.experimental: ${JSON.stringify(exp)}`);
    console.warn('   严格宿主（如 WorkBuddy）可能拒绝并报 Invalid input。');
    if (a.harden) {
      console.log('🔧 --harden：自动剥离服务器广播的 experimental 能力...');
      if (meta.lang === 'python') {
        const n = lib.hardenCapabilities(meta.installDir);
        console.log(n ? `🔧 已剥离 ${n} 个 .py 文件中的 experimental 广播（Python，无需重新编译）` : '（未找到可剥离的 experimental 广播）');
      } else if (meta.lang === 'binary' || !meta.installDir) {
        console.warn('⚠️ 这是已编译好的可执行程序，无法就地剥离 experimental 广播。');
        console.warn('   处理办法：① 找作者更新的版本；② 或改用云端版；③ 若宿主拒绝连接，请联系作者反馈。');
        return;
      } else {
        doHardenAndRebuild(meta.installDir);
      }
      const r2 = await selfCheck(meta.verifyCmd, 30000, meta.env || {});
      if (r2.capabilities && r2.capabilities.experimental && Object.keys(r2.capabilities.experimental).length) console.warn('⚠️ 剥离后仍有 experimental，请手动排查');
      else console.log('✅ 剥离后自检通过');
    } else {
      console.log('   如需自动剥离，重跑时加 --harden（curated 补丁已处理已知包；未知包建议 --harden）。');
    }
  } else {
    console.log('✅ 自检通过：服务器未广播非标准 experimental 能力');
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || a.h) { usage(); process.exit(0); }
  // 显式 --name 一律先校验：非法字符写进 mcp.json 后，连接器页显示与工具路由都可能异常。
  if (a.name) {
    try { a.name = assertName(a.name); }
    catch (e) { console.error('❌ ' + e.message); console.error('   （未写入任何文件）'); process.exit(1); }
  }
  const dryRun = !!a['dry-run'];
  const mcpPath = a['mcp-json'] || defaultMcpJson();
  const apiKey = a['api-key'];
  const nodeCmd = a.node || 'node';
  const env = resolveEnv(a);
  const entries = {};
  const localMeta = {};

  try {
    if (a['from-url']) {
      if (!a.name) throw new Error('--from-url 需要 --name');
      let ent = { type: 'streamableHttp', url: a['from-url'], disabled: false };
      if (hasPlaceholder(ent) && !apiKey) throw new Error('URL 含密钥占位符，请用 --api-key 提供真实 key');
      ent = subDeep(ent, apiKey);
      // 合并而不是覆盖：lang.js 为 Python 条目预置了 UTF-8 env 兜底，
      // 用户传 --env 时不能把它冲掉，否则中文 Windows 上会崩在握手前。
      if (Object.keys(env).length) ent.env = { ...(ent.env || {}), ...env };
      entries[a.name] = ent;

    } else if (a['from-json']) {
      let text = a['from-json'];
      if (fs.existsSync(text)) text = fs.readFileSync(text, 'utf8');
      text = text.replace(/^\uFEFF/, '').trim();
      let parsed = null; try { parsed = JSON.parse(text); } catch { }
      if (parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        for (const [nm, e] of Object.entries(parsed.mcpServers)) {
          let ent = JSON.parse(JSON.stringify(e));
          if (ent.url && !ent.command) ent.type = ent.type || 'streamableHttp';
          else if (ent.command) { ent.type = ent.type || 'stdio'; console.warn(`⚠️ "${nm}" 含 command，属本地型 JSON；若 index.js 不在本机，请改用 --from-dir`); }
          if (hasPlaceholder(ent) && !apiKey) throw new Error(`"${nm}" 含密钥占位符，请用 --api-key 提供真实 key`);
          ent = subDeep(ent, apiKey);
          if (ent.disabled === undefined) ent.disabled = false;
          entries[nm] = ent;
        }
      } else {
        if (!a.name) throw new Error('--from-json 不是 mcpServers JSON；若是裸 URL 请加 --name');
        let ent = { type: 'streamableHttp', url: text, disabled: false };
        if (hasPlaceholder(ent) && !apiKey) throw new Error('URL 含密钥占位符，请用 --api-key');
        entries[a.name] = subDeep(ent, apiKey);
      }

    } else if (a['from-dir']) {
      const nm = a.name || inferName(a['from-dir']);
      const res = lang.resolveLocalPackage(a['from-dir'], nm, a, dryRun);
      let ent = res.entry;
      // 合并而不是覆盖：lang.js 为 Python 条目预置了 UTF-8 env 兜底，
      // 用户传 --env 时不能把它冲掉，否则中文 Windows 上会崩在握手前。
      if (Object.keys(env).length) ent.env = { ...(ent.env || {}), ...env };
      entries[nm] = ent;
      if (!dryRun) localMeta[nm] = { installDir: res.installDir, verifyCmd: res.verifyCmd, mainRel: res.mainRel, lang: res.lang, env: ent.env };

    } else if (a['from-zip']) {
      const nm = a.name || inferName(a['from-zip']);
      const tmp = path.join(os.tmpdir(), 'mcp-zip-' + Date.now());
      if (dryRun) {
        console.log('[dry-run] 将解压', a['from-zip'], '到临时目录后再按语言处理（dry-run 不解压）');
        const installDir = a['install-dir'] || defaultInstallDir(nm);
        entries[nm] = { type: 'stdio', command: '<按语言生成>', args: ['<入口>'], disabled: false };
      } else {
        extractZip(a['from-zip'], tmp);
        const res = lang.resolveLocalPackage(tmp, nm, a, false);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
        let ent = res.entry;
        // 合并而不是覆盖：lang.js 为 Python 条目预置了 UTF-8 env 兜底，
      // 用户传 --env 时不能把它冲掉，否则中文 Windows 上会崩在握手前。
      if (Object.keys(env).length) ent.env = { ...(ent.env || {}), ...env };
        entries[nm] = ent;
        localMeta[nm] = { installDir: res.installDir, verifyCmd: res.verifyCmd, mainRel: res.mainRel, lang: res.lang, env: ent.env };
      }

    } else if (a['from-template']) {
      if (!a.name) throw new Error('--from-template 需要 --name');
      console.warn('⚠️ --from-template 生成的是"零依赖占位骨架"，不含任何真实工具；仅用于你自己新写 MCP。第三方真实服务请用 --from-dir/--from-zip。');
      const installDir = a['install-dir'] || defaultInstallDir(a.name);
      if (dryRun) { console.log('[dry-run] 将生成骨架:', path.join(installDir, 'index.js')); }
      else {
        fs.mkdirSync(installDir, { recursive: true });
        fs.copyFileSync(path.join(__dirname, '..', 'templates', 'local-index.js'), path.join(installDir, 'index.js'));
        console.log('已生成骨架:', path.join(installDir, 'index.js'));
      }
      let ent = { type: 'stdio', command: nodeCmd, args: [path.join(installDir, 'index.js')], disabled: false };
      // 合并而不是覆盖：lang.js 为 Python 条目预置了 UTF-8 env 兜底，
      // 用户传 --env 时不能把它冲掉，否则中文 Windows 上会崩在握手前。
      if (Object.keys(env).length) ent.env = { ...(ent.env || {}), ...env };
      entries[a.name] = ent;

    } else if (a.index) {
      if (!a.name) throw new Error('--index 需要 --name');
      const abs = path.resolve(a.index);
      if (!fs.existsSync(abs)) throw new Error('index.js 不存在: ' + abs);
      let d = path.dirname(abs), foundNM = false;
      for (let i = 0; i < 3 && d; i++) { if (fs.existsSync(path.join(d, 'node_modules'))) { foundNM = true; break; } const up = path.dirname(d); if (up === d) break; d = up; }
      if (!foundNM) console.warn('⚠️ index.js 附近无 node_modules；若它 import 了外部包，运行会失败（建议提供整个包用 --from-dir）');
      let ent = { type: 'stdio', command: nodeCmd, args: [abs], disabled: false };
      // 合并而不是覆盖：lang.js 为 Python 条目预置了 UTF-8 env 兜底，
      // 用户传 --env 时不能把它冲掉，否则中文 Windows 上会崩在握手前。
      if (Object.keys(env).length) ent.env = { ...(ent.env || {}), ...env };
      entries[a.name] = ent;

    } else if (a.bin) {
      // 直接注册现成可执行程序：Go/Rust/Java 等作者发布的二进制，免装工具链、免复制源码。
      const babs = path.resolve(a.bin);
      if (!fs.existsSync(babs)) throw new Error('--bin 指定的文件不存在: ' + babs);
      const nm = a.name || path.basename(babs).replace(/\.(exe|bat|cmd|jar|dll)$/i, '');
      const bargs = a['bin-args'] ? String(a['bin-args']).split(/\s+/).filter(Boolean) : [];
      let ent = { type: 'stdio', command: babs, args: bargs, disabled: false };
      // 合并而不是覆盖：lang.js 为 Python 条目预置了 UTF-8 env 兜底，
      // 用户传 --env 时不能把它冲掉，否则中文 Windows 上会崩在握手前。
      if (Object.keys(env).length) ent.env = { ...(ent.env || {}), ...env };
      entries[nm] = ent;
      console.log('使用现成可执行程序:', babs);
      // 让 --self-check 也能验证它（下载来的程序是否真会说 MCP 协议，必须验）
      if (!dryRun) localMeta[nm] = { verifyCmd: [babs].concat(bargs), mainRel: path.basename(babs), lang: 'binary', env: ent.env };

    } else if (a.pkg) {
      if (!a.name) throw new Error('--pkg 需要 --name');
      let ent = { type: 'stdio', command: 'npx', args: ['-y', a.pkg], disabled: false };
      // 合并而不是覆盖：lang.js 为 Python 条目预置了 UTF-8 env 兜底，
      // 用户传 --env 时不能把它冲掉，否则中文 Windows 上会崩在握手前。
      if (Object.keys(env).length) ent.env = { ...(ent.env || {}), ...env };
      entries[a.name] = ent;

    } else if (a['uvx-pkg']) {
      if (!a.name) throw new Error('--uvx-pkg 需要 --name');
      // 顺序有讲究：--python / --with 必须在该包名之前，否则 uvx 会把它们当成包参数传下去。
      const args = [];
      if (a['uvx-python']) args.push('--python', String(a['uvx-python']));
      if (a['uvx-with']) args.push('--with', a['uvx-with']);
      args.push(a['uvx-pkg']);
      let ent = { type: 'stdio', command: 'uvx', args, disabled: false };
      // 合并而不是覆盖：lang.js 为 Python 条目预置了 UTF-8 env 兜底，
      // 用户传 --env 时不能把它冲掉，否则中文 Windows 上会崩在握手前。
      if (Object.keys(env).length) ent.env = { ...(ent.env || {}), ...env };
      entries[a.name] = ent;

    } else {
      usage(); process.exit(1);
    }
  } catch (e) {
    // 注意：这里必须自己落盘，否则 process.exit 会绕过外层 main().catch 的统一错误处理
    const msg = e && e.message ? e.message : String(e);
    logInstall({ ok: false, stage: 'build-entry', error: msg.slice(0, 500) });
    console.error('❌ ' + msg);
    process.exit(1);
  }

  if (!Object.keys(entries).length) { console.error('没有可写入的条目'); process.exit(1); }

  // 平台识别 + 运行时预检（仅本地 stdio 条目；云端条目不需要）
  const hasLocal = Object.values(entries).some(e => e.type === 'stdio');
  if (hasLocal) {
    const platform = detectTargetPlatform();
    console.log(`🌐 目标平台识别: ${platform}`);
    const needsNode = Object.values(entries).some(e => e.type === 'stdio' && (e.command === 'node' || e.command === 'npx'));
    const hasPython = Object.values(entries).some(e => e.type === 'stdio' && (String(e.command).includes('.venv') || e.command === 'uv' || e.command === 'uvx'));
    if (needsNode) {
      if (a.node) {
        console.log(`🟡 使用用户指定的 node: ${a.node}（非默认可移植形态；分享前请确认目标机该路径有效）`);
      } else {
        const nodeCheck = preflightNodeCheck();
        if (nodeCheck.ok) {
          console.log(`🟢 node 可达 (${nodeCheck.version})；使用可移植的裸 "node" 作为 command（跨平台/跨用户分享最稳）`);
        } else {
          console.warn(`⚠️ 当前环境 PATH 未检测到 node：${nodeCheck.error}`);
          if (nodeCheck.candidates.length) {
            console.warn('   发现可参考的 node 位置（未自动改用，保持裸 "node" 以保可移植）：');
            nodeCheck.candidates.slice(0, 5).forEach(p => console.warn('   - ' + p));
          }
          console.warn('   若目标宿主 spawn MCP 时 PATH 无 node，请确认目标平台已提供 node（主流 AI 平台均自带/要求 node）。');
        }
      }
    } else if (hasPython) {
      console.log('🐍 含 Python/uv 类型条目：默认使用 venv 绝对路径（或 uvx），运行时不依赖 PATH 中的 node，无需 node 预检。');
    }
  }

  const data = readMcpJson(mcpPath);
  for (const [nm, ent] of Object.entries(entries)) {
    const prev = data.mcpServers[nm];
    if (prev) {
      console.warn(`⚠️ 已存在 "${nm}"，将覆盖（原配置会先备份为 ${path.basename(mcpPath)}.bak）`);
      // 保留用户既有的 env 凭据：重配同一个 MCP 时不应把已填好的 token/key 抹掉。
      if (prev.env && typeof prev.env === 'object' && !Array.isArray(prev.env)) {
        ent.env = { ...prev.env, ...(ent.env || {}) };
        console.log(`   已保留原条目的环境变量: ${Object.keys(prev.env).join(', ')}`);
      }
    }
    data.mcpServers[nm] = ent;
  }
  if (dryRun) {
    console.log('[dry-run] 合并结果（凭据已脱敏：URL 里 apikey=***、其余只留首尾）:\n' + JSON.stringify(maskDeep(data), null, 2));
    process.exit(0);
  }
  writeMcpJson(mcpPath, data);
  console.log('✅ 已写入', mcpPath);
  for (const [nm, ent] of Object.entries(entries)) {
    console.log('条目:', nm, JSON.stringify(maskDeep(ent)));
    logInstall({ server: nm, ok: true, type: ent.type, command: ent.command, lang: (localMeta[nm] && localMeta[nm].lang) || null, config: mcpPath });
  }
  console.log('⚠️ 新 MCP 不会自动生效：请在连接器管理页右上角「自定义连接器」入口点「信任」启用。');

  // 自检 + 自愈（仅本地 stdio 包；--self-check 开启）
  if (a['self-check']) {
    for (const [nm, meta] of Object.entries(localMeta)) {
      await selfCheckAndHeal(meta, nm, a);
    }
  }
}
main().catch(e => {
  const msg = e && e.message ? e.message : String(e);
  logInstall({ ok: false, error: msg.slice(0, 500) }); // 失败也落盘，便于事后排查
  console.error('❌ ' + msg);
  process.exit(1);
});
