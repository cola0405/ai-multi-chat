import React, { useState, useRef, useCallback } from 'react';
import type { Attachment } from '../types';

interface ChatInputProps {
  onSend: (prompt: string, attachments: Attachment[]) => void;
}

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];

function getFileType(filename: string): 'image' | 'document' {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTS.includes(ext) ? 'image' : 'document';
}

export function ChatInput({ onSend }: ChatInputProps) {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自动调整 textarea 高度
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  // 添加附件
  const handleAddFiles = useCallback(async () => {
    const filePaths = await window.api.selectFiles();
    if (filePaths.length === 0) return;
    const newAttachments: Attachment[] = filePaths.map((fp) => ({
      path: fp,
      name: fp.split(/[/\\]/).pop() || fp,
      type: getFileType(fp),
    }));
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  // 移除附件
  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // 拖拽添加
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const newAttachments: Attachment[] = files.map((f) => ({
      path: f.path,
      name: f.name,
      type: getFileType(f.name),
    }));
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // 发送
  const handleSend = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onSend(trimmed, attachments);
    setPrompt('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [prompt, attachments, onSend]);

  // Enter 发送，Shift+Enter 换行
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="chat-input-area" onDrop={handleDrop} onDragOver={handleDragOver}>
      {/* 附件预览 */}
      {attachments.length > 0 && (
        <div className="attachments-preview">
          {attachments.map((att, idx) => (
            <div key={idx} className="attachment-chip">
              {att.type === 'image' ? (
                <img src={`file://${att.path}`} alt={att.name} className="attachment-thumb" />
              ) : (
                <div className="attachment-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
              )}
              <span className="attachment-name">{att.name}</span>
              <button
                className="attachment-remove"
                onClick={() => handleRemoveAttachment(idx)}
                title="移除"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 输入区域 */}
      <div className="input-row">
        <button
          className="btn-attach"
          onClick={handleAddFiles}
          title="添加附件"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          className="prompt-textarea"
          placeholder="输入你的问题..."
          value={prompt}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
        />

        <button
          className="btn-send"
          onClick={handleSend}
          disabled={!prompt.trim()}
          title="发送"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
