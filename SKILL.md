---
name: mcp-config-wizard
description: 面向生物医药研发场景，把"选什么/审什么"（决策）与"怎么装进 WorkBuddy"（执行）合二为一。覆盖：按需选型清单（商业 SaaS 情报类 + 化学/靶点/临床/结构等科学数据 MCP，几十个也能管）、安装前安全审查、配置进 WorkBuddy（云端 streamableHttp / 本地 stdio 自动脚手架+握手验证）、多 MCP 治理与排错。触发词：配置 MCP、加一个 MCP 服务、MCP 选型、MCP 安全吗、MCP 配不上、MCP 太多怎么管、配置 PDB/ChEMBL/智慧芽、给 AI 接数据源/API。不适用于：MCP 服务端源码开发/从零编写（本 skill 只做接入与治理，不写服务本身）、非 WorkBuddy 平台的 MCP 配置（路径与入口不同）、纯理论科普而不落地配置。
---

# MCP 选型与配置向导

## 0. 定位与何时使用

你是用户的「MCP 装备顾问 + 装机工程师」：**先帮用户想清楚要哪个、安不安全，再帮他把服务真正配进 WorkBuddy 并验证能跑**。

适用场景（命中即触发）：
- 「有哪些 MCP 值得装 / 我该选哪个？」「这个 MCP 安全吗？」
- 「帮我把 XX 数据源 / API / MCP 配进 WorkBuddy」「配置 PDB / ChEMBL / 智慧芽 / Open Targets」
- 「MCP 配不上 / 配不进去 / 配了不生效」「我装了几十个 MCP，怎么管？」

一句话决策流：**需求驱动 → 安全审查 → 按需启用 → 配置验证 → 持续治理**。

---

## 1. 价值观与规模观（核心，先立）

1. **按需启用，不限定数量**。MCP 总数没有上限——生物医药研发场景常需几十个（专利、文献、化学、靶点、临床、结构、办公协同各取所需）。**关键不是"装几个"，而是"当前用几个"**：把当下任务不用的服务器在连接器页关掉（不点「信任」或关闭开关），避免全部常驻导致工具过多、模型选错工具、上下文臃肿、权限面过大。
2. **先审后装**。MCP 拥有你授予的真实系统权限，来源不明 = 开后门。任何新服务落地前过一遍第 4 节的审查。
3. **需求驱动**。从「我要 AI 帮我查什么、干什么」出发选服务，不从「有什么酷的」出发。

---

## 2. 一分钟理解 MCP（科普）

类比：**MCP 是 AI 助手的「USB 接口标准」**。AI 本体只会对话；插上「专利读卡器」能查专利，插上「化学数据库读卡器」能拉化合物活性。MCP 统一了插口规范，任何工具按规范实现，任何支持 MCP 的 AI 都能用。

三个关键角色：**宿主**（你的 AI 应用，如 WorkBuddy）→ **MCP 服务器**（能力提供方）→ **实际资源**（文件 / 数据库 / API）。

---

## 3. 生物医药研发场景：MCP 选型清单

按真实工作流分类。**这是"类别框架"，不是固定清单**——具体装哪些由你的实际数据源决定；下表实例仅为举例，重点在于每行都标了「配置归口」（走方案一云端，还是方案二本地）。风险级参考第 4 节审查。**不强制"只装几个"——列全你需要的，再按频率决定常驻还是按需启用。**

| 需求 | 服务器类型 | 配置归口 | 风险级 |
|---|---|---|---|
| 专利 / 文献 / 医药情报 | 商业 SaaS 情报类（如智慧芽系列，付费） | **方案一·云端**：给 JSON + API key 即可，无需本地文件 | 中（付费 key 管理） |
| 化合物 / 活性 / 靶点 / 临床 / 结构 | 公开科学数据库类（机构官方维护） | 多为**方案一·云端**（官方 API + key/token）；少数提供本地包的走方案二 | 低 |
| 通用联网搜索 | 搜索类 | 方案一·云端 | 低（关注配额） |
| 本地项目文档 / 笔记 | 文件系统类 | 方案二·本地（限定目录白名单） | 中 |
| 办公协同（邮件/日历/IM） | SaaS 集成类 | 依提供方（云端或连接器接入） | 高（"发送"类权限最谨慎） |

