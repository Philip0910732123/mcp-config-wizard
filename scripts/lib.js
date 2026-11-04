/* mcp-config-wizard · Copyright 2026 hupan · SPDX-License-Identifier: Apache-2.0
 * https://github.com/Philip0910732123/mcp-config-wizard
 * 再分发或更名分发须保留本声明与仓库地址（见 LICENSE / NOTICE）。
 * fingerprint: MCPWIZ-FP-2026-HUPAN-7C41 */
'use strict';
// lib.js — MCP 配置向导共享工具（纯 Node，无第三方依赖）
// 提供：源码补丁（应对"需要修源码才能跑"的包，如非标准 experimental 能力广播）、
//       capabilities 硬化（剥离服务器广播的非标准 experimental）、文件查找等。

const fs = require('fs');
const path = require('path');

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// 极简 glob -> RegExp（支持 **/ * ? ；glob 中 . 转义为 \. 以精确匹配）。
// 用不会出现在 glob 中的 ASCII 哨兵串隔离各通配符，避免替换顺序互相污染。
function globToRegExp(glob) {
  const S0 = '@@A@@', S1 = '@@B@@', S2 = '@@C@@', S3 = '@@D@@';
  let s = glob.split('**/').join(S0).split('**').join(S1).split('*').join(S2).split('?').join(S3);
  s = s.replace(/[.+^${}()|[\]\\]/g, '\\$&'); // 转义其它正则元字符（哨兵串不含这些，安全）
  s = s.split(S0).join('(?:.*\\/)?').split(S1).join('.*').split(S2).join('[^/]*').split(S3).join('[^/]');
  return new RegExp(s);
}

// 递归列出文件，跳过 node_modules
function findFiles(root, predicate) {
  const out = [];
  const walk = (dir) => {
    let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name === 'node_modules') continue; walk(fp); }
      else if (predicate(fp)) out.push(fp);
    }
  };
  walk(root);
  return out;
}

// 在文件里移除形如 "key: { ... }" 的属性（花括号配对），幂等。
// 只匹配对象值广播（experimental: {），不会误伤 experimental?. 读取式用法。
function removeObjectProperty(filePath, key) {
  if (!fs.existsSync(filePath)) return false;
  const src = fs.readFileSync(filePath, 'utf8');
  const idx = src.search(new RegExp('\\n?[ \\t]*' + escapeRegex(key) + '\\s*:\\s*\\{'));
  if (idx < 0) return false;
  const braceStart = src.indexOf('{', idx);
  if (braceStart < 0) return false;
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return false;
  const before = src.slice(0, idx).replace(/,\s*$/, ''); // 去掉属性前的尾随逗号
  const after = src.slice(end + 1);
  fs.writeFileSync(filePath, before + after, 'utf8');
  return true;
}

// 通用硬化：剥离服务器广播的非标准 experimental 能力（遍历 src/build 下所有 .ts/.js/.py）
function hardenCapabilities(installDir) {
  const files = findFiles(installDir, f => /\.(ts|js|py)$/.test(f) && !f.split(/[\\/]/).includes('node_modules') && !f.split(/[\\/]/).includes('.venv'));
  let changed = 0;
  for (const f of files) {
    if (removeObjectProperty(f, 'experimental')) changed++;
  }
  return changed;
}

// 读取 curated 补丁注册表（known_patches.json，位于 skill 根目录）
function loadKnownPatches() {
  const p = path.join(__dirname, '..', 'known_patches.json');
  if (!fs.existsSync(p)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(j.patches) ? j.patches : [];
  } catch (e) {
    console.warn('⚠️ known_patches.json 解析失败，跳过补丁:', e.message);
    return [];
  }
}

function matchPatch(patch, packageName) {
  const m = patch.match || {};
  if (m.packageName && packageName && m.packageName !== packageName) return false;
  return true;
}

// 应用匹配的补丁（按 stage 区分 preBuild / postBuild）。幂等。
function applyPatches(installDir, packageName, stage) {
  const patches = loadKnownPatches().filter(p => matchPatch(p, packageName) && (p.stage || 'preBuild') === stage);
  if (!patches.length) return { applied: [] };
  const applied = [];
  for (const patch of patches) {
    for (const act of (patch.actions || [])) {
      if (act.type !== 'removeObjectProperty') { console.warn('⚠️ 未知补丁动作:', act.type); continue; }
      const pat = globToRegExp(act.fileGlob || '**/*.ts');
      const files = findFiles(installDir, f => pat.test(f.replace(/\\/g, '/')) && /\.(ts|js)$/.test(f));
      let hit = false;
      for (const f of files) {
        if (removeObjectProperty(f, act.key)) {
          hit = true;
          console.log(`🔧 已应用补丁 [${patch.id}] 移除 ${act.key} <- ${path.relative(installDir, f)}`);
        }
      }
      if (hit) applied.push(patch.id);
    }
  }
  return { applied };
}

module.exports = {
  escapeRegex, globToRegExp, findFiles,
  removeObjectProperty, hardenCapabilities,
  loadKnownPatches, matchPatch, applyPatches
};
