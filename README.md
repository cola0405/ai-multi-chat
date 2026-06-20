# AI Multi-Chat

一键同时向多个 AI 站点发送消息的 Electron 桌面工具。选中多个站点，输入问题，并行发送到所有选中的 AI，通过 playwright-cli + Chrome 扩展自动化浏览器操作。

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
│  main.ts: IPC handlers, run handler              │
│    1. execSync('playwright-cli attach')  单次连接 │
│    2. 循环 spawn 子进程 (每站点一个)               │
│  runner.ts: spawn('cmd.exe', node+tsx, script)   │
│  config.ts: SiteConfigManager (JSON CRUD)        │
└────────────┬────────────────────────────────────┘
             │ child_process.spawn
┌────────────▼────────────────────────────────────┐
│  Site Script (node + tsx 执行 .ts)               │
│  sites/doubao.ts / kimi.ts / grok.ts / gemini.ts │
│  import * as c from '../cli.js'                  │
│  c.goto() → c.snapshot() → c.fill() → c.click() │
│  SKIP_ATTACH=1 → 跳过 attach, 复用主进程连接      │
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
│   │   ├── main.ts             # Electron 入口，IPC handlers，run 逻辑
│   │   ├── runner.ts           # 子进程 spawn 逻辑
│   │   └── config.ts           # 站点配置管理 (JSON 文件)
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
│   └── shared/
│       ├── cli.ts              # playwright-cli 封装库 (attach/snapshot/fill/click...)
│       ├── types.ts            # 共享类型 (SitePlugin, RunResult)
│       └── template.ts         # 站点脚本模板
```

运行时，站点脚本存储在 `{userData}/sites/` 目录下（Windows: `%APPDATA%/ai-multi-chat/sites/`），`cli.ts` 和 `types.ts` 在 app 启动时由 `ensureSharedFiles()` 自动拷贝到该目录。

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

注意：`package.json` 中 `main` 字段为 `dist/main/main/main/main.js`，这是因为 `tsconfig.main.json` 的 `rootDir=src` + `outDir=dist/main` 导致输出嵌套了一层。

## 站点脚本开发

每个站点是一个 `.ts` 文件，实现 `SitePlugin` 接口：

```typescript
interface SitePlugin {
  name: string;
  url: string;
  init(): Promise<void>;           // 导航到站点、等待加载
  run(prompt: string, filePath?: string): Promise<RunResult>;  // 发送消息
  newChat?(): Promise<void>;       // 可选：新建对话
}
```

脚本通过 `import * as c from '../cli.js'` 使用共享的浏览器操作库，核心 API：

| API | 说明 |
|-----|------|
| `c.setSession(name)` | 设置 playwright-cli 会话名 |
| `c.goto(url)` | 导航到 URL |
| `c.snapshot()` | 获取页面快照（返回带 ref 标记的元素树） |
| `c.findByKeywords(els, keywords)` | 按关键词匹配快照元素 |
| `c.fill(ref, text)` | 填充输入框 |
| `c.click(ref)` | 点击元素 |
| `c.press(key)` | 按键（如 Enter） |
| `c.upload(filePath)` | 上传文件 |
| `c.evalJs(expr)` | 执行 JS 表达式 |
| `c.sleep(ms)` | 异步等待 |

### 脚本结构约定

```typescript
import * as c from "../cli.js";

const plugin: SitePlugin = {
  name: "站点名",
  url: "https://example.com",
  async init() { /* 导航 + 等待加载 */ },
  async run(prompt, filePath?) { /* 找到输入框、填充、点击发送 */ },
};

async function main() {
  const args = process.argv.slice(2);
  const prompt = args[0]?.replace(/^"|"$/g, "");
  const filePath = args.includes("--file") ? args[args.indexOf("--file") + 1] : undefined;

  c.setSession("sitename");
  if (!process.env.SKIP_ATTACH) c.attach();

  try {
    await plugin.init();
    await plugin.run(prompt, filePath);
    console.log("发送完成");
  } finally {
    if (!process.env.SKIP_ATTACH) c.detach();
  }
}

// 必须无条件调用 main()，不能用 import.meta.url 守卫
main().catch((err) => { console.error("异常:", err); process.exit(1); });
```

## 关键设计决策与已知陷阱

### 1. 为什么不用 Electron 内置 Node 执行脚本

Electron 的 `process.execPath` 不支持 `--import` ESM loader hook，`node --import tsx/esm script.ts` 会静默挂起，无任何输出和错误。因此改用系统安装的 `node` + `node_modules/tsx/dist/cli.mjs` 来执行脚本。

### 2. 为什么不用 tsx.cmd

Windows 上 `npx tsx` 或 `tsx.cmd` 是 batch wrapper，作为子进程 spawn 时会立即返回 exit code 0（假成功），实际脚本并未执行完毕。解决方案是直接调用 `node node_modules/tsx/dist/cli.mjs`。

### 3. import.meta.url 守卫失效

tsx/esm loader 下 `import.meta.url` 与 `file://${process.argv[1]}` 的路径格式不一致（大小写、URL 编码差异），导致 `if (import.meta.url === ...)` 条件永假。所有站点脚本必须无条件调用 `main()`。



### 4. Windows 中文编码

`cmd.exe` 默认使用 GBK 编码，中文输出会乱码。runner 在 Windows 上的命令前拼接 `chcp 65001 >nul &&` 切换到 UTF-8。

### 5. Windows 路径引号嵌套

`cmd.exe /c` 中嵌套绝对路径 + 双引号会导致模块找不到。使用 `path.relative()` 将路径转为相对路径（CWD 为项目根目录）来规避。

### 6. ensureSharedFiles 只在启动时同步

`config.ts` 的 `ensureSharedFiles()` 仅在 app 启动时将 `src/shared/cli.ts` 和 `types.ts` 拷贝到 `userData`。修改这两个源文件后，需要手动拷贝或重启 app 才能生效。

### 7. tsconfig 排除 template.ts

`src/shared/template.ts` 是纯文本模板（用于在前端展示给用户的脚本模板），被 `tsconfig.main.json` exclude。如果将其包含进编译，其中的 `import.meta` 等 ESM 语法会在 CommonJS 模式下报错。

### 8. rootDir 导致输出路径嵌套

`tsconfig.main.json` 设置 `rootDir: "src"` + `outDir: "dist/main"`，编译输出为 `dist/main/main/main.js`（多一层 `main/`）。`package.json` 的 `main` 字段必须指向正确的嵌套路径。



## 前置要求

- Node.js 22+（脚本通过系统 node 执行）
- Chrome 浏览器 + Playwright 浏览器扩展
- `playwright-cli` 全局安装（`npm i -g @playwright/cli`）
- Windows 10+（已验证）/ macOS / Linux（代码兼容，未充分测试）
