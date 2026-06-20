/**
 * DeepSeek (chat.deepseek.com) 站点脚本
 *
 * 独立运行:
 *   npx tsx src/sites/deepseek.ts "你好"
 *   npx tsx src/sites/deepseek.ts "分析图片" --file ./test.png
 *
 * 通用入口:
 *   npx tsx src/run.ts --site deepseek "你好"
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as c from "../cli.js";
import type { SitePlugin, RunResult } from "../types.js";

// ─── 元素匹配关键词 ──────────────────────────────────────
const KW = {
  input: [
    "textbox",
    "textarea",
    "contenteditable",
    "输入",
    "聊天",
    "输入框",
    "prompt",
    "message",
    "请输入",
    "问点什么",
    "给DeepSeek发消息",
  ],
  send: [
    "发送",
    "send",
    "submit",
    "提交",
    "arrow-up",
    "ArrowUp",
  ],
  stop: [
    "停止",
    "stop",
    "停止生成",
    "cancel",
  ],
  upload: [
    "上传",
    "upload",
    "attach",
    "附件",
    "file",
    "文件",
    "image",
    "图片",
    "+",
  ],
  newChat: [
    "新对话",
    "新聊天",
    "new chat",
    "new-chat",
    "新建对话",
    "开启新对话",
  ],
  response: [
    "assistant",
    "回答",
    "回复",
    "answer",
    "response",
    "bot",
    "ai",
    "deepseek",
  ],
};

const CONFIG = {
  url: "https://chat.deepseek.com",
  responseTimeout: 120_000,
  actionDelay: 800,
};

// ─── 内部逻辑 ──────────────────────────────────────────
function log(...args: unknown[]) {
  console.log("[deepseek]", ...args);
}

async function fillPrompt(text: string): Promise<void> {
  const snap = c.snapshot();
  const ref = c.findByKeywords(snap, KW.input);

  if (ref) {
    log(`找到输入框: ${ref}`);
    c.fill(ref, text);
  } else {
    log("未找到输入框 ref，尝试点击后键入");
    const clickRef = c.findByKeywords(snap, ["输入", "聊天", "请输入", "问点什么"]);
    if (clickRef) c.click(clickRef);
    await c.sleep(500);
    c.typeText(text);
  }

  log(`已输入 (${text.length} 字)`);
  await c.sleep(CONFIG.actionDelay);
}

async function uploadAttachment(filePath: string): Promise<void> {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) throw new Error(`附件不存在: ${absPath}`);

  log(`上传附件: ${absPath}`);

  // 策略1：upload 命令
  try {
    c.upload(absPath);
    log("upload 成功");
    await c.sleep(2000);
    return;
  } catch {
    // 策略2：找上传按钮 → drop
  }

  const snap = c.snapshot();
  const ref = c.findByKeywords(snap, KW.upload);
  if (ref) {
    c.drop(ref, absPath);
    log(`drop ${ref} 成功`);
    await c.sleep(2000);
    return;
  }

  throw new Error("未找到上传入口");
}

async function clickSend(): Promise<void> {
  const snap = c.snapshot();
  const ref = c.findByKeywords(snap, KW.send);

  if (ref) {
    c.click(ref);
    log(`点击发送: ${ref}`);
  } else {
    log("未找到发送按钮，按 Enter");
    c.press("Enter");
  }

  await c.sleep(CONFIG.actionDelay);
}

async function waitForResponse(): Promise<string> {
  log("等待回复...");
  await c.sleep(5000);

  const startTime = Date.now();
  let lastText = "";
  let stableCount = 0;
  let wasGenerating = false;

  while (Date.now() - startTime < CONFIG.responseTimeout) {
    const snap = c.snapshot();

    // 检测"停止"按钮
    const stopRef = c.findByKeywords(snap, KW.stop);
    if (stopRef) {
      wasGenerating = true;
      log("生成中...");
      await c.sleep(3000);
      continue;
    }

    if (wasGenerating && !stopRef) {
      log("生成完成");
      await c.sleep(1000);
      return extractResponse();
    }

    // 内容稳定检测
    const current = extractResponseFromSnap(snap);
    if (current === lastText && current.length > 20) {
      stableCount++;
      if (stableCount >= 3) {
        log("内容稳定，完成");
        return current;
      }
    } else {
      stableCount = 0;
    }
    lastText = current;

    await c.sleep(3000);
  }

  log("超时，提取当前内容");
  return extractResponse();
}

function extractResponse(): string {
  return extractResponseFromSnap(c.snapshot());
}

function extractResponseFromSnap(snap: c.SnapshotElement[]): string {
  for (const kw of KW.response) {
    for (const el of snap) {
      if (el.lower.includes(kw)) {
        const texts = el.line.match(/["""\u201c]([^"""\u201d]+)["""\u201d]/g);
        if (texts) {
          return texts.map((t) => t.replace(/["""\u201c\u201d]/g, "")).join(" ");
        }
      }
    }
  }

  // 兜底 eval
  try {
    return c.evalJs(
      `document.querySelector('[class*="assistant" i],[class*="answer" i],[class*="response" i]')?.innerText?.slice(-2000)||''`
    );
  } catch {
    return "[未能提取回复]";
  }
}

// ─── 插件导出 ──────────────────────────────────────────
export const plugin: SitePlugin = {
  name: "deepseek",
  url: CONFIG.url,

  async init() {
    log(`导航到 ${CONFIG.url}`);
    c.goto(CONFIG.url);
    await c.sleep(3000);
    log("就绪");
  },

  async run(prompt: string, attachment?: string): Promise<RunResult> {
    const startTime = Date.now();
    const result: RunResult = {
      prompt,
      attachment,
      response: "",
      timestamp: new Date().toISOString(),
      duration: 0,
      success: false,
    };

    try {
      if (attachment) await uploadAttachment(attachment);
      await fillPrompt(prompt);
      await clickSend();
      result.response = await waitForResponse();
      result.success = true;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      log(`失败: ${result.error}`);
    }

    result.duration = Date.now() - startTime;
    return result;
  },

  async newChat() {
    log("新对话...");
    const snap = c.snapshot();
    const ref = c.findByKeywords(snap, KW.newChat);
    if (ref) {
      c.click(ref);
      await c.sleep(2000);
      return;
    }
    c.goto(CONFIG.url);
    await c.sleep(3000);
  },
};

// ─── 独立运行入口 ──────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
DeepSeek 自动化

用法:
  npx tsx src/sites/deepseek.ts "提示词"
  npx tsx src/sites/deepseek.ts "提示词" --file ./image.png
  npx tsx src/sites/deepseek.ts --discover

前置:
  Chrome 安装 Playwright 扩展并保持打开
  已在浏览器中登录 DeepSeek 账号
`);
    process.exit(0);
  }

  let prompt = "";
  let filePath: string | undefined;
  let discover = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--file":
        filePath = args[++i];
        break;
      case "--discover":
        discover = true;
        break;
      default:
        if (!args[i].startsWith("--")) prompt = args[i];
    }
  }

  c.setSession(process.env.PW_SESSION || "deepseek");
  if (!process.env.SKIP_ATTACH) {
    console.log("[deepseek] 正在连接 Chrome (playwright-cli attach)...");
    c.attach();
    console.log("[deepseek] Chrome 已连接");
  } else {
    console.log("[deepseek] Chrome 已由主进程连接，跳过 attach");
  }

  try {
    await plugin.init();

    if (discover) {
      console.log("\n═══ 页面快照 ═══\n");
      console.log(c.snapshotRaw());
      console.log("\n═══ 完毕 ═══\n");
      return;
    }

    if (!prompt) {
      console.error("请提供提示词");
      process.exit(1);
    }

    const result = await plugin.run(prompt, filePath);

    console.log(`\n── 完成 ──`);
    console.log(`耗时: ${(result.duration / 1000).toFixed(1)}s`);
    console.log(`成功: ${result.success}`);
    if (result.error) console.log(`错误: ${result.error}`);
    console.log(`\n── 回复 ──\n${result.response}\n`);
  } finally {
    if (!process.env.SKIP_ATTACH) {
      c.detach();
    }
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  main().catch((err) => {
    console.error("异常:", err);
    process.exit(1);
  });
}