> 关键点：**凡"给一段 JSON + API key 就能配"的商业 / SaaS 类 MCP（智慧芽付费 MCP 即典型代表），一律走方案一云端，不需要任何本地文件或 `npm install`**；只有"下载下来的包 / zip / 文件夹"才走方案二。选型时先判断归口，再按对应方案执行。

**分层建议**（非数量上限，只是告诉你哪类该常驻）：
- **常驻（高频）**：你每天必用的 1–3 个核心源（如商业情报 SaaS + 主力科学数据库）。
- **按需启用（低频）**：结构、临床、靶点、文件系统、办公协同等——用到时再去连接器页开启，用完可关。

---

## 4. 安装前安全审查（五步法 + 生物医药注记）

1. **查来源**：官方组织 / 知名机构出品优先（智慧芽官方、EMBL-EBI、RCSB、Open Targets 等都算可信源）；个人仓库看 star、更新频率、issue 响应。三无仓库不装。
2. **读权限**：它要什么权限？文件类看目录范围，API 类看 token 范围。**要的权限超过功能所需 = 红旗**。
3. **看配置**：密钥是放环境变量（`env`）还是明文写死？支持只读模式吗？
4. **扫行为**：装前浏览源码入口——有没有向陌生域名上报数据、有没有动态下载执行代码。
5. **最小授权试运行**：先用测试目录 / 只读账号跑通，确认行为干净再给正式权限。

**高危信号（任一即弃）**：要求关闭安全确认、混淆代码、安装脚本要 sudo、README 与实际行为不符。

**生物医药场景额外注记**：
- **商业 SaaS / 付费 MCP 的 key 管理**：付费 / 商业 SaaS 类 MCP（如智慧芽系列）的 API key 以明文存在 `~/.workbuddy/mcp.json`，提醒用户**勿外泄、勿截图外传**；团队共用配置模板时密钥各自注入，模板不含任何真实凭证。
- **科学数据源可信度**：优先选官方 / 学术机构维护的（带机构域名、有 DOI / 引用、更新活跃）。对长期不更新的个人镜像保持警惕，数据可能过期。

---

## 5. 执行：配置进 WorkBuddy

> 全程不要手写 mcp.json，用本 skill 的脚本（`scripts/scaffold_mcp.js` / `scripts/verify_mcp.js`）。核心只让用户提供：**配置来源（JSON/URL 或本地文件）** 与 **凭据（API key / 用户名密码）**。

### 铁律（先读，违反即失败）
1. **绝不上网搜索 / 下载 MCP 源码**。源码只能来自：用户给的 JSON、用户给的 URL、用户给的本地文件 / 文件夹 / zip。找不到就让用户提供。
2. **单份 `index.js` 几乎都不够**。它通常 `import` 外部包（如 `@modelcontextprotocol/sdk`、`axios`），必须有 `node_modules`。所以本地型要让用户提供"整个包"，或允许 `npm install`。
3. 本地包**统一放到 `~/.workbuddy/mcp-servers/<服务名>/`**（脚本自动复制；也可让用户自己放）。
4. WorkBuddy 的 mcp.json 每条**必须带 `type`**：本地 `stdio`，远程 `streamableHttp`。脚本已自动处理。
5. 第三方真实服务**禁止用 `--from-template`**（那只是「hello」占位骨架，握手能过但根本不是真服务）。

### 第 0 步：先问答（不得跳过）
问用户一句：**「你手上有这个 MCP 的配置吗？是①一段 JSON / 一个 URL，还是②本地文件（index.js）/ 文件夹 / zip？」**
- 有 JSON 或 URL → 走 **方案一**
- 有本地文件 / 文件夹 / zip → 走 **方案二**
- 都没有 → 停下，请用户提供；**不要上网找**。

**判断归口（也可对照第 3 节选型清单的「配置归口」列）：**

```
用户有配置来源？ ──否──→ 停下，请用户提供；不要上网找
       │是
       ├─ JSON / URL / 裸 URL 字符串 ─────→ 方案一·云端（streamableHttp + key）
       ├─ 文件夹 / zip（完整包）──────────→ 方案二·本地（--from-dir / --from-zip）
       ├─ 单个 index.js ────────────────→ 查依赖；缺则让用户给整个包或加 --npm-install（见方案二）
       └─ npm 包名（如 @scope/server-xxx）→ 方案二·npx（--pkg，无需下载）
```

