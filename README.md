# AI Multi-Chat

一键向多个 AI 站点发送消息的 Electron 桌面工具。选中多个站点，输入问题，顺序发送到所有选中的 AI，通过 playwright-cli + Chrome 扩展自动化浏览器操作。

## 技术栈

Electron 33 / React 18 / TypeScript 5.6 / Vite 5 / tsx 4.19 / playwright-cli

## 架构概览

```
┌─────────────────────────────────────────────────┐
│  Renderer (React + Vite)                        │
│  App.tsx → handleSend() → window.api.run()      │
│  onRunEvent 监听实时进度                          │
└────────────┬────────────────────────────────────┘
             │ IPC (contextBridge)
┌────────────▼────────────────────────────────────┐
│  Main Process (Electron + tsc → CommonJS)        │
│  main.ts: IPC handlers, run handler (顺序执行)    │
│  runner.ts: spawn('cmd.exe', node+tsx, script)   │
│  config.ts: SiteConfigManager + 脚本同步          │
└────────────┬────────────────────────────────────┘
             │ child_process.spawn (顺序，一个完成后再启动下一个)
┌────────────▼────────────────────────────────────┐
│  Site Script (node + tsx 执行 .ts)               │
│  c.attach() → c.goto() → c.fill() → c.click()   │
│  每个脚本独立 attach，文件锁保证扩展不冲突          │
└─────────────────────────────────────────────────┘
```

## 目录结构

```
ai-multi-chat/
├── package.json
├── tsconfig.main.json          # 主进程 CommonJS 编译配置
├── vite.config.ts              # 渲染进程 Vite 配置
├── src/
│   ├── main/
│   │   ├── main.ts             # Electron 入口，IPC handlers，顺序执行逻辑
│   │   ├── runner.ts           # 子进程 spawn 逻辑
│   │   └── config.ts           # 站点配置管理 + 启动时同步内置脚本
│   ├── preload/
│   │   └── preload.ts          # contextBridge 暴露 API
│   ├── renderer/
│   │   ├── index.html          # HTML 入口 (CSP 限制)
│   │   ├── main.tsx            # React 入口
│   │   ├── App.tsx             # 主组件：状态管理、事件监听、发送逻辑
│   │   ├── styles.css          # 暗色主题样式
│   │   ├── types.ts            # 前端类型定义
│   │   └── components/
│   │       ├── ChatInput.tsx   # 输入框 + 附件选择
│   │       ├── MessageList.tsx # 消息列表 + 站点状态展示
│   │       ├── Sidebar.tsx     # 侧边栏：站点选择
│   │       └── SiteSettings.tsx# 站点管理 CRUD
│   ├── shared/
│   │   ├── cli.ts              # playwright-cli 封装库 (attach/snapshot/fill/click...)
│   │   ├── types.ts            # 共享类型 (SitePlugin, RunResult)
│   │   └── template.ts         # 站点脚本模板
│   └── sites/                  # 内置站点脚本（版本管理 + 自动同步到 userData）
│       ├── chatglm.ts          # ChatGLM (chatglm.cn)
│       ├── chatgpt.ts          # ChatGPT (chatgpt.com)
│       ├── deepseek.ts         # DeepSeek (deepseek.com)
│       ├── doubao.ts           # 豆包 (doubao.com)
│       ├── gemini.ts           # Gemini (gemini.google.com)
│       ├── grok.ts             # Grok (grok.com)
│       ├── kimi.ts             # Kimi (kimi.moonshot.cn)
│       ├── qianwen.ts          # 通义千问 (qianwen.com)
│       └── yuanbao.ts          # 腾讯元宝 (yuanbao.tencent.com)
```

运行时，`config.ts` 的 `ensureSharedFiles()` 在 app 启动时自动将 `src/shared/cli.ts`、`types.ts` 和 `src/sites/*.ts` 同步到 `{userData}/` 目录（Windows: `%APPDATA%/ai-multi-chat/`）。

## 构建与运行

```bash
# 安装依赖
npm install

# 开发模式（编译主进程 + 启动 Electron）
npm run dev

# 渲染进程热更新（可选，另开终端）
npm run dev:renderer

# 完整构建
npm run build

# 启动
npm start
```

## 站点脚本开发

### 添加新站点

1. 在 `src/sites/` 下新建 `yoursite.ts`
2. 参考已有脚本的结构，实现 `SitePlugin` 接口
3. 重新构建 `npm run build`，启动后自动同步到 userData

### SitePlugin 接口

```typescript
interface SitePlugin {
  name: string;
  url: string;
  init(): Promise<void>;           // 导航到站点、等待加载
  run(prompt: string, filePath?: string): Promise<RunResult>;  // 发送消息
  newChat?(): Promise<void>;       // 可选：新建对话
}
```

### 脚本结构模板

