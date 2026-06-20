/**
 * playwright-cli 共享引擎
 * 站点脚本通过 import '../cli.js' 使用这里的方法
 */
import { execSync, exec } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

// ─── 跨进程文件锁（序列化 attach --extension） ─────────
const LOCK_FILE = path.join(os.tmpdir(), '.playwright-cli-attach.lock');

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(retries = 30, intervalMs = 500): void {
  for (let i = 0; i < retries; i++) {
    try {
      if (fs.existsSync(LOCK_FILE)) {
        const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
        const pid = parseInt(content, 10);
        if (isNaN(pid) || !isAlive(pid)) {
          fs.unlinkSync(LOCK_FILE);
        }
      }
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
    }
  }
  try { fs.unlinkSync(LOCK_FILE); } catch { /* */ }
  const fd = fs.openSync(LOCK_FILE, 'wx');
  fs.writeSync(fd, String(process.pid));
  fs.closeSync(fd);
}

function releaseLock(): void {
  try {
    const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
    if (parseInt(content, 10) === process.pid) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch { /* */ }
}

// ─── 类型 ──────────────────────────────────────────────
export interface SnapshotElement {
  ref: string;
  line: string;
  lower: string;
}

// ─── 会话管理 ──────────────────────────────────────────
let _session = process.env.PW_SESSION || 'default';
let _attached = false;
let _attachPromise: Promise<void> | null = null;

export function setSession(name: string) {
  _session = name;
}

export function getSession(): string {
  return _session;
}

function ensureAttached() {
  if (_attached) return;
  if (_attachPromise) return;
  _attached = true;
  _attachPromise = new Promise<void>((resolve, reject) => {
    acquireLock();
    const cmd = `playwright-cli attach --extension --session=${_session}`;
    exec(cmd, { encoding: 'utf-8', timeout: 60_000 }, (err, stdout, stderr) => {
      releaseLock();
      if (err) {
        console.error('[cli] 连接浏览器失败:', stderr || err.message);
        reject(err);
      } else {
        console.log('[cli] 已通过扩展连接浏览器');
        resolve();
      }
    });
  });
}

export async function waitForAttach(): Promise<void> {
  if (!_attached && !_attachPromise) {
    ensureAttached();
  }
  if (_attachPromise) {
    await _attachPromise;
  }
}

// ─── 核心执行 ──────────────────────────────────────────
export function cli(args: string, timeout = 60_000): string {
  if (!args.startsWith('attach') && !args.startsWith('detach')) {
    ensureAttached();
  }
  const fullCmd = `playwright-cli -s=${_session} ${args}`;
  try {
    return execSync(fullCmd, {
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string; status?: number };
    const stderr = e.stderr?.toString().trim() || '';
    const stdout = e.stdout?.toString().trim() || '';
    const combined = stdout + '\n' + stderr;
    if (combined.includes('### Error')) {
      const match = combined.match(/### Error\s*[\r\n]+(.+)/);
      throw new Error(match ? match[1].trim() : stderr || stdout);
    }
    if (combined.includes('### Result')) {
      const match = combined.match(/### Result\s*[\r\n]+(.+)/);
      return match ? match[1].trim() : stdout || stderr;
    }
    throw new Error(`命令失败: ${fullCmd}\n${stderr || stdout || e.message}`);
  }
}

export function cliRaw(args: string, timeout = 30_000): string {
  return cli(`--raw ${args}`, timeout);
}

// ─── 连接 / 断开 ───────────────────────────────────────
export function open(url?: string) {
  try {
    execSync(`playwright-cli -s=${_session} detach`, { encoding: 'utf-8', timeout: 5_000, stdio: 'pipe' });
  } catch { /* */ }

  const attachCmd = `playwright-cli attach --extension --session=${_session}`;
  acquireLock();
  try {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        execSync(attachCmd, { encoding: 'utf-8', timeout: 60_000, stdio: 'pipe' });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already in use')) {
          console.warn('[cli] 连接被占用，尝试强制清理后重试...');
          try {
            execSync('playwright-cli kill-all', { encoding: 'utf-8', timeout: 10_000, stdio: 'pipe' });
          } catch { /* */ }
        } else if (attempt < 3) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
        }
      }
    }
    if (lastErr) throw lastErr;
  } finally {
    releaseLock();
  }

  _attached = true;
  _attachPromise = null;

  if (url) {
    goto(url);
  }
}