### 方案一：云端 MCP（JSON / URL）
**识别**：JSON 里有 `url` 没有 `command`，或用户直接给 `http(s)://...` 链接 → 云端。（若 JSON 里有 `command`，说明其实是本地型，转方案二。）

```
# 用户给的是完整 JSON（含 mcpServers）
node scripts/scaffold_mcp.js --name <服务名> --from-json '<JSON字符串或文件路径>' --api-key <真实key>

# 用户只给了一个 URL
node scripts/scaffold_mcp.js --name <服务名> --from-url '<url>' --api-key <真实key>
```
- **密钥占位**：URL/JSON 里出现 `{your_api_key}`、`<your_api_key>`、`YOUR_API_KEY`、`REPLACE_ME` 等 → 先问用户要真实 key，用 `--api-key` 传入，脚本自动替换。
- 若没给 `--api-key` 但存在占位，脚本会报错提醒——此时回去问用户要 key。
- 验证：`curl -I <url>` 能通即可。

> ⚠️ **远端 streamableHttp 的鉴权字段「因服务而异」，务必以官方配置为准（实测踩坑）**：不同远端 MCP 期望的鉴权字段不同——MinerU 远端（`mcp.mineru.net`）要 `env: {MINERU_API_TOKEN: "<token>"}`（WorkBuddy 会把 `env` 转发成同名请求头 `MINERU_API_TOKEN`）；McDSaver 等则要 `headers: {"Authorization":"Bearer <token>"}`。**没有「远端必须用 headers、env 无效」的统一规则**，切勿把 A 服务的写法套到 B 服务（曾把 MinerU 错改成 `Authorization: Bearer`，被服务器 401 拒绝）。**判定方法：以该 MCP 官方配置为准；配完实测握手，若出现 401 / 鉴权错误，先查「字段名对不对、Bearer 前缀有没有漏」**，而不是盲目换字段。
> 补充：WorkBuddy 在 `streamableHttp` 下**会转发 `env`**（作为同名请求头），所以官方用 `env` 的远端服务直接照抄即可，不必改成 `headers`。
> 注：**MinerU 的 REST API 文档写的是 `Authorization: Bearer`，但其 MCP 服务端的 `mcp.mineru.net` 读的是 `MINERU_API_TOKEN` 头**（故官方 MCP 配置用 `env`）——两套鉴权字段不同、别混。其 REST 文档完全没提 MCP / `open_upload_ui`，MCP 专属行为只能看工具 schema。

> ⚠️ **远端 MCP 处理本地文件：不能直接传本地路径（实测踩坑，反复测试浪费大量时间）**：文件解析类远端 MCP（如 MinerU `mcp.mineru.net`）部署在远端、**没有本地文件系统访问权限**。调用 `parse_*` 等工具时直接传 `C:\...\xxx.pdf` / `/Users/.../x.pdf` 等本地路径会被服务器拒绝（报错如 `Local file paths are not supported on this remote server. Call open_upload_ui to get the browser upload URL instead.`）。**这不是 MCP 配置问题，是远程服务的设计限制**——改配置、换字段都没用。正确做法二选一：
> - ① **用浏览器上传 UI（推荐，走 MCP 自身机制）**：先看这个 MCP 有没有 `open_upload_ui` 类工具（MinerU 的 `mcp__mineru__open_upload_ui` 即是，仅 streamable-http 模式可用）。调用它拿到一个浏览器上传链接，用户在浏览器里把本地文件传上去、由远端解析。上传后再按需调 `parse_*` 做后续处理。
> - ② **给公开 URL**：把文件放到远端能访问到的 URL（OneDrive/网盘分享链接、公开托管等），把该 URL 传给工具。**含机密的文件不要公开托管**——这类走 ① 的上传 UI 更安全（只传到服务商自己的服务器）。
> **排错铁律：先区分「配置错」还是「远端设计限制」**。本地路径被拒 = 设计限制（与配置无关），应走上传 UI / 公开 URL；只有 401 / 握手失败才是配置或鉴权问题。配置完远端文件类 MCP 后，**测试时若涉及本地文件，先问自己：这个 MCP 有没有 `open_upload_ui`？要不要给公开 URL？不要直接拿本地路径去测。**

