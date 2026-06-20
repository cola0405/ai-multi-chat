/**
 * Grok (grok.com) 站点脚本
 *
 * 独立运行:
 *   npx tsx src/sites/grok.ts "Hello"
 *   npx tsx src/sites/grok.ts "分析图片" --file ./test.png
 *
 * 通用入口:
 *   npx tsx src/run.ts --site grok "Hello"
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
    "prompt",
    "input",
    "enter a prompt",
    "ask grok",
    "message",
  ],
  send: [
    "send",
    "submit",
    "发送",
    "提交",
    "arrow-up",
    "ArrowUp",
    "send message",
  ],
  stop: [
    "stop",
    "停止",
    "stop generating",
    "cancel",
  ],
  upload: [
    "upload",
    "attach",
    "file",
    "image",
    "上传",
    "附件",
    "add file",
    "add image",
    "+",
  ],
  newChat: [
    "new chat",
    "新对话",
    "新聊天",
    "clear",
    "reset",
    "start new",
  ],
  response: [
    "response",
    "answer",
    "assistant",
    "grok",
    "回复",
    "回答",
    "ai",
    "bot",
  ],
};

const CONFIG = {
  url: "https://grok.com",
  responseTimeout: 120_000,
  actionDelay: 800,
};

// ─── 内部逻辑 ──────────────────────────────────────────
function log(...args: unknown[]) {
  console.log("[grok]", ...args);
}

async function fillPrompt(text: string): Promise<void> {
  const snap = c.snapshot();
  const ref = c.findByKeywords(snap, KW.input);

  if (ref) {
    log(`找到输入框: ${ref}`);
    c.fill(ref, text);
  } else {
    log("未找到输入框 ref，尝试点击后键入");
    const clickRef = c.findByKeywords(snap, ["prompt", "ask", "enter", "message"]);
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

  // 策略1：先点击上传按钮触发文件选择框，再用 upload 提供文件
  const snap = c.snapshot();
  const uploadRef = c.findByKeywords(snap, KW.upload);
  if (uploadRef) {
    c.click(uploadRef);
    await c.sleep(1000);
    try {
      c.upload(absPath);
      log("通过点击上传按钮 + upload 成功");
      await c.sleep(2000);
      return;
    } catch {
      // upload 失败，继续尝试 drop
    }
  }

  // 策略2：直接 drop 到输入框
  const inputRef = c.findByKeywords(snap, KW.input);
  if (inputRef) {
    try {
      c.drop(inputRef, absPath);
      log(`drop 到输入框 ${inputRef} 成功`);
      await c.sleep(2000);
      return;
    } catch {
      // drop 失败
    }
  }

  throw new Error("未找到上传入口");
}

async function clickSend(): Promise<void> {
  await c.sleep(500);
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

    // 检测停止按钮
    const stopRef = c.findByKeywords(snap, KW.stop);
    if (stopRef) {
      wasGenerating = true;
      log("生成中...");
      await c.sleep(3000);
      continue;
    }

    if (wasGenerating && !stopRef) {
      log("生成完成");
      await c.sleep(1500);
      return extractResponse();
    }

    // 内容稳定检测
    const current = extractResponseFromSnap(snap);
    if (current === lastText && current.length > 0) {
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
  // Grok 的回复结构：查找包含 response/answer 相关的元素
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

  // 兜底：查找最后的 assistant 相关元素
  const assistantIndices = snap
    .map((el, i) => (el.lower.includes("assistant") || el.lower.includes("grok") ? i : -1))
    .filter((i) => i >= 0);

  if (assistantIndices.length > 0) {
    const lastAssistant = assistantIndices[assistantIndices.length - 1];
    const texts: string[] = [];
    for (let i = lastAssistant + 1; i < Math.min(lastAssistant + 20, snap.length); i++) {
      const el = snap[i];
      // 遇到下一个 heading 或输入框就停
      if (
        el.line.includes("heading") ||
        el.lower.includes("textbox") ||
        el.lower.includes("enter a prompt")
      )
        break;
      const m = el.line.match(/:\s*"(.+)"/);
      if (m) texts.push(m[1]);
    }
    if (texts.length > 0) return texts.join("\n");
  }

  // 最终兜底 eval
  try {
    return c.evalJs(
      `document.querySelector('[class*="response" i],[class*="answer" i],[class*="assistant" i]')?.innerText?.slice(-2000)||''`
    );
  } catch {
    return "[未能提取回复]";
  }
}

// ─── 插件导出 ──────────────────────────────────────────
export const plugin: SitePlugin = {
  name: "grok",
  url: CONFIG.url,

  async init() {
    log(`导航到 ${CONFIG.url}`);
    c.tabNew(CONFIG.url);
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
      log("已发送，不等待回复");
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
Grok 自动化

用法:
  npx tsx src/sites/grok.ts "提示词"
  npx tsx src/sites/grok.ts "提示词" --file ./image.png
  npx tsx src/sites/grok.ts --discover

前置:
  Chrome 安装 Playwright 扩展并保持打开
  已在浏览器中登录 xAI 账号
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

  c.setSession("grok");
  if (!process.env.SKIP_ATTACH) {
    console.log("[grok] 正在连接 Chrome (playwright-cli attach)...");
    c.attach();
    console.log("[grok] Chrome 已连接");
  } else {
    console.log("[grok] Chrome 已由主进程连接，跳过 attach");
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

main().catch((err) => {
  console.error("异常:", err);
  process.exit(1);
});