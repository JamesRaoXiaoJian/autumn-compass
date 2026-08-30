import { ArrowLeft, CheckCircle2, ChevronRight, ChevronsDownUp, Eye, Folder, Lightbulb, List, PencilLine, Plus, Quote, Search, Trash2 } from 'lucide-react';
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MarkdownRenderer, MarkdownTitle } from '../components/MarkdownRenderer';
import { NoteExplorer } from '../components/NoteExplorer';
import {
  initialNoteFolders,
  initialNotes,
  noteFoldersStorageKey,
  unfiledFolderId,
  type CareerNote,
  type NoteFolder,
} from '../data/noteDefaults';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { createEntityId } from '../lib/createEntityId';
import {
  buildNoteFolderTree,
  createInitialNoteFolders,
  ensureNoteFolderPath,
  getNoteFolderPath,
  getNoteFolderPathLabel,
  mergeMissingNoteFolders,
  migrateLegacyNoteFolders,
  resolveNoteFolderId,
  validateNoteFolderPathInput,
} from '../lib/noteTree';

export function NotesView() {
  const [notes, setNotes] = useLocalStorage<CareerNote[]>('autumn-compass-notes-v2-embodied', initialNotes);
  const folderKeyWasMissingRef = useRef(window.localStorage.getItem(noteFoldersStorageKey) === null);
  const initialFoldersRef = useRef<NoteFolder[] | null>(null);
  if (initialFoldersRef.current === null) {
    initialFoldersRef.current = folderKeyWasMissingRef.current
      ? createInitialNoteFolders(notes, initialNoteFolders)
      : initialNoteFolders;
  }
  const [folders, setFolders] = useLocalStorage<NoteFolder[]>(noteFoldersStorageKey, initialFoldersRef.current);
  const [selectedId, setSelectedId] = useState(notes[0]?.id || '');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'read' | 'edit'>('read');
  const [mobilePane, setMobilePane] = useState<'note' | 'list'>('note');
  const layoutRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const noteDocumentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selected = notes.find((note) => note.id === selectedId) || notes[0];
  const selectedFolderId = selected ? resolveNoteFolderId(selected, folders) : null;
  const selectedFolderPath = getNoteFolderPath(selectedFolderId, folders);
  const selectedFolderPathLabel = selectedFolderPath.map((folder) => folder.name).join(' › ');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase('zh-CN'));
  const visible = useMemo(() => notes.filter((note) => {
    if (!deferredSearch) return true;
    const folderId = resolveNoteFolderId(note, folders);
    const path = getNoteFolderPathLabel(folderId, folders);
    return `${note.title} ${path} ${note.category} ${note.content}`
      .toLocaleLowerCase('zh-CN')
      .includes(deferredSearch);
  }), [deferredSearch, folders, notes]);
  const noteTree = useMemo(
    () => buildNoteFolderTree(folders, visible, { includeEmptyFolders: !deferredSearch }),
    [deferredSearch, folders, visible],
  );
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(selectedFolderPath.map((folder) => folder.id)),
  );
  const [activeFolderId, setActiveFolderId] = useState<string | null>(selectedFolderId);
  const [folderPathDraft, setFolderPathDraft] = useState(selectedFolderPathLabel);
  const [folderPathError, setFolderPathError] = useState('');
  const legacyMigrationPendingRef = useRef(folderKeyWasMissingRef.current);

  useEffect(() => {
    const nextFolders = mergeMissingNoteFolders(folders, initialNoteFolders);
    if (nextFolders !== folders) setFolders(nextFolders);
  }, [folders, setFolders]);

  useEffect(() => {
    if (!legacyMigrationPendingRef.current) return;
    legacyMigrationPendingRef.current = false;
    const migrated = migrateLegacyNoteFolders(notes, folders);
    if (migrated !== notes) setNotes(migrated);
  }, [folders, notes, setNotes]);

  useEffect(() => {
    setFolderPathDraft(selectedFolderPathLabel);
    setFolderPathError('');
    if (!selectedFolderId) return;
    setActiveFolderId(selectedFolderId);
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      selectedFolderPath.forEach((folder) => next.add(folder.id));
      return next;
    });
  }, [selected?.id, selectedFolderId, selectedFolderPathLabel]);

  useLayoutEffect(() => {
    if (viewMode !== 'edit' || !textareaRef.current) return;
    const textarea = textareaRef.current;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.max(360, textarea.scrollHeight)}px`;
  }, [selected?.content, selected?.id, viewMode]);

  const showResponsivePane = (pane: 'note' | 'list') => {
    setMobilePane(pane);
    if (!window.matchMedia('(max-width: 1100px)').matches) return;
    window.requestAnimationFrame(() => {
      layoutRef.current?.scrollIntoView({ block: 'start' });
      if (pane === 'list') searchInputRef.current?.focus({ preventScroll: true });
      else noteDocumentRef.current?.focus({ preventScroll: true });
    });
  };

  const addNote = () => {
    const folderId = activeFolderId && folders.some((folder) => folder.id === activeFolderId)
      ? activeFolderId
      : selectedFolderId || unfiledFolderId;
    const folderPath = getNoteFolderPath(folderId, folders);
    const category = folderPath.at(-1)?.name.replace(/^([A-V])\s+/u, '') || '自定义笔记';
    const note: CareerNote = {
      id: createEntityId('note'),
      title: '未命名笔记',
      category,
      content: '',
      folderId,
    };
    setNotes([note, ...notes]);
    setSelectedId(note.id);
    setSearch('');
    setExpandedFolderIds((current) => new Set([...current, ...folderPath.map((folder) => folder.id)]));
    setViewMode('edit');
    showResponsivePane('note');
  };

  const selectNote = (id: string) => {
    setSelectedId(id);
    setViewMode('read');
    showResponsivePane('note');
  };

  const update = (changes: Partial<CareerNote>) => {
    if (!selected) return;
    setNotes(notes.map((note) => note.id === selected.id ? { ...note, ...changes } : note));
  };

  const commitFolderPath = () => {
    if (!selected) return;
    const validation = validateNoteFolderPathInput(folderPathDraft);
    if (validation.error) {
      setFolderPathError(validation.error);
      return;
    }
    const ensured = ensureNoteFolderPath(
      validation.path,
      folders,
      () => createEntityId('note-folder'),
    );
    if (!ensured.folderId) return;
    if (ensured.folders.length !== folders.length) setFolders(ensured.folders);
    update({ folderId: ensured.folderId });
    setActiveFolderId(ensured.folderId);
    const path = getNoteFolderPath(ensured.folderId, ensured.folders);
    setExpandedFolderIds((current) => new Set([...current, ...path.map((folder) => folder.id)]));
    setFolderPathDraft(path.map((folder) => folder.name).join(' › '));
    setFolderPathError('');
  };

  const deleteSelected = () => {
    if (!selected || !window.confirm(`确认删除“${selected.title || '未命名笔记'}”？`)) return;
    const selectedIndex = notes.findIndex((note) => note.id === selected.id);
    const nextNotes = notes.filter((note) => note.id !== selected.id);
    const nextSelected = nextNotes[Math.min(selectedIndex, nextNotes.length - 1)];
    setNotes(nextNotes);
    setSelectedId(nextSelected?.id || '');
    setViewMode('read');
  };

  return (
    <div className="view notes-view">
      <section className="page-intro page-intro--compact"><div><div className="eyebrow">CAREER NOTES</div><h1>求职笔记</h1><p>用多层文件夹整理训练、项目证据和面试复盘，全部由服务器工作区统一保存。</p></div><button type="button" className="button button--primary" onClick={addNote}><Plus size={17} />新建笔记</button></section>
      <section ref={layoutRef} className={`notes-layout panel notes-layout--mobile-${mobilePane}`}>
        <aside className="notes-list" aria-label="笔记索引">
          <div className="notes-list__top">
            <div className="notes-list__heading">
              <div><span>EXPLORER</span><strong>笔记文件</strong></div>
              <span className="notes-list__count" aria-live="polite">{deferredSearch ? `${visible.length} 个结果` : `${notes.length} 篇`}</span>
              <button type="button" className="notes-list__collapse" title={deferredSearch ? '搜索时自动展开匹配目录' : '全部折叠'} aria-label="折叠全部笔记文件夹" disabled={Boolean(deferredSearch)} onClick={() => setExpandedFolderIds(new Set())}><ChevronsDownUp size={16} /></button>
              <button type="button" className="text-button notes-list__back" onClick={() => showResponsivePane('note')}><ArrowLeft size={16} />返回正文</button>
            </div>
            <div className="notes-search" role="search"><Search size={16} /><input ref={searchInputRef} aria-label="搜索笔记" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、路径、分类或正文" /></div>
          </div>
          <div className={`notes-list__items${visible.length || !deferredSearch ? '' : ' is-empty'}`}>
            {visible.length || !deferredSearch ? (
              <NoteExplorer
                tree={noteTree}
                selectedNoteId={selected?.id}
                activeFolderId={activeFolderId}
                expandedFolderIds={expandedFolderIds}
                forceExpanded={Boolean(deferredSearch)}
                onSelectFolder={setActiveFolderId}
                onToggleFolder={(folderId) => setExpandedFolderIds((current) => {
                  const next = new Set(current);
                  if (next.has(folderId)) next.delete(folderId);
                  else next.add(folderId);
                  return next;
                })}
                onSelectNote={(noteId, folderId) => {
                  setActiveFolderId(folderId);
                  selectNote(noteId);
                }}
              />
            ) : (
              <div className="notes-list__empty">
                <Search size={24} />
                <strong>没有匹配的笔记</strong>
                <p>换一个关键词，或清除搜索后查看全部内容。</p>
                <button type="button" className="text-button" onClick={() => setSearch('')}>清除搜索</button>
              </div>
            )}
          </div>
        </aside>
        {selected ? (
          <article className={`note-editor note-editor--${viewMode}`}>
            <div className="note-toolbar">
              <button type="button" className="text-button notes-mobile-toggle" onClick={() => showResponsivePane('list')}><List size={17} />全部笔记</button>
              <div className="note-mode-toggle" role="group" aria-label="笔记显示模式">
                <button type="button" className={viewMode === 'read' ? 'is-active' : ''} aria-pressed={viewMode === 'read'} onClick={() => setViewMode('read')}><Eye size={16} />阅读</button>
                <button type="button" className={viewMode === 'edit' ? 'is-active' : ''} aria-pressed={viewMode === 'edit'} onClick={() => setViewMode('edit')}><PencilLine size={16} />编辑</button>
              </div>
              <div className="note-toolbar__saved"><CheckCircle2 size={15} /><span>自动保存</span></div>
              <button type="button" className="text-button note-delete-button" onClick={deleteSelected} aria-label={`删除${selected.title}`}><Trash2 size={15} />删除</button>
            </div>
            <div className="note-document-scroll">
              <div ref={noteDocumentRef} className="note-document" tabIndex={-1}>
                {viewMode === 'edit' ? (
                  <>
                    <div className="note-editor__meta note-editor__meta--folder">
                      <Folder size={17} />
                      <label htmlFor="note-folder-path">文件夹</label>
                      <input
                        id="note-folder-path"
                        aria-label="笔记文件夹路径"
                        aria-invalid={folderPathError ? 'true' : undefined}
                        value={folderPathDraft}
                        onChange={(event) => {
                          setFolderPathDraft(event.target.value);
                          setFolderPathError('');
                        }}
                        onBlur={commitFolderPath}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            event.currentTarget.blur();
                          } else if (event.key === 'Escape') {
                            setFolderPathDraft(selectedFolderPathLabel);
                            setFolderPathError('');
                            event.currentTarget.blur();
                          }
                        }}
                        placeholder="求职准备 › 项目表达"
                      />
                      <small>用 › 或 &gt; 分隔层级</small>
                    </div>
                    {folderPathError ? <div className="note-editor__path-error" role="alert">{folderPathError}</div> : null}
                    <input aria-label="笔记标题" className="note-title-input" value={selected.title} onChange={(event) => update({ title: event.target.value })} />
                    <textarea ref={textareaRef} rows={12} aria-label="笔记正文" className="note-editor__textarea" value={selected.content} onChange={(event) => update({ content: event.target.value })} placeholder="使用 Markdown 记录岗位判断、项目证据、面试问题或复盘结论……" />
                    <div className="writing-hint"><Lightbulb size={16} /><span>支持 Markdown 标题、列表、图片、表格、代码块，以及 <code>$...$</code> / <code>$$...$$</code> / <code>\[...\]</code> 公式；兼容独立多行方括号与明确的裸 LaTeX 变量，内容仍按原文自动保存。</span></div>
                  </>
                ) : (
                  <>
                    <header className="note-reader__header">
                      <div className="note-reader__path" aria-label={`文件夹：${selectedFolderPathLabel || '未归档'}`}>
                        <Folder size={17} />
                        {(selectedFolderPath.length ? selectedFolderPath : [{ id: 'unfiled', name: '未归档' }]).map((folder, index) => (
                          <span key={folder.id}>
                            {index > 0 ? <ChevronRight size={14} aria-hidden="true" /> : null}
                            <span>{folder.name}</span>
                          </span>
                        ))}
                      </div>
                      <h2 className="note-reader__title"><MarkdownTitle source={selected.title || '未命名笔记'} /></h2>
                    </header>
                    <div className={`note-reader${selected.content ? '' : ' note-reader--empty'}`}>
                      {selected.content ? <MarkdownRenderer source={selected.content} /> : '还没有正文。切换到编辑模式，记录第一条想法。'}
                    </div>
                  </>
                )}
              </div>
            </div>
          </article>
        ) : (
          <div className="empty-note">
            <button type="button" className="text-button notes-mobile-toggle" onClick={() => showResponsivePane('list')}><List size={17} />全部笔记</button>
            <Quote size={32} />
            <p>选择或新建一篇笔记</p>
          </div>
        )}
      </section>
    </div>
  );
}