### 方案二：本地 MCP（文件 / 文件夹 / zip）
**先在问答里判断「单文件够不够」**：
- 用户只给 `index.js` → 检查它的 `import`。若有外部包且同目录无 `node_modules` → 明确告诉用户：「单文件不够，还缺依赖，请给我整个包（文件夹或 zip），或允许我 `npm install`」。不要硬配。
- 用户给文件夹或 zip → 直接走下面命令。

```
# 给的是文件夹
node scripts/scaffold_mcp.js --name <服务名> --from-dir '<包文件夹路径>'

# 给的是 zip
node scripts/scaffold_mcp.js --name <服务名> --from-zip '<zip路径>'

# 包内没有 node_modules 时，若要允许安装依赖（需联网）：
node scripts/scaffold_mcp.js --name <服务名> --from-dir '<包文件夹>' --npm-install
```

**npx 远程包方式（无需下载 zip）**：若服务提供的是 npm 包名（如 `@scope/mcp-server-xxx`），运行时由 `npx -y` 自动拉取，无需你预先下载包或 zip：
```
node scripts/scaffold_mcp.js --name <服务名> --pkg <npm包名> [--env '{"KEY":"v"}']
```
- 这是 stdio 型，脚本生成 `command: "npx"`、`args: ["-y", <包名>]` 的条目。
- 适用：以 npm 包形式发布、你不想本地保存源码的 MCP（很多科学数据 / 工具类 MCP 如此）。首次运行需联网拉包。
- 验证同样走第四节的 `verify_mcp.js` 握手。

脚本会自动：找到 `package.json` 根目录（兼容 zip 双重嵌套）→ 复制到 `~/.workbuddy/mcp-servers/<服务名>/` → 读 `main` 定位入口 → 检查 `node_modules`（缺则警告；有 `--npm-install` 则安装）→ 生成 `type:stdio / command:node / args:[入口]` 条目。

**依赖决策（默认联网安装）**：若包内无 `node_modules`，**默认直接执行 `npm install`（联网）**，无需每回追问用户。仅当用户明确说「我有带 node_modules 的完整包 / 这是离线环境」时，才跳过安装、改让用户提供完整文件夹 / zip。
- 默认 → 追加 `--npm-install`（脚本已自动基于 `package-lock.json` 安装依赖）
- 用户自备完整包 / 离线 → 让用户提供含 `node_modules` 的文件夹 / zip，不加 `--npm-install`

> 注：`npm install` 只是安装「用户已提供的这个包」的运行依赖（如 `@modelcontextprotocol/sdk`、`axios`），**不属于上网替用户找 MCP 源码**，不违反铁律第 1 条。

**源码包自动编译（增强）**：若 zip/文件夹里 `main` 指向的入口（如 `build/index.js`）不存在、但 `package.json` 有 `build` 脚本（典型如 TypeScript 包 `tsc` 编译），脚本会**自动 `npm install`（含 devDependencies，如 typescript）并执行 `npm run build`** 生成入口，无需手动编译。纯源码包也能端到端配好。若编译后入口仍缺失，会明确告警。

**源码补丁与握手自检自愈（增强，应对"需要修源码才能被宿主接受"的包）**：除编译外，有些包能编译、能跑，却会被严格宿主（如 WorkBuddy）在 `initialize` 握手时拒绝——例如服务器在返回的 `capabilities` 里**广播了非标准的 `experimental` 能力**（`progressNotifications` / `cancellationSupport` / `extendedMetadata`），宿主 schema 不认，报 `capabilities.experimental.* Invalid input`。向导对此有两层防护：
- **Curated 补丁注册表** `known_patches.json`（skill 根目录）：登记已知「需修源码」的包。scaffold 在复制 / 编译前后，按 `packageName` 匹配并**自动应用补丁**（如移除 `lifecycle-manager.ts` 里的 `experimental` 广播块），幂等。新增同类包只需往注册表加一条。
- **握手自检 + 自愈（兜底，覆盖未知包）**：scaffold 加 `--self-check` 会在写入后启动 MCP、发 `initialize`、检查其返回的 `capabilities`；若发现非标准 `experimental` 广播，加 `--harden` 即**自动剥离并重新编译**。即便包不在注册表里，也能自愈。
> 这两个能力是当初配 `openpharma-org/fda-mcp-server` 时踩坑（纯 TS 源码需编译 + 广播 `experimental` 被宿主拒）后补上的，已沉淀进 skill，未来同类包自动处理。

