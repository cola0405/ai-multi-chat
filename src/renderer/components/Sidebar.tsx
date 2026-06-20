import React from 'react';
import type { SiteConfig } from '../types';

interface SidebarProps {
  sites: SiteConfig[];
  selectedIds: string[];
  onToggleSite: (id: string) => void;
  onOpenSettings: () => void;
  onNewConversation: () => void;
}

export function Sidebar({ sites, selectedIds, onToggleSite, onOpenSettings, onNewConversation }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>AI 站点</h2>
        <button className="btn-new-chat" onClick={onNewConversation} title="新建会话">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      <div className="sidebar-list">
        {sites.length === 0 && (
          <div className="sidebar-empty">
            暂无站点，请在设置中添加
          </div>
        )}
        {sites.map((site) => (
          <label key={site.id} className="site-item">
            <input
              type="checkbox"
              checked={selectedIds.includes(site.id)}
              onChange={() => onToggleSite(site.id)}
              className="site-checkbox"
            />
            <div className="site-info">
              <span className="site-name">{site.name}</span>
              <span className="site-url">{site.url}</span>
            </div>
          </label>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="btn-settings" onClick={onOpenSettings}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          管理站点
        </button>
      </div>
    </aside>
  );
}
