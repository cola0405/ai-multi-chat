/**
 * Grok (grok.com) — 完全独立脚本
 *
 * 运行:
 *   npx tsx src/sites/grok.ts "Hello"
 *   npx tsx src/sites/grok.ts "分析图片" --file ./test.png
 */

import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

// ─── playwright-cli 封装 ────────────────────────────────
const SESSION = process.env.PW_SESSION || "grok";

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
  const esc = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/`/g, "\\`");
  runCode(`async page => { await page.keyboard.insertText('${esc}'); await page.evaluate(() => { const el = document.activeElement; if (el) el.dispatchEvent(new Event('input', { bubbles: true })); }); }`);
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
const URL = "https://grok.com";
const KW = {
  input: ["textbox", "textarea", "contenteditable", "prompt", "input", "enter a prompt", "ask grok", "message"],
  send: ["send", "submit", "发送", "提交", "arrow-up", "ArrowUp", "send message"],
  newChat: ["new chat", "新对话", "新聊天", "clear", "reset", "start new"],
};

function log(...args: unknown[]) { console.log("[grok]", ...args); }

// ─── 上传附件（点击附件按钮 → 菜单项 → input[type=file]）──
async function upload(filePath: string) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`附件不存在: ${abs}`);
  log(`上传附件: ${abs}`);
  const b64 = fs.readFileSync(abs).toString("base64");
  const name = path.basename(abs).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const ext = path.extname(abs).toLowerCase();
  const mime: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf", ".txt": "text/plain" };
  const m = mime[ext] || "application/octet-stream";

  log("点击附件按钮...");
  runCode(`async page => {
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button, [role="button"]');
      for (const b of btns) {
        if (b.textContent && b.textContent.includes('附件')) { b.click(); break; }
      }
    });
  }`);
  await sleep(800);

  log("点击菜单项...");
  runCode(`async page => {
    await page.evaluate(() => {
      const items = document.querySelectorAll('[role="menuitem"], [class*="dropdown"] [class*="item"], li');
      for (const it of items) {
        const txt = it.textContent || '';
        if (txt.includes('上传文件') || txt.includes('Upload')) { it.click(); break; }
      }
    });
  }`);
  await sleep(1000);

  log("设置文件...");
  const r = runCode(`async page => {
    return await page.evaluate(({b64:b,name:n,mime:m}) => {
      const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0));
      const file = new File([bytes], n, {type:m});
      const dt = new DataTransfer(); dt.items.add(file);
      const inputs = document.querySelectorAll('input[type=file]');
      if (!inputs.length) return 'no-file-input';
      let count = 0;
      for (const inp of inputs) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(inp, dt.files);
        inp.dispatchEvent(new Event('change', {bubbles:true}));
        count++;
      }
      return 'set:'+count+':'+file.name;
    },{b64:'${b64}',name:'${name}',mime:'${m}'});
  }`);
  log(`上传结果: ${r}`);
  await sleep(2000);
}

// ─── 填写文本 ─────────────────────────────────────────
async function fillPrompt(text: string) {
  const snap = snapshot();
  const ref = find(snap, KW.input);
  if (ref) { log(`找到输入框: ${ref}`); click(ref); await sleep(500); }
  typeText(text);
  log(`已输入 (${text.length} 字)`);
  await sleep(800);
}

// ─── 点击发送 ─────────────────────────────────────────
async function clickSend() {
  await sleep(500);
  const snap = snapshot();
  const ref = find(snap, KW.send);
  if (ref) { click(ref); log(`点击发送: ${ref}`); }
  else { press("Enter"); log("按 Enter 发送"); }
  await sleep(800);
}

// ─── 插件导出（供 Electron 主进程调用） ────────────────
export const plugin = {
  name: "grok",
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
    console.log(`用法: npx tsx src/sites/grok.ts "提示词" [--file ./img.png]`);
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
