import React, { useState, useCallback, useRef } from 'react';
import type { SiteConfig } from '../types';

interface SiteSettingsProps {
  sites: SiteConfig[];
  onBack: () => void;
  onSitesChanged: () => void;
}

interface FormData {
  name: string;
  url: string;
  script: string;
  scriptFile?: string; // 源文件路径（用于显示来源）
}

const EMPTY_FORM: FormData = { name: '', url: '', script: '' };

/** 从脚本内容中提取 name 和 url */
function extractMeta(content: string, fallbackName: string): { name: string; url: string } {
  const nameMatch =
    content.match(/name:\s*['"]([^'"]+)['"]/) ||
    content.match(/plugin\.name\s*=\s*['"]([^'"]+)['"]/);
  const urlMatch =
    content.match(/url:\s*['"](https?:\/\/[^'"]+)['"]/) ||
    content.match(/CONFIG\s*=\s*\{[^}]*url:\s*['"](https?:\/\/[^'"]+)['"]/);

  return {
    name: nameMatch?.[1] || fallbackName.replace(/\.ts$/, ''),
    url: urlMatch?.[1] || '',
  };
}

export function SiteSettings({ sites, onBack, onSitesChanged }: SiteSettingsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── 处理脚本文件（选择 / 拖拽） ────────────────

  const processScript = useCallback((content: string, fileName: string) => {
    const meta = extractMeta(content, fileName);
    setForm((f) => ({
      ...f,
      name: f.name || meta.name,
      url: f.url || meta.url,
      script: content,
      scriptFile: fileName,
    }));
  }, []);

  const handlePickFile = useCallback(async () => {
    const result = await window.api.readTsFile();
    if (!result) return;
    processScript(result.content, result.name);
  }, [processScript]);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        processScript(reader.result as string, file.name);
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [processScript]
  );

  // 拖拽处理
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      const tsFile = files.find((f) => f.name.endsWith('.ts'));
      if (!tsFile) return;

      const reader = new FileReader();
      reader.onload = () => {
        processScript(reader.result as string, tsFile.name);
      };
      reader.readAsText(tsFile);
    },
    [processScript]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  // ─── CRUD 操作 ─────────────────────────────────

  const handleEdit = useCallback(async (site: SiteConfig) => {
    const script = await window.api.getScript(site.name);
    setEditingId(site.id);
    setIsAdding(false);
    setForm({ name: site.name, url: site.url, script, scriptFile: undefined });
  }, []);

  const handleAdd = useCallback(() => {
    setEditingId(null);
    setIsAdding(true);
    setForm(EMPTY_FORM);
  }, []);

  const handleCancel = useCallback(() => {
    setEditingId(null);
    setIsAdding(false);
    setForm(EMPTY_FORM);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return;
    // 新增时脚本必填
    if (isAdding && !form.script.trim()) return;

    setSaving(true);
    try {
      if (isAdding) {
        await window.api.addSite({
          name: form.name.trim(),
          url: form.url.trim(),
          script: form.script,
        });
      } else if (editingId) {
        await window.api.updateSite(
          editingId,
          { name: form.name.trim(), url: form.url.trim() },
          form.script || undefined
        );
      }
      await onSitesChanged();
      handleCancel();
    } catch (err) {
      console.error('保存失败:', err);
    } finally {
      setSaving(false);
    }
  }, [form, isAdding, editingId, onSitesChanged, handleCancel]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('确定要删除此站点吗？')) return;
      await window.api.deleteSite(id);
      await onSitesChanged();
      if (editingId === id) handleCancel();
    },
    [editingId, onSitesChanged, handleCancel]
  );

  const isFormVisible = isAdding || editingId !== null;

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <button className="btn-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          返回
        </button>
        <h2>站点管理</h2>
      </div>

      {/* ─── 站点列表 ─── */}
      {!isFormVisible && (
        <div className="settings-list">
          <button className="btn-add-site" onClick={handleAdd}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            添加站点
          </button>

          {sites.map((site) => (
            <div key={site.id} className="settings-site-card">
              <div className="site-card-info">
                <h3>{site.name}</h3>
                {site.url && <span className="site-card-url">{site.url}</span>}
              </div>
              <div className="site-card-actions">
                <button className="btn-edit" onClick={() => handleEdit(site)}>
                  编辑
                </button>
                <button className="btn-delete" onClick={() => handleDelete(site.id)}>
                  删除
                </button>
              </div>
            </div>
          ))}

          {sites.length === 0 && (
            <div className="settings-empty">
              还没有添加任何 AI 站点。点击上方按钮添加你的第一个站点。
            </div>
          )}
        </div>
      )}

      {/* ─── 新增/编辑表单 ─── */}
      {isFormVisible && (
        <div className="settings-form">
          {/* 拖拽 / 选择文件区域 */}
          {isAdding && (
            <div
              className={`file-drop-zone ${dragOver ? 'drag-over' : ''} ${form.script ? 'has-file' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".ts"
                onChange={handleFileInputChange}
                style={{ display: 'none' }}
              />

              {!form.script ? (
                <div className="drop-prompt">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <line x1="9" y1="15" x2="15" y2="15" />
                  </svg>
                  <p>拖拽 .ts 脚本文件到此处</p>
                  <p className="drop-sub">或</p>
                  <button
                    className="btn-pick-file"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    选择文件
                  </button>
                </div>
              ) : (
                <div className="drop-file-info">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <div>
                    <span className="file-label">已加载: {form.scriptFile}</span>
                    <span className="file-size">{(form.script.length / 1024).toFixed(1)} KB</span>
                  </div>
                  <button
                    className="btn-repick"
                    onClick={() => {
                      setForm((f) => ({ ...f, script: '', scriptFile: undefined }));
                    }}
                    title="重新选择"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 名称 */}
          <div className="form-group">
            <label>站点名称</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={isAdding ? '从脚本自动提取，也可手动修改' : '例如: doubao'}
            />
          </div>

          {/* URL */}
          <div className="form-group">
            <label>站点 URL <span className="label-hint">（从脚本自动提取）</span></label>
            <input
              type="text"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://..."
            />
          </div>

          {/* 编辑模式下的脚本编辑器 */}
          {editingId && (
            <div className="form-group form-group-script">
              <label>自动化脚本 (TypeScript)</label>
              <textarea
                className="script-editor"
                value={form.script}
                onChange={(e) => setForm((f) => ({ ...f, script: e.target.value }))}
                spellCheck={false}
              />
              <div className="script-actions-row">
                <button
                  className="btn-replace-script"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  从文件替换
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ts"
                  onChange={handleFileInputChange}
                  style={{ display: 'none' }}
                />
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="form-actions">
            <button className="btn-cancel" onClick={handleCancel}>
              取消
            </button>
            <button
              className="btn-save"
              onClick={handleSave}
              disabled={saving || !form.name.trim() || (isAdding && !form.script.trim())}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
