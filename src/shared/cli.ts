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
    const cmd = `playwright-cli attach --extension=chrome --session=${_session}`;
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

  const attachCmd = `playwright-cli attach --extension=chrome --session=${_session}`;
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
  // insertText 一次性插入整个文本，对 contenteditable (Slate/Quill) 比 type 逐字输入更可靠
  const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/`/g, '\\`');
  const code = `async page => {
    await page.keyboard.insertText('${escaped}');
    // 触发 input 事件让 React/Quill/Slate 更新内部状态
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }`;
  const codeFile = path.join(process.cwd(), '.playwright-cli', '.type.js');
  fs.writeFileSync(codeFile, code, 'utf-8');
  try {
    cli(`run-code --filename="${codeFile}"`);
  } finally {
    try { fs.unlinkSync(codeFile); } catch { /* */ }
  }
}

export function press(key: string) {
  cli(`press ${key}`);
}

// ─── 运行 Playwright 代码 ─────────────────────────────
export function runPageCode(code: string): string {
  const codeFile = path.join(process.cwd(), '.playwright-cli', '.run.js');
  fs.mkdirSync(path.dirname(codeFile), { recursive: true });
  fs.writeFileSync(codeFile, code, 'utf-8');
  try {
    return cli(`run-code --filename="${codeFile}"`);
  } finally {
    try { fs.unlinkSync(codeFile); } catch { /* */ }
  }
}

// ─── 文件读取工具 ──────────────────────────────────────
export interface FilePayload {
  absPath: string;
  b64: string;
  name: string;
  mime: string;
  ext: string;
}

export function filePayload(filePath: string): FilePayload {
  const absPath = path.resolve(filePath);
  const content = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  };
  return {
    absPath,
    b64: content.toString('base64'),
    name: path.basename(absPath).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"'),
    mime: mimeMap[ext] || 'application/octet-stream',
    ext,
  };
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

// ─── stdin 读取（runner 通过 stdin 传递 prompt） ────────
export async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    // 如果 stdin 已经结束（没有管道数据），立即返回空
    if (process.stdin.isTTY) resolve('');
  });
}
