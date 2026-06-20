import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { app } from 'electron';

export interface RunOptions {
  scriptPath: string;
  session: string;
  prompt: string;
  filePath?: string;
  cwd?: string;
}

export interface RunCallbacks {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onExit?: (code: number | null) => void;
  onError?: (err: Error) => void;
}

/**
 * 启动一个站点脚本子进程。
 * 使用系统的 node + tsx CLI 来执行 .ts 文件。
 */
export function runSiteScript(opts: RunOptions, callbacks: RunCallbacks): ChildProcess {
  const projectRoot = opts.cwd || app.getAppPath();
  const isWindows = process.platform === 'win32';

  // 用系统 node 运行 tsx 的 CLI 入口（避免 tsx.cmd batch wrapper 的问题）
  const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  const scriptArgs: string[] = [
    tsxCli,
    opts.scriptPath,
    opts.prompt,
  ];

  if (opts.filePath) {
    scriptArgs.push('--file', opts.filePath);
  }

  if (isWindows) {
    // Windows: 用 chcp 65001 切换到 UTF-8 编码，解决中文乱码
    // 使用相对路径避免引号问题（CWD 是项目根目录）
    const relativeTsxCli = path.relative(projectRoot, tsxCli);
    const relativeScript = path.relative(projectRoot, opts.scriptPath);
    let cmd = `chcp 65001 >nul && node ${relativeTsxCli} ${relativeScript} "${opts.prompt}"`;
    if (opts.filePath) {
      const relativeFile = path.relative(projectRoot, opts.filePath);
      cmd += ` --file "${relativeFile}"`;
    }
    const child = spawn('cmd.exe', ['/c', cmd], {
      cwd: projectRoot,
      env: { ...process.env, PW_SESSION: opts.session, SKIP_ATTACH: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout?.on('data', (data: Buffer) => {
      callbacks.onStdout?.(data.toString());
    });

    child.stderr?.on('data', (data: Buffer) => {
      callbacks.onStderr?.(data.toString());
    });

    child.on('exit', (code) => {
      callbacks.onExit?.(code);
    });

    child.on('error', (err) => {
      callbacks.onError?.(err);
    });

    return child;
  } else {
    // macOS/Linux: 直接用 node
    const child = spawn('node', scriptArgs, {
      cwd: projectRoot,
      env: { ...process.env, PW_SESSION: opts.session, SKIP_ATTACH: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      callbacks.onStdout?.(data.toString());
    });

    child.stderr?.on('data', (data: Buffer) => {
      callbacks.onStderr?.(data.toString());
    });

    child.on('exit', (code) => {
      callbacks.onExit?.(code);
    });

    child.on('error', (err) => {
      callbacks.onError?.(err);
    });

    return child;
  }
}

/**
 * 获取站点脚本的绝对路径
 */
export function getSiteScriptPath(siteName: string): string {
  return path.join(app.getPath('userData'), 'sites', `${siteName}.ts`);
}
