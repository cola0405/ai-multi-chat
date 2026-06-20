/**
 * 站点插件接口 — 每个网站脚本导出一个 SitePlugin
 */

export interface RunResult {
  prompt: string;
  attachment?: string;
  response: string;
  timestamp: string;
  duration: number;
  success: boolean;
  error?: string;
}

export interface SitePlugin {
  /** 站点名称 */
  name: string;
  /** 站点 URL */
  url: string;

  /** 导航到站点并确认就绪 */
  init(): Promise<void>;

  /** 发送一条消息 */
  run(prompt: string, attachment?: string): Promise<RunResult>;

  /** 开启新对话（可选） */
  newChat?(): Promise<void>;
}
