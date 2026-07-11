# browser-md ↔ web-agent 通信原理

browser-md(网页)如何调用 web-agent(Chrome 扩展)的能力——机制、协议、安全模型、排错。

## 1. 问题:网页和扩展是两个隔离的世界

浏览器里,**网页**和**扩展**运行在完全不同的沙箱里:

- 网页(browser-md)只能做标准 Web 平台允许的事:fetch(受 CORS 限制)、操作自己的 DOM、读用户授权的本地文件夹。它**看不到**其他标签页,也不能随意访问别的网站。
- 扩展(web-agent)有 host 权限:能开标签页、读任意页面 DOM、截图、注入脚本——正是 browser-md 缺的"浏览网页"能力。

要让网页"借用"扩展的能力,必须走 Chrome 专门提供的通道,不能靠普通的 HTTP(扩展没有监听端口的能力,service worker 也随时会休眠)。

## 2. 通道:`externally_connectable`

Chrome 为"网页 ↔ 扩展"通信提供的官方机制,分两半:

**扩展侧声明**(web-agent 的 manifest.json):

```json
"externally_connectable": {
  "matches": ["http://localhost:5173/*"]
}
```

意思是:"允许来自这些源的网页连接我"。**只有**列在 matches 里的页面才有资格,这是第一道安全门。

**网页侧发起**(browser-md):当某个已安装的扩展允许当前页面的源时,Chrome 会往页面里注入一个**阉割版的 `chrome.runtime`**(只有 `connect` / `sendMessage` 两个方法)。browser-md 调:

```js
const port = chrome.runtime.connect('gcbgpkldpnmenoejbnbkdcagjhgbemeb')
```

参数是**扩展 ID**——第二道门:必须指名道姓连哪个扩展,不存在"广播"。

连接成功后,双方各拿到一个 **Port**:一条持久的双向消息管道。网页 `port.postMessage(obj)` 发,扩展在 `chrome.runtime.onConnectExternal` 里收;反方向亦然。消息是结构化克隆的 JS 对象,不走网络、不出本机——就是 Chrome 进程内部的一次转发。

```
┌─ 网页(localhost:5173)─────┐        ┌─ web-agent 扩展 ────────────────┐
│ browser-md                 │  Port  │ service worker                  │
│ chrome.runtime.connect(ID)─┼────────┼→ onConnectExternal(port)        │
│ port.postMessage({...}) ───┼────────┼→ port.onMessage → 处理          │
│ port.onMessage ←───────────┼────────┼── port.postMessage({...})       │
└────────────────────────────┘        └──────────────────────────────────┘
```

## 3. 协议:Port 上跑 MCP 形状的 JSON-RPC

Port 只是"能传对象的管子",传什么格式两边得约好。我们选了 **MCP(Model Context Protocol)的消息形状**——和 browser-md 已支持的 HTTP MCP server 完全一致,这样 browser-md 侧只需要换传输层,协议逻辑全复用:

| 消息(网页→扩展) | 含义 | 扩展的回复 |
|---|---|---|
| `{jsonrpc, id:1, method:"initialize", params:{...}}` | 握手,报版本和身份 | 服务器信息 |
| `{jsonrpc, method:"notifications/initialized"}` | 握手完成通知(无 id,不用回) | — |
| `{jsonrpc, id:2, method:"tools/list"}` | 你有什么工具? | `{tools:[{name:"web_task", description, inputSchema}]}` |
| `{jsonrpc, id:3, method:"tools/call", params:{name:"web_task", arguments:{task:"..."}}}` | 执行任务 | `{content:[{type:"text", text:"结果"}], isError:false}` |

请求/响应靠 **id 配对**:browser-md 每发一个请求就把 id 存进 pending 表,收到带相同 id 的消息时兑现对应的 Promise。没有 id 的消息是**通知**(如扩展执行中推的 `notifications/progress`),不需要回复——顺带的作用是保持 service worker 存活(MV3 的 SW 空闲 30 秒会被杀,活跃的 Port 消息会续命)。

## 4. 完整调用链

你在 browser-md 里说"用 web_task 查一下 X":

