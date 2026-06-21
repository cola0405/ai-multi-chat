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
│  Site Script (完全独立 .ts，内联所有工具函数)       │
│  pw() → snapshot() → click() → typeText()       │
│  每个脚本自带 attach/goto/upload 逻辑             │
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
│   │   ├── runner.ts           # 子进程 spawn 逻辑（stdin 传 prompt）
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
│   └── sites/                  # 站点脚本（每个完全独立，可单独运行）
│       ├── qianwen.ts          # 通义千问 (qianwen.com)
│       ├── yuanbao.ts          # 腾讯元宝 (yuanbao.tencent.com)
│       ├── chatglm.ts          # ChatGLM (chatglm.cn)
│       ├── chatgpt.ts          # ChatGPT (chatgpt.com)
│       ├── deepseek.ts         # DeepSeek (deepseek.com)
│       ├── doubao.ts           # 豆包 (doubao.com)
│       ├── gemini.ts           # Gemini (gemini.google.com)
│       ├── grok.ts             # Grok (grok.com)
│       └── kimi.ts             # Kimi (kimi.moonshot.cn)
```

每个站点脚本完全自包含，内联所有 playwright-cli 封装函数，不依赖任何共享模块。

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

## 命令行直接调用

每个脚本都可以独立运行，不依赖 Electron：

```bash
# 只发文本
npx tsx src/sites/qianwen.ts "你好"

# 带附件
npx tsx src/sites/qianwen.ts "分析图片" --file ./test.png

# 通过 stdin 传入 prompt
echo "你好" | npx tsx src/sites/qianwen.ts
```

将 `qianwen` 替换为任意站点名即可（`yuanbao`、`chatglm`、`grok` 等）。

## 站点脚本开发

### 添加新站点

1. 在 `src/sites/` 下新建 `yoursite.ts`
2. 复制任意现有脚本作为模板
3. 修改站点 URL、关键词、上传逻辑
4. 重新构建 `npm run build`，启动后自动同步到 userData

### 脚本结构

每个脚本完全独立，结构如下：

```typescript
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

// ─── playwright-cli 封装（每个脚本内联）────────────────
const SESSION = process.env.PW_SESSION || "yoursite";

function pw(args: string, timeout = 60_000): string { /* ... */ }
function runCode(code: string): string { /* ... */ }
function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
function attach() { /* playwright-cli attach --extension=chrome */ }
function detach() { /* playwright-cli detach */ }
function goto(url: string) { pw(`goto ${url}`); }
function snapshot() { /* 解析 playwright-cli snapshot 输出 */ }
function find(els, kws) { /* 关键词匹配 */ }
function click(ref: string) { pw(`click ${ref}`); }
function typeText(text: string) { /* 聚焦编辑器 → execCommand('insertText') → input 事件 */ }
function press(key: string) { pw(`press ${key}`); }
function evalJs(expr: string): string { /* ... */ }
async function readStdin(): Promise<string> { /* ... */ }

// ─── 站点逻辑（每个脚本独立实现）───────────────────────
const URL = "https://your-site.com";
const KW = {
  input: ["输入框占位文本"],
  send: ["发送", "send"],
};

function log(...args: unknown[]) { console.log("[yoursite]", ...args); }

async function upload(filePath: string) {
  // 站点特定的上传逻辑（drop 事件 / 点击按钮+菜单 / setInputFiles 等）
}

async function fillPrompt(text: string) { /* 找输入框 → 点击 → typeText */ }
async function clickSend() { /* 找发送按钮 → 点击 */ }

async function main() {
  const args = process.argv.slice(2);
  // 解析 --file 和 prompt 参数
  // stdin 兜底读取 prompt
  // attach → goto → upload → fillPrompt → send → detach
}

main().catch(err => { console.error("异常:", err); process.exit(1); });
```

### 上传策略参考

不同站点的上传机制不同，以下是已验证的策略：

| 站点 | 上传方式 |
|------|----------|
| 千问 | drop 事件 → `[data-slate-editor]` |
| 元宝 | drop 事件 → `.ql-editor` |
| chatglm | 点击 `.upload-image-btn` → 菜单 "本地文件选择" → setInputFiles |
| grok | 点击 "附件" 按钮 → 菜单 "上传文件" → setInputFiles |
| chatgpt/deepseek/kimi/doubao/gemini | drop 事件 → 通用编辑器选择器 |

### 发送策略

部分站点使用 `clickSend()`（点击发送按钮），部分直接 `press("Enter")`：

| 站点 | 发送方式 |
|------|----------|
| chatgpt, gemini, yuanbao, grok | `clickSend()` 点击发送按钮 |
| doubao, kimi, qianwen, chatglm, deepseek | `press("Enter")` |

### 调试技巧

```bash
# 独立运行脚本（直接连接浏览器，不经过 Electron）
npx tsx src/sites/yoursite.ts "你好"

# 通过 playwright-cli 手动调试
playwright-cli attach --extension=chrome --session=yoursite
playwright-cli -s=yoursite goto https://your-site.com
playwright-cli -s=yoursite snapshot
playwright-cli -s=yoursite click e5
playwright-cli -s=yoursite detach
```

### 关键注意事项

1. **关键词匹配**：避免用太泛的词（如 `"上传"` 可能匹配到侧边栏），尽量用输入框的占位文本
2. **发送后不等待**：脚本发送消息后立即返回，不等待 AI 回复
3. **prompt 通过 stdin 传递**：runner.ts 用 stdin 传 prompt，避免 cmd.exe 特殊字符截断
4. **每个脚本独立 attach**：各脚本自行连接浏览器，互不干扰

## 关键设计决策

### 1. 顺序执行

多站点脚本按选择顺序依次执行，一个完成后再启动下一个。Playwright Chrome 扩展同一时间只能处理一个连接。

### 2. stdin 传参

runner.ts 通过 stdin 传递 prompt，避免 `cmd.exe` 中特殊字符（`&`、`|`、`"` 等）被 shell 截断。

### 3. 每个脚本完全独立

不依赖共享模块（cli.ts），修改一个站点不影响其他站点。每个脚本内联 playwright-cli 封装函数。

### 4. 为什么不用 Electron 内置 Node 执行脚本

Electron 的 `process.execPath` 不支持 `--import` ESM loader hook，`node --import tsx/esm script.ts` 会静默挂起。因此改用系统安装的 `node` + `node_modules/tsx/dist/cli.mjs`。

### 5. 为什么不用 tsx.cmd

Windows 上 `npx tsx` 或 `tsx.cmd` 是 batch wrapper，作为子进程 spawn 时会立即返回 exit code 0（假成功）。解决方案是直接调用 `node node_modules/tsx/dist/cli.mjs`。

### 6. Windows 中文编码

`cmd.exe` 默认使用 GBK 编码，中文输出会乱码。runner 在 Windows 上的命令前拼接 `chcp 65001 >nul &&` 切换到 UTF-8。

## 前置要求

- Node.js 22+（脚本通过系统 node 执行）
- Chrome 浏览器 + Playwright 浏览器扩展
- `playwright-cli` 全局安装（`npm i -g @playwright/cli`）
- Windows 10+（已验证）/ macOS / Linux（代码兼容，未充分测试）
