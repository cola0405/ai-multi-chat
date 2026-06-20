export interface SiteConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface Attachment {
  path: string;
  name: string;
  type: 'image' | 'document';
}

export interface ChatMessage {
  id: string;
  type: 'user' | 'status';
  prompt?: string;
  attachments?: Attachment[];
  results?: Record<string, SiteResult>;
  timestamp: number;
}

export interface SiteResult {
  siteName: string;
  status: 'sending' | 'sent' | 'error';
  error?: string;
  log?: string;
}

/** 主进程推送的运行事件 */
export interface RunEvent {
  runId: string;
  statusMsgId: string;
  site: string;
  status: 'sending' | 'sent' | 'error';
  error?: string;
  log?: string;
}

/** Electron preload 暴露的 API */
export interface ElectronAPI {
  getSites: () => Promise<SiteConfig[]>;
  getSelectedSites: () => Promise<string[]>;
  setSelectedSites: (ids: string[]) => Promise<void>;
  addSite: (data: { name: string; url: string; script: string }) => Promise<SiteConfig>;
  updateSite: (
    id: string,
    updates: { name?: string; url?: string; enabled?: boolean },
    script?: string
  ) => Promise<SiteConfig | null>;
  deleteSite: (id: string) => Promise<boolean>;
  getScript: (name: string) => Promise<string>;
  getTemplate: () => Promise<string>;
  run: (payload: {
    sites: string[];
    prompt: string;
    attachments: string[];
    statusMsgId: string;
  }) => Promise<string>;
  onRunEvent: (callback: (event: RunEvent) => void) => () => void;
  selectFiles: () => Promise<string[]>;
  readTsFile: () => Promise<{ path: string; name: string; content: string } | null>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