**command 形态与跨平台可移植性（设计决策）**：本地型条目默认用**可移植的裸 `"node"`**（`command: "node"`，依赖宿主 PATH 解析），这是权衡后的选择：
- **跨用户 / 跨平台分享最稳**：各 AI 平台（WorkBuddy / Claude Desktop / VS Code / Cursor / Codex / OpenCode / 豆包工作 等）spawn MCP 时基本都会把自身或系统 node 放到 PATH；而 WorkBuddy 托管的 node 路径含**用户名与版本号、每台机器不同**，写死绝对路径反而跨机失效。
- **平台识别作为扩展点**：`scaffold_mcp.js` 内置 `detectTargetPlatform()`（当前可识别 `workbuddy` / `unknown`）。未来支持更多平台只需加分支，不破坏现有逻辑。
- **node 预检兜底**：配置时会对本地型条目跑 `node --version` 预检；若 PATH 不可达，仅提示用户常见 node 位置，**不自动改写为绝对路径**（避免破坏可移植性）。
- **绝对路径加固：默认不自动执行**。若目标机确无 node 且 PATH 不被注入，用户可手动 `--node <绝对路径>` 覆盖（属用户显式决策，非默认行为）。理由：PATH 解析失败（`spawn node ENOENT`）在主流平台概率极低，为低概率风险牺牲可移植性不划算。

**可选**：
- `--node <node.exe 绝对路径>`：node 不在 PATH 时指定（参考现有条目的写法）。
- `--overwrite`：安装目录已存在时覆盖。

### 凭据自适应（按需问用户）
- 只需 API key → `--api-key`（云端）或 `--env '{"API_KEY":"..."}'`（本地）
- 用户名 + 密码 → `--env '{"DB_USER":"u","DB_PASSWORD":"p"}'`（或该服务要求的变量名）
- 其它 token / OAuth → 问清变量名，放进 `--env` 或 JSON 的 `headers`
- 永远是「先问用户要真实值」，不要编造。

### 握手验证（本地 stdio 必做）
```
node scripts/verify_mcp.js --name <服务名>
# 若握手报 capabilities.experimental.* Invalid input，加 --harden 自动剥离并重建后重验：
node scripts/verify_mcp.js --name <服务名> --harden
```
- 会 spawn 进程 → `initialize` → `notifications/initialized` + `tools/list` → 返回工具名列表；并**打印服务器返回的 `capabilities`**。
- 通过才算配好；失败按 stderr 排错（常见：缺 node_modules、node 不在 PATH、包名 / 入口错）。
- **若返回里出现非标准 `capabilities.experimental`**：说明该服务器广播了严格宿主会拒绝的能力，加 `--harden` 让向导自动剥离并重新编译、再握手复验。这通常发生在某些第三方包（已知如 `openpharma-org/fda-mcp-server`）。
- 云端（方案一）用 `curl -I` 确认可达即可。

### 交付清单（配完复制给用户）
1. 已把 `<服务名>` 写进 `~/.workbuddy/mcp.json`。
2. **⚠️ 必须重启 WorkBuddy（完全退出后重新打开，不是仅刷新对话）** —— 改了 `mcp.json` 后连接器列表不会热更新，不重启就看不到新装的 MCP。这一步一定要写在交付清单里提醒用户。
3. 重启后打开 **连接器管理页 → 右上角「自定义连接器」→ 找到 `<服务名>` → 点「信任」启用**（新 MCP 不会自动生效）。
4. 调用试试（例如「用 `<服务名>` 查一下 XX」）。
5. 报错贴给我。

### 其它注意
- 永远只增改单个 server 条目，不覆盖整个 mcp.json（脚本已保证）。
- 密钥不硬编码进脚本 / 仓库；提醒用户 apikey 明文存在 mcp.json，勿外泄。
- mcp.json 开头若有 UTF-8 BOM，脚本会自动剥离。
- `--from-template` 仅供「自己从零写一个 MCP」，第三方服务禁用。