export function attach() {
  open();
}

export function detach() {
  try {
    cli('detach');
  } catch {
    // ignore
  }
  _attached = false;
  _attachPromise = null;
}

// ─── 导航 ──────────────────────────────────────────────
export function goto(url: string) {
  cli(`goto ${url}`);
}

export function tabNew(url: string) {
  cli(`goto ${url}`);
}

// ─── 快照 ──────────────────────────────────────────────
export function snapshot(): SnapshotElement[] {
  const raw = cli('snapshot');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('[ref='))
    .map((l) => {
      const m = l.match(/\[ref=(\w+)\]/);
      return { ref: m?.[1] || '', line: l, lower: l.toLowerCase() };
    })
    .filter((e) => e.ref);
}

export function snapshotRaw(): string {
  return cli('snapshot');
}

// ─── 元素查找 ──────────────────────────────────────────
export function findByKeywords(elements: SnapshotElement[], keywords: string[]): string | null {
  for (const kw of keywords) {
    for (const el of elements) {
      if (el.lower.includes(kw.toLowerCase())) return el.ref;
    }
  }
  return null;
}

// ─── 交互 ──────────────────────────────────────────────
export function fill(ref: string, text: string) {
  cli(`fill ${ref} "${text}"`);
}

export function click(ref: string) {
  cli(`click ${ref}`);
}

export function typeText(text: string) {
  cli(`type "${text}"`);
}

export function press(key: string) {
  cli(`press ${key}`);
}

/**
 * 上传文件到当前页面。
 * 自动处理：检查 file input → 点击上传按钮 → 点击菜单项 → 设置文件。
 * 站点脚本只需调用 c.upload(filePath) 即可。
 */