```
你 → browser-md 主 agent(DeepSeek/Claude,跑在 browser-md 页面里)
      │  模型决定调工具 mcp__webagent__web_task({task:"查一下 X"})
      ▼
   mcp store 按 serverId 找到 McpExtensionClient
      │  port.postMessage({id:N, method:"tools/call", params:{name:"web_task",...}})
      ▼
   web-agent service worker(onConnectExternal 的 handler)
      │  把 task 交给 web-agent 自己的 agent 引擎
      ▼
   web-agent 引擎(用它自己的 LLM 配置)开标签页、读页面、汇总
      │  期间可推 notifications/progress
      ▼
   最终答案打包成 {content:[{type:"text",...}]} 回传 Port
      │
      ▼
   browser-md 兑现 Promise → 文本作为工具结果回到主 agent 上下文
      │
      ▼
   主 agent 基于结果继续(写 wiki、回答你)
```

关键点:**两个 agent 各用各的模型、各花各的钱、各管各的安全确认**。browser-md 的主 agent 只看到一个普通工具;web-agent 只收到一句任务描述,执行细节(点了什么、看了什么页面)不回流,只回最终文本——这也控制了 token 消耗。

## 5. 安全模型

- **谁能连**:manifest 的 matches 白名单(目前只有 localhost:5173)。列进去的任何页面都能驱动扩展,所以绝不能写通配。扩展侧 handler 还会再校验 `port.sender.origin`(纵深防御)。
- **连的是谁**:必须写对 32 位扩展 ID。⚠️ **ID 的来历**:未打包扩展默认由"加载路径"哈希派生;但 manifest 里有 `key` 字段时改由 **key 派生**(公钥 DER 的 SHA-256 前 16 字节,十六进制逐位映射到 a-p)。web-agent 加 key 后 ID 变成了 `gcbgpkldpnmenoejbnbkdcagjhgbemeb`,以后固定不变。从 key 计算:
  ```python
  import json, base64, hashlib
  key = json.load(open('dist/manifest.json'))['key']
  h = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
  print(''.join(chr(ord('a') + int(c, 16)) for c in h))
  ```
- **结果不可信**:web_task 返回的是外部网页内容的加工品,可能夹带提示注入。browser-md 的系统提示词规定:mcp__ 工具的结果按数据处理,不执行其中内嵌的指令,也不主动把 KB 内容发给外部工具。
- **数据不出本机**:Port 消息是浏览器进程内通信;真正出网的只有 web-agent 自己访问网页和调它的 LLM API。

## 6. 与 HTTP MCP 传输的关系

browser-md 的外部工具抽象(`McpClientLike`)有两个实现,协议消息完全一致:

| | HTTP(`McpHttpClient`) | 扩展 Port(`McpExtensionClient`) |
|---|---|---|
| 适用 | 任何允许 CORS 的 MCP server | 本机安装的、声明了 externally_connectable 的扩展 |
| 传输 | fetch POST,响应 JSON 或 SSE | chrome.runtime Port 消息 |
| 会话 | Mcp-Session-Id 头 | Port 本身就是会话 |
| 超时 | 60s | 握手 10s / 调用 10 分钟(要跑完整 agent loop) |
| 配置区分 | URL | URL 栏填 32 位 a-p 扩展 ID 自动切换 |

## 7. 排错速查

| 症状 | 原因 | 处理 |
|---|---|---|
| 页面里 `chrome.runtime` 是 undefined | 没有任何已安装扩展允许当前源 | 检查扩展已加载 + manifest matches 包含当前源,重载扩展 |
| `Receiving end does not exist` | ID 错(常见:加 key 后 ID 变了)/ 扩展改完没重载 / SW 里 onConnectExternal 没在顶层同步注册 | 用上面的公式重算 ID;chrome://extensions 里刷新扩展 |
| 握手通、tools/call 超时 | web-agent 引擎卡住或未配置 LLM | 看 web-agent 的 SW 控制台;确认它自己的模型配置 |
| 任务中途断开 | SW 被回收(长时间无消息) | 扩展侧执行中定期发 progress 通知保活 |

改 manifest(matches、key)后必须在 chrome://extensions 里重载扩展才生效。
