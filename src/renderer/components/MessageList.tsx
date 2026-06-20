import React, { useRef, useEffect, useState } from 'react';
import type { ChatMessage } from '../types';

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="message-list empty">
        <div className="empty-hint">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p>选择左侧的 AI 站点，输入问题后一键发送</p>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((msg) => (
        <div key={msg.id} className={`message ${msg.type}`}>
          {msg.type === 'user' && (
            <div className="message-user">
              <div className="message-bubble user-bubble">
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="message-attachments">
                    {msg.attachments.map((att, i) => (
                      <div key={i} className="msg-attachment">
                        {att.type === 'image' ? (
                          <img src={`file://${att.path}`} alt={att.name} />
                        ) : (
                          <span className="doc-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                            {att.name}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="message-text">{msg.prompt}</div>
              </div>
            </div>
          )}

          {msg.type === 'status' && msg.results && (
            <div className="message-status">
              {Object.entries(msg.results).map(([siteName, result]) => (
                <StatusItem key={siteName} result={result} />
              ))}
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

/** 单个站点的状态条目（可展开查看日志） */
function StatusItem({ result }: { result: { siteName: string; status: string; error?: string; log?: string } }) {
  const hasLog = !!result.log?.trim();
  // 默认展开日志，方便查看执行过程
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`status-item status-${result.status}`}>
      <span className="status-icon">
        {result.status === 'sending' && <span className="pulse-dot" />}
        {result.status === 'sent' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {result.status === 'error' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        )}
      </span>

      <span
        className={`status-name ${hasLog ? 'clickable' : ''}`}
        onClick={() => hasLog && setExpanded(!expanded)}
      >
        {result.siteName}
        {hasLog && (
          <svg
            className={`expand-arrow ${expanded ? 'expanded' : ''}`}
            width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </span>

      <span className="status-text">
        {result.status === 'sending' && '执行中...'}
        {result.status === 'sent' && '已发送，浏览器已打开'}
        {result.status === 'error' && (result.error || '执行失败')}
      </span>

      {expanded && result.log && (
        <pre className="status-log">{result.log.trim()}</pre>
      )}
    </div>
  );
}