export function upload(filePath: string) {
  const absPath = path.resolve(filePath);

  // 检查 file input 是否已存在
  let hasInput = false;
  try {
    const r = cli(`eval "document.querySelectorAll('input[type=file]').length" --raw`);
    hasInput = parseInt(r, 10) > 0;
  } catch { /* */ }

  // 不存在则尝试点击上传按钮创建
  if (!hasInput) {
    const clickCode = `async page => {
      const debug = [];
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // 1. getByRole（Gemini "Upload & tools"）
      const roleBtn = page.getByRole('button', { name: /Upload|\\u4e0a\\u4f20|\\u6dfb\\u52a0\\u9644\\u4ef6/i }).first();
      if (await roleBtn.isVisible().catch(() => false)) {
        await roleBtn.click();
        await page.waitForTimeout(1000);
        debug.push('role');
      } else {
        // 2. 找输入框附近的可点击小图标
        const inputArea = page.locator('textarea, [contenteditable="true"], [role="textbox"]').first();
        if (await inputArea.isVisible().catch(() => false)) {
          const inputBox = await inputArea.boundingBox();
          if (inputBox) {
            const els = page.locator('button, [role="button"], svg, img:visible');
            const count = await els.count();
            for (let i = 0; i < Math.min(count, 100); i++) {
              const el = els.nth(i);
              const box = await el.boundingBox().catch(() => null);
              if (!box) continue;
              if (Math.abs(box.y - inputBox.y) > 100) continue;
              if (box.width > 50 || box.width < 5) continue;
              const text = await el.innerText().catch(() => '');
              if (text.trim().length > 0) continue;
              await page.evaluate(({x, y}) => {
                const el = document.elementFromPoint(x, y);
                if (el) el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, clientX: x, clientY: y}));
              }, {x: box.x + box.width / 2, y: box.y + box.height / 2});
              await page.waitForTimeout(500);
              const fc = await page.evaluate(() => document.querySelectorAll('input[type=file]').length);
              if (fc > 0) { debug.push('icon#' + i); break; }
            }
          }
        }
      }

      // 3. 点击菜单项（本地文件/上传文档/上传文件/Upload files）
      const menu = page.getByRole('menuitem').filter({ hasText: /\\u672c\\u5730\\u6587\\u4ef6|\\u4e0a\\u4f20\\u6587\\u6863|\\u4e0a\\u4f20\\u6587\\u4ef6|Upload files/i }).first();
      if (await menu.isVisible().catch(() => false)) {
        await menu.click();
        await page.waitForTimeout(1000);
        debug.push('menu');
      }

      // 4. 关闭文件选择框
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      const fc = await page.evaluate(() => document.querySelectorAll('input[type=file]').length);
      if (fc === 0) throw new Error('No file input. ' + debug.join(','));
      return debug.join(',');
    }`;

    const codeFile = path.join(process.cwd(), '.playwright-cli', '.click-upload.js');
    fs.mkdirSync(path.dirname(codeFile), { recursive: true });
    fs.writeFileSync(codeFile, clickCode, 'utf-8');
    try {
      cli(`run-code --filename="${codeFile}"`);
    } finally {
      try { fs.unlinkSync(codeFile); } catch { /* */ }
    }
  }

  // 设置文件
  const content = fs.readFileSync(absPath);
  const base64 = content.toString('base64');
  const name = path.basename(absPath).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
  const ext = path.extname(absPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  };
  const mime = mimeMap[ext] || 'application/octet-stream';

  const setCode = `async page => {
    const result = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type=file]');
      if (inputs.length === 0) return 'no input';
      const b64 = '${base64}';
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const file = new File([bytes], '${name}', { type: '${mime}' });
      const dt = new DataTransfer();
      dt.items.add(file);
      let input = null;
      for (const inp of inputs) {
        if (!inp.accept || inp.accept === '') { input = inp; break; }
      }
      if (!input) {
        for (const inp of inputs) {
          const accept = inp.accept || '';
          if (accept.includes('${ext.replace('.', '')}') || accept.includes('${mime}')) { input = inp; break; }
        }
      }
      if (!input) input = inputs[inputs.length - 1];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
      if (setter && setter.set) setter.set.call(input, dt.files);
      else input.files = dt.files;
      const propsKey = Object.keys(input).find(k => k.startsWith('__reactProps$'));
      if (propsKey) {
        const props = input[propsKey];
        if (props && props.onChange) {
          props.onChange({ target: input, currentTarget: input });
          return 'uploaded ' + file.name + ' via React';
        }
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'uploaded ' + file.name + ' via native';
    });
    return result;
  }`;

  const setFile = path.join(process.cwd(), '.playwright-cli', '.upload-set.js');
  fs.writeFileSync(setFile, setCode, 'utf-8');
  try {
    return cli(`run-code --filename="${setFile}"`);
  } finally {
    try { fs.unlinkSync(setFile); } catch { /* */ }
  }
}

export function drop(ref: string, filePath: string) {
  upload(filePath);
}

// ─── 提取文本 ──────────────────────────────────────────
export function evalJs(expression: string): string {
  return cliRaw(`eval "${escapeStr(expression)}"`);
}

export function evalOn(ref: string, expression: string): string {
  return cliRaw(`eval "${escapeStr(expression)}" ${ref}`);
}

// ─── 截图 ──────────────────────────────────────────────
export function screenshot(filename?: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = filename || `screenshot-${ts}.png`;
  cli(`screenshot --filename=${fname}`);
  return fname;
}

// ─── 工具 ──────────────────────────────────────────────
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeStr(text: string): string {
  return text.replace(/\\/g, '\\\\');
}
