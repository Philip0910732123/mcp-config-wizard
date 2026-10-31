// 最小 MCP stdio 服务骨架（纯 Node，零依赖，无需 npm install）
// 这是给"本地 index.js 型 MCP"用户的起点模板。
// 用法：node index.js
// 配置方式见 SKILL.md（scaffold_mcp.js --type local --from-template）

const readline = require('readline');

// ============================================================
// 1) 在这里声明你的工具（名称、描述、输入参数 schema）
// ============================================================
const TOOLS = [
  {
    name: 'hello',
    description: '示例工具：回显用户输入的文本',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要回显的文本' } },
      required: ['text']
    }
  }
  // 复制上面的对象即可新增工具，例如：
  // , {
  //     name: 'search_fda',
  //     description: '查询 FDA 数据',
  //     inputSchema: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] }
  //   }
];

// ============================================================
// 2) 在这里实现每个工具的逻辑
// ============================================================
function handleTool(name, args) {
  if (name === 'hello') {
    return { content: [{ type: 'text', text: `你说了: ${args.text}` }] };
  }
  // if (name === 'search_fda') { ... 调用 FDA API，返回 { content: [...] } ... }
  throw new Error(`未知工具: ${name}`);
}

// ============================================================
// 3) MCP stdio 传输层（换行分隔的 JSON-RPC，无需改动）
// ============================================================
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handleMessage(msg);
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handleMessage(msg) {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0', id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'local-mcp-skeleton', version: '0.1.0' }
      }
    });
  } else if (msg.method === 'notifications/initialized') {
    // 无需回复
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
  } else if (msg.method === 'tools/call') {
    try {
      const result = handleTool(msg.params.name, msg.params.arguments || {});
      send({ jsonrpc: '2.0', id: msg.id, result });
    } catch (e) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message } });
    }
  }
}
