import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatInput } from './components/ChatInput';
import { MessageList } from './components/MessageList';
import { SiteSettings } from './components/SiteSettings';
import type { SiteConfig, ChatMessage, Attachment, RunEvent } from './types';

type View = 'chat' | 'settings';

export default function App() {
  const [sites, setSites] = useState<SiteConfig[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [view, setView] = useState<View>('chat');

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

  return (
    <div className="app">
      <div className="titlebar" />

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
              <ChatInput onSend={handleSend} />
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
