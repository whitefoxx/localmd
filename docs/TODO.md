# TODO / 规划

> 2026-07-11:远程 MCP server 支持(C8)与 **web-agent 桥接均已完成**。
> Settings 里配置 Streamable HTTP 端点或 Chrome 扩展 ID(32 位 a-p,自动选
> Port 传输),工具以 `mcp__<server>__<tool>` 注入两个 provider。web-agent 的
> `web_task` 已实测跑通(browser-md agent 委托浏览任务 → web-agent 引擎执行
> → 结果回传)。注意:扩展 manifest 带 `key` 字段时,ID 由 key 派生——重载后
> ID 会变,可用 `sha256(base64decode(key))[:32]` 映射到 a-p 计算。

## web-agent 桥接:把浏览器自动化当作 MCP 式工具(已完成,设计存档)

**动机**:browser-md 是纯网页,agent 没有网页浏览能力(fetch 任意站点被 CORS 挡);
web-agent(Chrome 扩展)有 host 权限与完整的浏览 agent 引擎。桥接后,browser-md
的 agent 可以把"搜索/读网页/网页操作"类任务整体委托出去——例如「查一下 X 的最新
进展,整理进 wiki 并注明来源」。

**通道**:`externally_connectable`(Chrome 官方的网页↔扩展通信机制)

- web-agent manifest 声明允许的页面源(收紧到 localhost:5173 + 部署域名——列入的
  任何页面都能驱动扩展,不能放宽)
- browser-md 侧 `chrome.runtime.connect(EXTENSION_ID)` 建长连接 Port,JSON-RPC
  消息双向走,进度事件流式回推;探测不到扩展时优雅降级(不注册工具)
- 扩展 ID 需固定(manifest 配 key),避免开发/打包不一致

**集成粒度**:高层委托(推荐,先做)——只暴露一个 `web_task(task)` 工具,把任务
交给 web-agent 自己的 agent loop(独立上下文、自己的 LLM 配置、自己的安全确认),
只回传最终答案。与 run_subagent 同构。协议消息按 MCP 的 `tools/list` / `tools/call`
形状定义,将来接真正的远程 MCP server 时同一套工具注册抽象直接复用。
低层桥接(navigate/click/read/screenshot 逐个暴露)暂不做——往返多,且截图→视觉、
元素引用、脱敏这些 web-agent 引擎已解决,不值得在外面再驱动一遍。

**工作量**:web-agent 侧 manifest + background 对外 handler(喂任务给 engine、回推
进度/结果)约 150-300 行;browser-md 侧扩展桥接层 + 动态注册 `web_task` + 设置里的
连接状态显示,约 200 行。最小闭环验收:跑通"搜索并总结"场景。

**初版边界**:web-agent 的 LLM 配置保持独立(自己的 key 管理),不打通。

## Backlog(已确认暂缓)

- **GitHub 同步 live 验证**:push/pull 代码与错误路径已测,但真实推送需用户 PAT
  (Settings → Git & GitHub;README 有 token 指南)
- **扫描版 PDF 的 OCR**:无文本层的 PDF 索引产出 0 块(trace-app 用 macOS Vision,
  浏览器可考虑 tesseract.js,精度/体积待评估)
- **EPUB 页内截图**:epub.js 渲染的是 iframe HTML,无现成区域截图;若做,用
  getDisplayMedia(preferCurrentTab)抓帧 + 自绘选框裁剪(每次多一步浏览器确认,
  画质受屏幕分辨率限制)。当前结论:用系统截图(⌘⇧4)+ 聊天粘贴即可
- **tracked 二进制的内容修改检测**:需哈希全文件,status 阶段不可行;维持终端处理