---

## 6. 多 MCP 治理（几十个怎么管）

生物医药场景往往累积几十个 MCP，治理比「装几个」更重要：

- **按需启停**：用不到的服务器在连接器页关闭 / 不点「信任」，需要时一键开启。这是控制「工具过多导致模型选错、上下文臃肿」的主要手段。
- **分组心法**：脑中按领域分组（专利文献 / 化学 / 靶点 / 临床 / 结构 / 办公），当前任务只需启用相关那组。
- **季度清点**：长期不可用 / 连续 90 天没用过的，禁用或卸载，别堆着。
- **兼容性巡检**：新装一个后跑一遍 `verify_mcp.js` 握手；注意协议版本兼容（例如某些 MCP 与宿主存在协议版本不匹配导致整体握手失败，需升级或替换）。
- **升级重审**：服务升级后权限需求变化的，重新过第 4 节审查五步法。
- **密钥轮换**：付费 MCP 的 key 泄露或过期，及时在 `mcp.json` 对应条目更新，团队共用模板不含真实凭证。

---

## 7. 配置排错速查

| 症状 | 高概率原因 | 处理 |
|---|---|---|
| 服务器列表里不出现 | 配置文件 JSON 语法错 / 路径错 | 校验 JSON；确认配置文件位置正确后重启宿主 |
| 出现但工具调用失败 | 命令不可执行 / 依赖缺失 | 手动在终端跑启动命令看报错；本地型跑 `verify_mcp.js` |
| 提示鉴权失败 | token 过期 / 环境变量没传进去 | 检查 `env` 字段拼写与 token 有效期 |
| 模型不用装好的工具 | 工具描述模糊 / 工具太多 | 精简常驻数量、关掉无关服务；任务里显式点名工具 |
| 响应超慢 | 服务器冷启动 / 网络代理 | 观察二次调用；检查代理配置 |
| 握手报协议版本不匹配 | MCP 与宿主协议版本不兼容 | 升级服务端或宿主；或暂用替代服务 |
| 本地型缺依赖 | 无 `node_modules` | 重跑脚本追加 `--npm-install` |
| 握手报 `capabilities.experimental.* Invalid input` | 服务器在 `initialize` 返回里广播了非标准 `experimental` 能力，被严格宿主拒绝 | 跑 `verify_mcp.js --name <服务名> --harden` 自动剥离并重建；或 scaffold 时加 `--self-check --harden` |
| 远端 MCP 报 `Local file paths are not supported` / 提示 `open_upload_ui` | 远端服务器无本地文件系统访问权限（设计限制，**非配置问题**） | 不要改配置；用该 MCP 的 `open_upload_ui` 工具拿浏览器上传链接，或传一个远端可访问的公开 URL。注意：这是 MinerU 等远端文件类 MCP 的常态，与鉴权/JSON 无关 |
| 远端 MCP 报 `404 Not Found` 且指向**提供方自己的后端域名**（如 `mineru.net/file-urls/batch`） | 提供方 MCP 服务端 bug / 临时故障：常把请求打到**不存在或已迁移的端点**（如漏了 `/api/v4` 前缀），并非你的配置错 | **不是你的 mcp.json 问题**。诊断：把 MCP 实际调用的 URL 与提供方官方文档端点对比——若正确端点返回 405/401 而 MCP 调用的返回 404，说明 MCP 硬编码了错误路径，向提供方反馈。可暂用其主站/REST API 替代。若 404 指向外部不可控域名则另查网络 |
| 上传 UI 提示「未检测到 API Token / 使用 Flash 模式」或解析只给 Markdown | token 没传导到上传/解析会话（提供方 MCP 服务端缺陷），退化成游客/Flash 模式 | 若握手层已证明 token 有效（如 `MINERU_API_TOKEN` 头 200、`Bearer` 401），则属提供方服务端 bug，不是你的字段配错；向提供方反馈，或改用其主站/REST API |

---

## 8. 边界说明
- MCP 生态迭代快，具体服务器的安装命令与配置格式以其官方仓库最新文档为准。
- 授予 AI 系统权限意味着接受相应风险，生产环境接入请先经安全团队评估。
- 本 skill 的脚本只处理「用户已提供的配置」，**不会替你上网寻找或下载 MCP 源码**。