```typescript
import * as c from "../cli.js";
import type { SitePlugin, RunResult } from "../types.js";

const KW = {
  input: ["textbox", "textarea", "contenteditable", "输入框占位文本"],
  send: ["发送", "send", "submit"],
};

const CONFIG = {
  url: "https://your-site.com",
  actionDelay: 800,
};

function log(...args: unknown[]) {
  console.log("[yoursite]", ...args);
}

async function fillPrompt(text: string): Promise<void> {
  const snap = c.snapshot();
  const ref = c.findByKeywords(snap, KW.input);
  if (ref) {
    c.fill(ref, text);
  } else {
    c.typeText(text);
  }
  await c.sleep(CONFIG.actionDelay);
}

async function clickSend(): Promise<void> {
  const snap = c.snapshot();
  const ref = c.findByKeywords(snap, KW.send);
  if (ref) c.click(ref); else c.press("Enter");
  await c.sleep(CONFIG.actionDelay);
}

export const plugin: SitePlugin = {
  name: "yoursite",
  url: CONFIG.url,

  async init() {
    c.goto(CONFIG.url);
    await c.sleep(3000);
  },

  async run(prompt: string, attachment?: string): Promise<RunResult> {
    const startTime = Date.now();
    const result: RunResult = {
      prompt, attachment, response: "",
      timestamp: new Date().toISOString(),
      duration: 0, success: false,
    };
    try {
      if (attachment) { c.upload(attachment); await c.sleep(2000); }
      await fillPrompt(prompt);
      await clickSend();
      log("已发送，不等待回复");
      result.success = true;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      log(`失败: ${result.error}`);
    }
    result.duration = Date.now() - startTime;
    return result;
  },
};

// ─── 独立运行入口 ──────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`用法: npx tsx src/sites/yoursite.ts "提示词" [--file ./image.png]`);
    process.exit(0);
  }
  let prompt = "";
  let filePath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file") filePath = args[++i];
    else if (!args[i].startsWith("--")) prompt = args[i];
  }

  c.setSession(process.env.PW_SESSION || "yoursite");
  if (!process.env.SKIP_ATTACH) {
    c.attach();
  }

  try {
    await plugin.init();
    const result = await plugin.run(prompt, filePath);
    console.log(`\n── 完成 ──\n耗时: ${(result.duration / 1000).toFixed(1)}s | 成功: ${result.success}`);
    if (result.error) console.log(`错误: ${result.error}`);
  } finally {
    if (!process.env.SKIP_ATTACH) c.detach();
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  main().catch((err) => { console.error("异常:", err); process.exit(1); });
}
```

### 核心 API

| API | 说明 |
|-----|------|
| `c.setSession(name)` | 设置 playwright-cli 会话名 |
| `c.attach()` | 通过 Chrome 扩展连接浏览器 |
| `c.detach()` | 断开连接 |
| `c.goto(url)` | 导航到 URL |
| `c.snapshot()` | 获取页面快照（返回带 ref 标记的元素树） |
| `c.findByKeywords(els, keywords)` | 按关键词匹配快照元素 |
| `c.fill(ref, text)` | 填充输入框 |
| `c.click(ref)` | 点击元素 |
| `c.press(key)` | 按键（如 Enter） |
| `c.typeText(text)` | 键入文本（无目标元素） |
| `c.upload(filePath)` | 上传文件 |
| `c.evalJs(expr)` | 执行 JS 表达式 |
| `c.sleep(ms)` | 异步等待 |

### 调试技巧

```bash
# 独立运行脚本（直接连接浏览器，不经过 Electron）
npx tsx src/sites/yoursite.ts "你好"

# 快照模式（只看页面结构，不执行操作）
npx tsx src/sites/yoursite.ts --discover
```

### 关键注意事项

1. **关键词匹配**：`findByKeywords` 按数组顺序匹配，靠前的优先。避免用太泛的词（如 `"聊天"` 可能匹配到侧边栏），尽量用输入框的占位文本
2. **发送后不等待**：脚本发送消息后立即返回，不等待 AI 回复
3. **`import.meta.url` 守卫**：必须用 `file:///`（三个斜杠），因为 Windows 路径 `C:\...` 转换后是 `file:///C:/...`
4. **每个脚本独立 attach**：通过 `c.attach()` 自行连接浏览器，`cli.ts` 的文件锁保证多个脚本不会同时 attach

## 关键设计决策与已知问题

### 1. 顺序执行

多站点脚本按选择顺序依次执行，一个完成后再启动下一个。这是因为 Playwright Chrome 扩展同一时间只能处理一个连接。

### 2. 文件锁序列化 attach

`cli.ts` 使用临时文件锁（`os.tmpdir()/.playwright-cli-attach.lock`）保证多个进程不会同时调用 `attach --extension`。锁自动检测并清理僵尸进程创建的过期锁。

### 3. 为什么不用 Electron 内置 Node 执行脚本

Electron 的 `process.execPath` 不支持 `--import` ESM loader hook，`node --import tsx/esm script.ts` 会静默挂起。因此改用系统安装的 `node` + `node_modules/tsx/dist/cli.mjs`。

### 4. 为什么不用 tsx.cmd

Windows 上 `npx tsx` 或 `tsx.cmd` 是 batch wrapper，作为子进程 spawn 时会立即返回 exit code 0（假成功）。解决方案是直接调用 `node node_modules/tsx/dist/cli.mjs`。

### 5. import.meta.url 守卫

tsx/esm loader 下 `import.meta.url` 返回 `file:///C:/...`（三个斜杠），守卫条件必须用 `` `file:///${process.argv[1].replace(/\\/g, "/")}` `` 匹配。

### 6. Windows 中文编码

`cmd.exe` 默认使用 GBK 编码，中文输出会乱码。runner 在 Windows 上的命令前拼接 `chcp 65001 >nul &&` 切换到 UTF-8。

### 7. Windows 路径引号嵌套

`cmd.exe /c` 中嵌套绝对路径 + 双引号会导致模块找不到。使用 `path.relative()` 将路径转为相对路径（CWD 为项目根目录）来规避。

## 前置要求

- Node.js 22+（脚本通过系统 node 执行）
- Chrome 浏览器 + Playwright 浏览器扩展
- `playwright-cli` 全局安装（`npm i -g @playwright/cli`）
- Windows 10+（已验证）/ macOS / Linux（代码兼容，未充分测试）
