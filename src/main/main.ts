import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { SiteConfigManager } from './config.js';
import { runSiteScript, getSiteScriptPath } from './runner.js';

let mainWindow: BrowserWindow | null = null;
let configManager: SiteConfigManager;

// 追踪正在运行的子进程
const activeProcesses = new Map<string, ReturnType<typeof runSiteScript>>();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a2e',
      symbolColor: '#a9a9b3',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 开发环境连接 Vite dev server，生产环境加载本地文件
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC 处理器 ──────────────────────────────────────────

function setupIpcHandlers(): void {
  // 获取站点列表
  ipcMain.handle('sites:get', () => {
    return configManager.getSites();
  });

  // 获取已选站点
  ipcMain.handle('sites:getSelected', () => {
    return configManager.getSelectedSites();
  });

  // 保存已选站点
  ipcMain.handle('sites:setSelected', (_e, ids: string[]) => {
    configManager.setSelectedSites(ids);
  });

  // 添加站点
  ipcMain.handle('sites:add', (_e, data: { name: string; url: string; script: string }) => {
    return configManager.addSite(data.name, data.url, data.script);
  });

  // 更新站点
  ipcMain.handle(
    'sites:update',
    (_e, id: string, updates: { name?: string; url?: string; enabled?: boolean }, script?: string) => {
      return configManager.updateSite(id, updates, script);
    }
  );

  // 删除站点
  ipcMain.handle('sites:delete', (_e, id: string) => {
    return configManager.deleteSite(id);
  });

  // 获取站点脚本内容
  ipcMain.handle('sites:getScript', (_e, name: string) => {
    return configManager.getScript(name);
  });

  // 获取脚本模板
  ipcMain.handle('sites:getTemplate', () => {
    const templatePath = path.join(app.getAppPath(), 'src', 'shared', 'template.ts');
    try {
      if (fs.existsSync(templatePath)) {
        return fs.readFileSync(templatePath, 'utf-8');
      }
    } catch {
      // ignore
    }
    return getDefaultTemplate();
  });

  // 读取 .ts 文件内容（供拖拽/选择站点脚本使用）
  ipcMain.handle('dialog:readTsFile', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'TypeScript 脚本', extensions: ['ts'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    return { path: filePath, name: path.basename(filePath), content };
  });

  // 运行站点脚本（顺序执行：一次只运行一个站点，避免扩展冲突）
  ipcMain.handle(
    'run',
    async (_e, payload: { sites: string[]; prompt: string; attachments: string[]; statusMsgId: string }) => {
      const filePath = payload.attachments.length > 0 ? payload.attachments[0] : undefined;
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      console.log(`[run] 顺序启动 ${payload.sites.length} 个站点...`);

      const emit = (data: Record<string, unknown>) => {
        const eventData = { runId, statusMsgId: payload.statusMsgId, ...data };
        console.log('[emit] 发送事件:', JSON.stringify(eventData));
        mainWindow?.webContents.send('run:event', eventData);
      };

      // 顺序执行每个站点
      for (const siteName of payload.sites) {
        const scriptPath = getSiteScriptPath(siteName);
        let logOutput = '';

        emit({ site: siteName, status: 'sending', log: '' });

        await new Promise<void>((resolve) => {
          try {
            const child = runSiteScript(
              { scriptPath, session: siteName, prompt: payload.prompt, filePath },
              {
                onStdout: (data) => {
                  const trimmed = data.trim();
                  logOutput += trimmed + '\n';
                  console.log(`[${siteName}]`, trimmed);
                  emit({ site: siteName, status: 'sending', log: logOutput });
                },
                onStderr: (data) => {
                  const trimmed = data.trim();
                  logOutput += trimmed + '\n';
                  console.error(`[${siteName}]`, trimmed);
                  emit({ site: siteName, status: 'sending', log: logOutput });
                },
                onExit: (code) => {
                  emit({
                    site: siteName,
                    status: code === 0 || code === null ? 'sent' : 'error',
                    error: code !== 0 && code !== null ? `进程退出码: ${code}` : undefined,
                    log: logOutput,
                  });
                  activeProcesses.delete(`${runId}-${siteName}`);
                  resolve();
                },
                onError: (err) => {
                  emit({ site: siteName, status: 'error', error: err.message, log: logOutput });
                  activeProcesses.delete(`${runId}-${siteName}`);
                  resolve();
                },
              }
            );
            activeProcesses.set(`${runId}-${siteName}`, child);
          } catch (err) {
            emit({
              site: siteName,
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
              log: logOutput,
            });
            resolve();
          }
        });
      }

      return runId;
    }
  );

  // 文件选择对话框
  ipcMain.handle('dialog:openFiles', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '支持的附件',
          extensions: [
            // 图片
            'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
            // 文档
            'pdf', 'doc', 'docx', 'txt', 'csv', 'xlsx', 'xls',
            'ppt', 'pptx', 'md',
          ],
        },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });
}

// ─── 默认模板（备用） ─────────────────────────────────────

function getDefaultTemplate(): string {
  return `/**
 * 站点自动化脚本
 */
import * as c from '../cli.js';
import type { SitePlugin } from '../types.js';

const KW = {
  input: ['textbox', 'textarea', 'contenteditable', '输入'],
  send: ['发送', 'send', 'submit'],
  upload: ['上传', 'upload', 'attach', '附件'],
};

const CONFIG = {
  url: 'https://example.com/chat/',
  actionDelay: 800,
};

function log(...args: unknown[]) {
  console.log('[site]', ...args);
}

export const plugin: SitePlugin = {
  name: 'site-name',
  url: CONFIG.url,

  async init() {
    await c.waitForAttach();
    c.tabNew(CONFIG.url);
    await c.sleep(3000);
  },

  async run(prompt: string, attachment?: string) {
    if (attachment) {
      try { c.upload(attachment); await c.sleep(2000); } catch { log('上传失败'); }
    }

    const snap = c.snapshot();
    const ref = c.findByKeywords(snap, KW.input);
    if (ref) c.fill(ref, prompt); else c.typeText(prompt);
    await c.sleep(CONFIG.actionDelay);

    const sendSnap = c.snapshot();
    const sendRef = c.findByKeywords(sendSnap, KW.send);
    if (sendRef) c.click(sendRef); else c.press('Enter');

    return { prompt, response: '', timestamp: new Date().toISOString(), duration: 0, success: true };
  },
};
`;
}

// ─── 应用生命周期 ──────────────────────────────────────────

app.whenReady().then(() => {
  configManager = new SiteConfigManager();
  configManager.ensureSharedFiles();
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 清理所有子进程
  for (const [, child] of activeProcesses) {
    try { child.kill(); } catch { /* ignore */ }
  }
  activeProcesses.clear();

  if (process.platform !== 'darwin') app.quit();
});
