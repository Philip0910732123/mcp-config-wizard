# Changelog — mcp-config-wizard

版本号遵循语义化版本（SemVer：`MAJOR.MINOR.PATCH`）。

**权威版本源 = GitHub tag（`vX.Y.Z`）**。发布到 WorkBuddy 技能中心时，
**填写与 GitHub tag 完全相同的版本号**，以保证两边一致、便于后续维护。

每次发版三步：
1. 在本文档加一条对应版本的变更记录；
2. `git tag vX.Y.Z` 并 `git push --tags`；
3. 在 WorkBuddy 技能中心后台以同一 `X.Y.Z` 发布 / 更新。

---

## [1.0.0] — 2026-10-31

- 首个公开发布版本。
- 能力范围：
  - 从**本地 zip / npm 包 / 远端 git URL** 生成 `~/.workbuddy/mcp.json` 条目；
  - Node 包自动 `npm install` + 编译；Python / FastMCP 包用 `uv` 处理；
  - stdio **握手自检**（`initialize` / `tools/list`），对干净服务器不误报；
  - 远端 streamableHttp **鉴权字段**（env / headers / url）识别与排错；
  - **跨平台可移植**：默认裸 `node`（PATH 解析），可选绝对路径单机加固；
  - curated 补丁注册表（如 openpharma fda-mcp-server 的 experimental 广播修复）。
- 对应 GitHub tag：`v1.0.0`
- 对应技能中心版本：`1.0.0`（发布时填写）
