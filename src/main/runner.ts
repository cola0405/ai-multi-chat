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

  // 直接 spawn node，用数组传参，绕过 shell 引号解析，彻底解决空格截断问题
  const child = spawn('node', scriptArgs, {
    cwd: projectRoot,
    env: { ...process.env, PW_SESSION: opts.session },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
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

/**
 * 获取站点脚本的绝对路径
 */
export function getSiteScriptPath(siteName: string): string {
  return path.join(app.getPath('userData'), 'sites', `${siteName}.ts`);
}
