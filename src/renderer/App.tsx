import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatInput } from './components/ChatInput';
import { MessageList } from './components/MessageList';
import { SiteSettings } from './components/SiteSettings';
import type { SiteConfig, ChatMessage, Attachment, RunEvent } from './types';

type View = 'chat' | 'settings';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
function getFileType(filename: string): 'image' | 'document' {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTS.includes(ext) ? 'image' : 'document';
}

export default function App() {
  const [sites, setSites] = useState<SiteConfig[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [view, setView] = useState<View>('chat');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // 初始加载
  useEffect(() => {
    (async () => {
      const [allSites, selected] = await Promise.all([
        window.api.getSites(),
        window.api.getSelectedSites(),
      ]);
      setSites(allSites);
      setSelectedIds(selected);
    })();
  }, []);

  // 监听运行事件（实时推送脚本输出）
  useEffect(() => {
    const cleanup = window.api.onRunEvent((event: RunEvent) => {
      console.log('[run:event 收到]', JSON.stringify(event));
      setMessages((prev) => {
        console.log('[run:event] 当前消息数:', prev.length, '匹配 statusMsgId:', event.statusMsgId, '站点:', event.site);
        return prev.map((msg) => {
          if (msg.id !== event.statusMsgId || !msg.results) return msg;
          if (!msg.results[event.site]) return msg;
          return {
            ...msg,
            results: {
              ...msg.results,
              [event.site]: {
                siteName: event.site,
                status: event.status,
                error: event.error,
                log: event.log,
              },
            },
          };
        });
      });
    });
    return cleanup;
  }, []);

  // 刷新站点列表
  const refreshSites = useCallback(async () => {
    const allSites = await window.api.getSites();
    setSites(allSites);
  }, []);

  // 切换站点选择
  const handleToggleSite = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        window.api.setSelectedSites(next);
        return next;
      });
    },
    []
  );

  // 发送消息（非阻塞，fire-and-forget）
  const handleSend = useCallback(
    (prompt: string, attachments: Attachment[]) => {
      const selectedSites = sites.filter((s) => selectedIds.includes(s.id));
      if (selectedSites.length === 0) return;

      const statusMsgId = `status-${Date.now()}`;

      // 用户消息
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        type: 'user',
        prompt,
        attachments,
        timestamp: Date.now(),
      };

      // 状态消息（初始全部 sending）
      const statusMsg: ChatMessage = {
        id: statusMsgId,
        type: 'status',
        results: Object.fromEntries(
          selectedSites.map((s) => [
            s.name,
            { siteName: s.name, status: 'sending' as const },
          ])
        ),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, statusMsg]);

      // 发起运行（不等待结果，结果通过事件推送）
      console.log('[run] 发起运行, statusMsgId:', statusMsgId, 'sites:', selectedSites.map((s) => s.name));
      window.api
        .run({
          sites: selectedSites.map((s) => s.name),
          prompt,
          attachments: attachments.map((a) => a.path),
          statusMsgId,
        })
        .then((runId) => console.log('[run] 主进程返回 runId:', runId))
        .catch((err) => console.error('[run] 启动运行失败:', err));
    },
    [sites, selectedIds]
  );

  // 新建会话（清空消息区）
  const handleNewConversation = useCallback(() => {
    setMessages([]);
  }, []);

  // 站点变更后刷新
  const handleSitesChanged = useCallback(async () => {
    await refreshSites();
  }, [refreshSites]);

  // 窗口级拖拽
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const newAttachments: Attachment[] = files.map((f) => ({
      path: window.api.getPathForFile(f),
      name: f.name,
      type: getFileType(f.name),
    }));
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  return (
    <div
      className="app"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="titlebar" />

      {dragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p>松开以添加附件</p>
          </div>
        </div>
      )}

      <div className="app-body">
        <Sidebar
          sites={sites}
          selectedIds={selectedIds}
          onToggleSite={handleToggleSite}
          onOpenSettings={() => setView('settings')}
          onNewConversation={handleNewConversation}
        />

        <main className="main-content">
          {view === 'chat' ? (
            <>
              <MessageList messages={messages} />
              <ChatInput
                onSend={handleSend}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
              />
            </>
          ) : (
            <SiteSettings
              sites={sites}
              onBack={() => setView('chat')}
              onSitesChanged={handleSitesChanged}
            />
          )}
        </main>
      </div>
    </div>
  );
}
