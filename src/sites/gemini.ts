/**
 * Google Gemini (gemini.google.com) — 完全独立脚本
 *
 * 运行:
 *   npx tsx src/sites/gemini.ts "Hello"
 *   npx tsx src/sites/gemini.ts "see this" --file ./test.png
 */

import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

// ─── playwright-cli 封装 ────────────────────────────────
const SESSION = process.env.PW_SESSION || "gemini";

function pw(args: string, timeout = 60_000): string {
  const cmd = `playwright-cli -s=${SESSION} ${args}`;
  try {
    return execSync(cmd, { encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const out = (e.stdout || "") + "\n" + (e.stderr || "");
    const m = out.match(/### Result\s*[\r\n]+(.+)/);
    if (m) return m[1].trim();
    throw new Error(`playwright-cli 失败: ${args}\n${e.stderr || e.stdout || e.message}`);
  }
}

function runCode(code: string): string {
  const f = path.join(process.cwd(), ".playwright-cli", ".run.js");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, code, "utf-8");
  try { return pw(`run-code --filename="${f}"`); }
  finally { try { fs.unlinkSync(f); } catch { /* */ } }
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

function attach() {
  execSync(`playwright-cli attach --extension=chrome --session=${SESSION}`, { encoding: "utf-8", timeout: 60_000, stdio: "pipe" });
}
function detach() { try { pw("detach"); } catch { /* */ } }
function goto(url: string) { pw(`goto ${url}`); }

interface Snap { ref: string; line: string; lower: string; }
function snapshot(): Snap[] {
  return pw("snapshot").split("\n").map(l => l.trim()).filter(l => l.includes("[ref=")).map(l => {
    const m = l.match(/\[ref=(\w+)\]/);
    return { ref: m?.[1] || "", line: l, lower: l.toLowerCase() };
  }).filter(e => e.ref);
}
function find(els: Snap[], kws: string[]): string | null {
  for (const kw of kws) for (const el of els) if (el.lower.includes(kw.toLowerCase())) return el.ref;
  return null;
}

function click(ref: string) { pw(`click ${ref}`); }
function typeText(text: string) {
  const jsonText = JSON.stringify(text);
  runCode(`async page => {
    await page.evaluate(() => {
      let el = document.activeElement;
      if (!el || (!el.isContentEditable && el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT')) {
        el = document.querySelector('[contenteditable="true"]')
          || document.querySelector('textarea')
          || document.querySelector('[role="textbox"]');
      }
      if (el) {
        el.focus();
        if (el.isContentEditable) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    });
    await page.waitForTimeout(200);
    const ok = await page.evaluate((t) => document.execCommand('insertText', false, t), ${jsonText});
    if (!ok) await page.keyboard.insertText(${jsonText});
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }`);
}
function press(key: string) { pw(`press ${key}`); }
function evalJs(expr: string): string { return pw(`--raw eval "${expr.replace(/\\/g, "\\\\")}"`, 30_000); }

async function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let d = ""; process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (c: string) => { d += c; });
    process.stdin.on("end", () => resolve(d.trim()));
    if (process.stdin.isTTY) resolve("");
  });
}

// ─── 站点配置 ──────────────────────────────────────────
const URL = "https://gemini.google.com/app";
const KW = {
  input: ["textbox", "prompt", "textarea", "contenteditable", "enter a prompt", "ask anything", "ask gemini", "input"],
  send: ["send message", "send", "submit", "提交", "发送"],
  newChat: ["new chat", "新对话", "新聊天", "clear", "reset"],
};

function log(...args: unknown[]) { console.log("[gemini]", ...args); }

