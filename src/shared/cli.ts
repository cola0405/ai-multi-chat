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
      // 清理过期锁（创建进程已退出）
      if (fs.existsSync(LOCK_FILE)) {
        const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
        const pid = parseInt(content, 10);
        if (isNaN(pid) || !isAlive(pid)) {
          fs.unlinkSync(LOCK_FILE);
        }
      }
      // 独占创建（wx 模式：文件已存在则抛错）
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return; // 拿到锁
    } catch {
      // 锁被占用，等待后重试
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
    }
  }
  // 超时：强制清理后直接拿
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
// 从环境变量读取 session（由 Electron 应用注入），否则用默认值
let _session = process.env.PW_SESSION || 'default';
let _attached = false;
let _attachPromise: Promise<void> | null = null;

export function setSession(name: string) {
  _session = name;
}

export function getSession(): string {
  return _session;
}

/** 确保已通过 Chrome 扩展连接（首次调用时自动 attach，不阻塞） */
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

/** 等待 attach 完成 */
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
  // attach 命令本身不需要 ensureAttached
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
    // 如果有 Error，视为失败
    if (combined.includes('### Error')) {
      const match = combined.match(/### Error\s*[\r\n]+(.+)/);
      throw new Error(match ? match[1].trim() : stderr || stdout);
    }
    // 如果有 Result，视为成功（run-code 结果可能在 stdout 或 stderr）
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
  // 先尝试断开已存在的 session
  try {
    execSync(`playwright-cli -s=${_session} detach`, { encoding: 'utf-8', timeout: 5_000, stdio: 'pipe' });
  } catch { /* 忽略 */ }

  const attachCmd = `playwright-cli attach --extension --session=${_session}`;

  // 跨进程文件锁，防止多进程同时 attach 扩展
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
          } catch { /* 忽略 */ }
        } else if (attempt < 3) {
          // 扩展正忙，等待后重试
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
        }
      }
    }
    if (lastErr) throw lastErr;
  } finally {
    releaseLock();
  }

  // 标记已连接，防止后续 cli() 调用重复 attach
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

/** 在新标签页中打开 URL（当前扩展不支持 tab-new，降级为 goto 导航当前 tab） */
export function tabNew(url: string) {
  // tab-new 暂不被 extension 模式支持，降级为 goto
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

export function upload(filePath: string) {
  const absPath = path.resolve(filePath);
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

  // Step 1: 打开文件选择框（仅在输入框不存在时）
  const step1 = `async page => {
    const debug = [];
    let inputCount = await page.evaluate(() => document.querySelectorAll('input[type=file]').length);
    debug.push('input=' + inputCount);
    if (inputCount > 0) return 'input exists';

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // 1. getByRole
    const uploadBtn = page.getByRole('button', { name: /Upload|\\u4e0a\\u4f20/i }).first();
    const roleVisible = await uploadBtn.isVisible().catch(() => false);
    debug.push('getByRole=' + roleVisible);
    if (roleVisible) {
      await uploadBtn.click();
      await page.waitForTimeout(1000);
    } else {
      // 2. 按位置找输入框附近的可点击小图标（按钮/图片）
      const inputArea = page.locator('textarea, [contenteditable="true"], [role="textbox"]').first();
      const areaVisible = await inputArea.isVisible().catch(() => false);
      debug.push('inputArea=' + areaVisible);
      if (areaVisible) {
        const inputBox = await inputArea.boundingBox();
        if (inputBox) {
          // 找页面上所有可见的小元素（在输入框附近，宽度<50px）
          const allClickables = page.locator('button, [role="button"], svg, img:visible');
          const totalCount = await allClickables.count();
          let found = false;
          for (let i = 0; i < Math.min(totalCount, 100); i++) {
            const el = allClickables.nth(i);
            const box = await el.boundingBox().catch(() => null);
            if (!box) continue;
            // 必须在输入框附近（Y 差 < 100px，X 在输入框右侧或附近）
            if (Math.abs(box.y - inputBox.y) > 100) continue;
            if (box.width > 50 || box.width < 5) continue;
            // 排除有文字的按钮
            const text = await el.innerText().catch(() => '');
            if (text.trim().length > 0) continue;
            debug.push('clickEl=' + i + ' w=' + Math.round(box.width) + ' x=' + Math.round(box.x));
            // 用 JS dispatchEvent 代替 Playwright click（SVG 元素兼容性更好）
            await page.evaluate(({x, y}) => {
              const el = document.elementFromPoint(x, y);
              if (el) el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, clientX: x, clientY: y}));
            }, {x: box.x + box.width / 2, y: box.y + box.height / 2});
            await page.waitForTimeout(500);
            const fc = await page.evaluate(() => document.querySelectorAll('input[type=file]').length);
            if (fc > 0) { found = true; break; }
          }
          if (!found) debug.push('noNearbyIcon');
        }
      }
    }

    // 3. 点击菜单项
    const menuItem = page.getByRole('menuitem').filter({ hasText: /Upload files|\\u4e0a\\u4f20|\\u672c\\u5730\\u6587\\u4ef6|\\u4e0a\\u4f20\\u6587\\u6863/ }).first();
    const menuVisible = await menuItem.isVisible().catch(() => false);
    debug.push('menu=' + menuVisible);
    if (menuVisible) {
      await menuItem.click();
      await page.waitForTimeout(1000);
    }

    inputCount = await page.evaluate(() => document.querySelectorAll('input[type=file]').length);
    debug.push('after=' + inputCount);
    if (inputCount === 0) throw new Error('No file input. ' + debug.join(' | '));
    return debug.join(' | ');
  }`;

  // Step 3: 设置文件
  const step3 = `async page => {
    const result = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type=file]');
      if (inputs.length === 0) return 'no input';
      const b64 = '${base64}';
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const file = new File([bytes], '${name}', { type: '${mime}' });
      const dt = new DataTransfer();
      dt.items.add(file);

      // 选择最合适的 input：优先 accept=""（接受所有类型），其次匹配 MIME
      let input = null;
      for (const inp of inputs) {
        if (!inp.accept || inp.accept === '') { input = inp; break; }
      }
      if (!input) {
        for (const inp of inputs) {
          if (inp.accept.includes('${ext.replace('.', '')}') || inp.accept.includes('${mime}')) { input = inp; break; }
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

  const codeFile1 = path.join(process.cwd(), '.playwright-cli', '.upload-step1.js');
  const codeFile3 = path.join(process.cwd(), '.playwright-cli', '.upload-step3.js');
  fs.mkdirSync(path.dirname(codeFile1), { recursive: true });
  fs.writeFileSync(codeFile1, step1, 'utf-8');
  fs.writeFileSync(codeFile3, step3, 'utf-8');

  try {
    // Step 1: 确保文件输入框存在
    const step1Result = cli(`run-code --filename="${codeFile1}"`);
    // Step 2: 如果打开了文件选择框，用 upload 命令关闭
    if (step1Result.includes('chooser opened')) {
      try { cli(`upload "${absPath}"`); } catch { /* 忽略 */ }
    }
    // Step 3: 设置文件
    return cli(`run-code --filename="${codeFile3}"`);
  } finally {
    try { fs.unlinkSync(codeFile1); } catch { /* */ }
    try { fs.unlinkSync(codeFile3); } catch { /* */ }
  }
}

export function drop(ref: string, filePath: string) {
  // drop 命令不存在，改用 upload 方式
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
