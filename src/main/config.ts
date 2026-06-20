import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';

export interface SiteConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

interface AppData {
  sites: SiteConfig[];
  selectedSites: string[];
}

const DEFAULT_DATA: AppData = { sites: [], selectedSites: [] };

export class SiteConfigManager {
  private configPath: string;
  private data: AppData;

  constructor() {
    const dir = path.join(app.getPath('userData'), 'sites');
    fs.mkdirSync(dir, { recursive: true });
    this.configPath = path.join(dir, 'config.json');
    this.data = this.load();
  }

  private load(): AppData {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        return { ...DEFAULT_DATA, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.error('[config] 加载配置失败:', err);
    }
    return { ...DEFAULT_DATA };
  }

  private save(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  /** sites/ 目录的绝对路径 */
  get sitesDir(): string {
    return path.join(app.getPath('userData'), 'sites');
  }

  // ─── CRUD ──────────────────────────────────────────

  getSites(): SiteConfig[] {
    return [...this.data.sites];
  }

  getSelectedSites(): string[] {
    return [...this.data.selectedSites];
  }

  setSelectedSites(ids: string[]): void {
    this.data.selectedSites = ids;
    this.save();
  }

  addSite(name: string, url: string, script: string): SiteConfig {
    const id = crypto.randomBytes(4).toString('hex');
    const site: SiteConfig = { id, name, url, enabled: true };
    this.data.sites.push(site);
    this.save();

    // 写入脚本文件
    const scriptPath = path.join(this.sitesDir, `${name}.ts`);
    fs.writeFileSync(scriptPath, script, 'utf-8');

    return site;
  }

  updateSite(id: string, updates: Partial<Pick<SiteConfig, 'name' | 'url' | 'enabled'>>, script?: string): SiteConfig | null {
    const site = this.data.sites.find((s) => s.id === id);
    if (!site) return null;

    const oldName = site.name;
    if (updates.name !== undefined) site.name = updates.name;
    if (updates.url !== undefined) site.url = updates.url;
    if (updates.enabled !== undefined) site.enabled = updates.enabled;
    this.save();

    // 脚本更新
    if (script !== undefined) {
      // 如果改名了，删旧文件
      if (oldName !== site.name) {
        const oldPath = path.join(this.sitesDir, `${oldName}.ts`);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      const scriptPath = path.join(this.sitesDir, `${site.name}.ts`);
      fs.writeFileSync(scriptPath, script, 'utf-8');
    }

    return site;
  }

  deleteSite(id: string): boolean {
    const idx = this.data.sites.findIndex((s) => s.id === id);
    if (idx === -1) return false;

    const site = this.data.sites[idx];
    this.data.sites.splice(idx, 1);
    this.data.selectedSites = this.data.selectedSites.filter((sid) => sid !== id);
    this.save();

    const scriptPath = path.join(this.sitesDir, `${site.name}.ts`);
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);

    return true;
  }

  getScript(name: string): string {
    const scriptPath = path.join(this.sitesDir, `${name}.ts`);
    if (fs.existsSync(scriptPath)) {
      return fs.readFileSync(scriptPath, 'utf-8');
    }
    return '';
  }

  // ─── 共享文件 ────────────────────────────────────────

  /**
   * 将 cli.ts / types.ts 复制到 sites/ 上级目录，
   * 供站点脚本 import '../cli.js' / '../types.js' 使用。
   */
  ensureSharedFiles(): void {
    const userDataDir = app.getPath('userData');

    // 源文件路径：开发时在 app.getAppPath()/src/shared/，打包后在 process.resourcesPath/shared/
    let srcDir: string;
    if (app.isPackaged) {
      srcDir = path.join(process.resourcesPath || '', 'shared');
    } else {
      srcDir = path.join(app.getAppPath(), 'src', 'shared');
    }

    for (const file of ['cli.ts', 'types.ts']) {
      const src = path.join(srcDir, file);
      const dest = path.join(userDataDir, file);

      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      } else if (!fs.existsSync(dest)) {
        console.warn(`[config] 共享文件不存在: ${src}`);
      }
    }

    // 同步内置站点脚本到 userData
    this.syncBuiltinScripts();
  }

  /**
   * 将项目 src/sites/*.ts 同步到 userData/sites/，
   * 保证所有内置脚本在应用中可用，也方便开发时在项目目录编辑。
   */
  private syncBuiltinScripts(): void {
    let builtinDir: string;
    if (app.isPackaged) {
      builtinDir = path.join(process.resourcesPath || '', 'sites');
    } else {
      builtinDir = path.join(app.getAppPath(), 'src', 'sites');
    }

    if (!fs.existsSync(builtinDir)) return;

    const destDir = this.sitesDir;
    const files = fs.readdirSync(builtinDir).filter((f) => f.endsWith('.ts'));

    for (const file of files) {
      const src = path.join(builtinDir, file);
      const dest = path.join(destDir, file);
      try {
        fs.copyFileSync(src, dest);
      } catch (err) {
        console.warn(`[config] 同步脚本失败: ${file}`, err);
      }
    }

    console.log(`[config] 已同步 ${files.length} 个内置脚本到 ${destDir}`);
  }
}
