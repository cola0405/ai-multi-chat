/**
 * 站点自动化脚本模板
 *
 * 独立运行:
 *   npx tsx site-name.ts "提示词"
 *   npx tsx site-name.ts "提示词" --file ./image.png
 *
 * 作为插件导入:
 *   import { plugin } from "./site-name.js";
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as c from '../cli.js';
import type { SitePlugin, RunResult } from '../types.js';

// ─── 元素匹配关键词（根据 snapshot 输出匹配 ref） ──────
const KW = {
  input: ['textbox', 'textarea', 'contenteditable', '输入', '聊天'],
  send: ['发送', 'send', 'submit', 'Send', 'Submit'],
  stop: ['停止', 'stop', 'Stop'],
  upload: ['上传', 'upload', 'attach', '附件', 'file', '文件'],
  newChat: ['新对话', '新聊天', 'new chat'],
};

const CONFIG = {
  url: 'https://example.com/chat/',
  actionDelay: 800,
};

// ─── 内部逻辑 ──────────────────────────────────────────
function log(...args: unknown[]) {
  console.log('[site-name]', ...args);
}

async function fillPrompt(text: string): Promise<void> {
  const snap = c.snapshot();
  const ref = c.findByKeywords(snap, KW.input);

  if (ref) {
    log(`找到输入框: ${ref}`);
    c.fill(ref, text);
  } else {
    log('未找到输入框 ref，直接键入');
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
    log('upload 成功');
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

  throw new Error('未找到上传入口');
}

async function clickSend(): Promise<void> {
  const snap = c.snapshot();
  const ref = c.findByKeywords(snap, KW.send);

  if (ref) {
    c.click(ref);
    log(`点击发送: ${ref}`);
  } else {
    log('未找到发送按钮，按 Enter');
    c.press('Enter');
  }

  await c.sleep(CONFIG.actionDelay);
}

// ─── 插件导出 ──────────────────────────────────────────
export const plugin: SitePlugin = {
  name: 'site-name',
  url: CONFIG.url,

  async init() {
    log(`导航到 ${CONFIG.url}`);
    c.tabNew(CONFIG.url);
    await c.sleep(3000);
    log('就绪');
  },

  async run(prompt: string, attachment?: string): Promise<RunResult> {
    const startTime = Date.now();
    const result: RunResult = {
      prompt,
      attachment,
      response: '',
      timestamp: new Date().toISOString(),
      duration: 0,
      success: false,
    };

    try {
      if (attachment) await uploadAttachment(attachment);
      await fillPrompt(prompt);
      await clickSend();
      result.success = true;
      log('消息已发送，浏览器保持打开');
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      log(`失败: ${result.error}`);
    }

    result.duration = Date.now() - startTime;
    return result;
  },

  async newChat() {
    log('新对话...');
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

  let prompt = '';
  let filePath: string | undefined;
  let sessionName = 'site-name';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
        filePath = args[++i];
        break;
      case '--session':
        sessionName = args[++i];
        break;
      default:
        if (!args[i].startsWith('--')) prompt = args[i];
    }
  }

  if (!prompt) {
    console.log('用法: npx tsx site-name.ts "提示词" [--file 附件路径]');
    process.exit(0);
  }

  c.setSession(sessionName);
  c.attach();

  try {
    await plugin.init();
    const result = await plugin.run(prompt, filePath);

    console.log(`\n── 完成 ──`);
    console.log(`耗时: ${(result.duration / 1000).toFixed(1)}s`);
    console.log(`成功: ${result.success}`);
    if (result.error) console.log(`错误: ${result.error}`);
  } finally {
    c.detach();
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((err) => {
    console.error('异常:', err);
    process.exit(1);
  });
}
