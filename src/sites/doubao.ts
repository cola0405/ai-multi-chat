/**
 * 豆包 (doubao.com) 站点脚本
 *
 * 独立运行:
 *   npx tsx src/sites/doubao.ts "你好"
 *   npx tsx src/sites/doubao.ts "分析图片" --file ./test.png
 *
 * 作为插件导入:
 *   import { plugin } from "./sites/doubao.js";
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as c from "../cli.js";
import type { SitePlugin, RunResult } from "../types.js";

// ─── 元素匹配关键词（根据 snapshot 输出匹配 ref） ──────
const KW = {
  input: ["textbox", "textarea", "contenteditable", "输入", "聊天"],
  send: ["发送", "send", "submit", "Send", "Submit", "arrow-up", "ArrowUp"],
  stop: ["停止", "stop", "Stop", "停止生成"],
  upload: ["上传", "upload", "attach", "附件", "file", "文件"],
  newChat: ["新对话", "新聊天", "new chat", "new-chat"],
  response: ["assistant", "回答", "回复", "answer", "response", "bot", "ai"],
};

const CONFIG = {
  url: "https://www.doubao.com/chat/",
  responseTimeout: 120_000,
  actionDelay: 800,
};

// ─── 内部逻辑 ──────────────────────────────────────────
function log(...args: unknown[]) {
  console.log("[doubao]", ...args);
}

async function fillPrompt(text: string): Promise<void> {
  const snap = c.snapshot();
  const ref = c.findByKeywords(snap, KW.input);

  if (ref) {
    log(`找到输入框: ${ref}`);
    c.click(ref);
    await c.sleep(300);
    c.typeText(text);
  } else {
    log("未找到输入框 ref，直接键入");
    c.typeText(text);
  }

  log(`已输入 (${text.length} 字)`);
  await c.sleep(CONFIG.actionDelay);
}

async function uploadAttachment(filePath: string): Promise<void> {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) throw new Error(`附件不存在: ${absPath}`);

  log(`上传附件: ${absPath}`);
  try {
    c.upload(absPath);
    log("上传成功");
    await c.sleep(2000);
  } catch (err) {
    throw new Error(`上传失败: ${err instanceof Error ? err.message : String(err)}`);
  }
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
  name: "doubao",
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
      // 发送完即完成，不等待回复
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
  console.log("[doubao] main() 已启动, 参数:", JSON.stringify(args));

  if (args.length === 0) {
    console.log(`
豆包自动化 — 独立运行

用法:
  npx tsx src/sites/doubao.ts "提示词"
  npx tsx src/sites/doubao.ts "提示词" --file ./image.png
  npx tsx src/sites/doubao.ts --discover

前置:
  Chrome 安装 Playwright 扩展并保持打开
`);
    process.exit(0);
  }

  let prompt = "";
  let filePath: string | undefined;
  let discover = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--file":
        filePath = args[++i]?.replace(/^"|"$/g, "");
        break;
      case "--discover":
        discover = true;
        break;
      default:
        if (!args[i].startsWith("--")) prompt = args[i].replace(/^"|"$/g, "");
    }
  }

  c.setSession("doubao");
  if (!process.env.SKIP_ATTACH) {
    console.log("[doubao] 正在连接 Chrome (playwright-cli attach)...");
    c.attach();
    console.log("[doubao] Chrome 已连接");
  } else {
    console.log("[doubao] Chrome 已由主进程连接，跳过 attach");
  }

  try {
    console.log("[doubao] 开始初始化...");
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

// 直接运行 main()
// 注意：不能用 import.meta.url === file://${process.argv[1]} 判断，
// 因为 tsx ESM loader 下路径格式可能不一致（大小写/编码差异）
main().catch((err) => {
  console.error("异常:", err);
  process.exit(1);
});