// ─── 上传附件 ─────────────────────────────────────────
async function upload(filePath: string) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`附件不存在: ${abs}`);
  log(`上传附件: ${abs}`);
  const b64 = fs.readFileSync(abs).toString("base64");
  const name = path.basename(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf", ".txt": "text/plain" };
  const m = mime[ext] || "application/octet-stream";
  
  const r = runCode(`async page => {
    // 点击 Upload & tools 按钮
    await page.getByRole('button', { name: 'Upload & tools' }).click();
    await page.waitForTimeout(1000);
    
    // 点击 Upload files 菜单项
    await page.locator('[data-test-id="local-images-files-uploader-button"]').click();
    await page.waitForTimeout(500);
    
    // 让隐藏的 input 可见
    await page.evaluate(() => {
      const inp = document.querySelector('input[type="file"]');
      if (inp) {
        inp.style.display = 'block';
        inp.style.visibility = 'visible';
        inp.style.opacity = '1';
        inp.style.position = 'fixed';
        inp.style.top = '0';
        inp.style.left = '0';
        inp.style.width = '100px';
        inp.style.height = '100px';
        inp.style.zIndex = '99999';
      }
    });
    await page.waitForTimeout(500);
    
    // 使用 page.$eval 来设置文件
    await page.$eval('input[type="file"]', (inp, {b64:b,n,m}) => {
      const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0));
      const file = new File([bytes], n, {type:m});
      const dt = new DataTransfer();
      dt.items.add(file);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set;
      setter.call(inp, dt.files);
      inp.dispatchEvent(new Event('change', {bubbles: true}));
    }, {b64:${JSON.stringify(b64)},n:${JSON.stringify(name)},m:${JSON.stringify(m)}});
    
    // 等待文件处理
    await page.waitForTimeout(2000);
    
    // 隐藏 input
    await page.evaluate(() => {
      const inp = document.querySelector('input[type="file"]');
      if (inp) inp.style.display = 'none';
    });
    
    return 'uploaded';
  }`);
  log(`上传结果: ${r}`);
  
  // 关键修复：使用 upload 命令关闭残留的文件选择器模态框
  // 点击 Upload files 会打开原生文件选择器对话框，JS 设置文件后对话框仍然处于打开状态
  // upload 命令可以处理文件选择器模态框（即使报错也会关闭模态框）
  const dummyFile = path.join(process.cwd(), ".playwright-cli", "_dummy.txt");
  try { if (!fs.existsSync(dummyFile)) fs.writeFileSync(dummyFile, ""); } catch { /* */ }
  try { pw(`upload "${dummyFile}"`); } catch { /* 模态框已关闭，忽略错误 */ }
  
  await sleep(1000);
}

// ─── 填写文本 ─────────────────────────────────────────
async function fillPrompt(text: string) {
  const r = runCode(`async page => {
    const el = page.locator('rich-textarea .ql-editor');
    await el.click();
    await page.waitForTimeout(500);
    // 使用 execCommand 触发完整的编辑事件链（比 insertText 更接近真实键盘输入）
    await page.evaluate((t) => document.execCommand('insertText', false, t), ${JSON.stringify(text)});
    return 'typed';
  }`);
  log(`输入结果: ${r}`);
  await sleep(800);
}

// ─── 点击发送 ─────────────────────────────────────────
async function clickSend() {
  await sleep(500);
  const r = runCode(`async page => {
    await page.keyboard.press('Enter');
    return 'sent';
  }`);
  log(`发送结果: ${r}`);
  await sleep(800);
}

// ─── 插件导出（供 Electron 主进程调用） ────────────────
export const plugin = {
  name: "gemini",
  url: URL,

  async init() {
    log(`导航到 ${URL}`);
    goto(URL);
    await sleep(3000);
    log("就绪");
  },

  async run(prompt: string, attachment?: string) {
    const startTime = Date.now();
    const result = { prompt, attachment, response: "", timestamp: new Date().toISOString(), duration: 0, success: false, error: undefined as string | undefined };
    try {
      if (attachment) await upload(attachment);
      await fillPrompt(prompt);
      await clickSend();
      log("已发送");
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
    const snap = snapshot();
    const ref = find(snap, KW.newChat);
    if (ref) { click(ref); await sleep(2000); return; }
    goto(URL);
    await sleep(3000);
  },
};

// ─── 独立运行入口 ──────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`用法: npx tsx src/sites/gemini.ts "提示词" [--file ./img.png]`);
    process.exit(0);
  }

  let prompt = "", filePath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file") filePath = args[++i]?.replace(/^"|"$/g, "");
    else if (!args[i].startsWith("--")) prompt = args[i].replace(/^"|"$/g, "");
  }
  if (!prompt) prompt = await readStdin();

  if (!process.env.SKIP_ATTACH) {
    log("正在连接 Chrome...");
    attach();
    log("Chrome 已连接");
  }

  try {
    goto(URL); await sleep(3000); log("就绪");
    if (filePath) await upload(filePath);
    await fillPrompt(prompt);
    await clickSend();
    log("已发送");
  } finally {
    if (!process.env.SKIP_ATTACH) detach();
  }
}

main().catch(err => { console.error("异常:", err); process.exit(1); });
