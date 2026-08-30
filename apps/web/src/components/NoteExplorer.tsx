import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { NoteFolderTreeNode } from '../lib/noteTree';
import { MarkdownTitle } from './MarkdownRenderer';

interface NoteExplorerProps {
  tree: NoteFolderTreeNode[];
  selectedNoteId: string | undefined;
  activeFolderId: string | null;
  expandedFolderIds: Set<string>;
  forceExpanded: boolean;
  onSelectFolder: (folderId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onSelectNote: (noteId: string, folderId: string) => void;
}

function folderKey(folderId: string) {
  return `folder:${folderId}`;
}

function noteKey(noteId: string) {
  return `note:${noteId}`;
}

function treeContainsKey(nodes: NoteFolderTreeNode[], key: string): boolean {
  for (const node of nodes) {
    if (folderKey(node.folder.id) === key) return true;
    if (node.notes.some((note) => noteKey(note.id) === key)) return true;
    if (treeContainsKey(node.children, key)) return true;
  }
  return false;
}

function focusTreeItem(tree: HTMLElement, key: string) {
  const item = [...tree.querySelectorAll<HTMLElement>('[data-note-tree-item="true"]')]
    .find((candidate) => candidate.dataset.treeKey === key);
  item?.focus();
}

export function NoteExplorer({
  tree,
  selectedNoteId,
  activeFolderId,
  expandedFolderIds,
  forceExpanded,
  onSelectFolder,
  onToggleFolder,
  onSelectNote,
}: NoteExplorerProps) {
  const selectedKey = selectedNoteId ? noteKey(selectedNoteId) : '';
  const firstKey = tree[0] ? folderKey(tree[0].folder.id) : '';
  const [focusedKey, setFocusedKey] = useState(selectedKey || firstKey);

  useEffect(() => {
    if (selectedKey && treeContainsKey(tree, selectedKey)) setFocusedKey(selectedKey);
    else if (!treeContainsKey(tree, focusedKey)) setFocusedKey(firstKey);
  }, [firstKey, focusedKey, selectedKey, tree]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.dataset.noteTreeItem !== 'true') return;
    const treeElement = event.currentTarget;
    const items = [...treeElement.querySelectorAll<HTMLElement>('[data-note-tree-item="true"]')];
    const currentIndex = items.indexOf(target);
    if (currentIndex < 0) return;

    const focusAt = (index: number) => {
      const item = items[index];
      if (!item) return;
      setFocusedKey(item.dataset.treeKey || '');
      item.focus();
    };

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(Math.min(items.length - 1, currentIndex + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(Math.max(0, currentIndex - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(items.length - 1);
    } else if (event.key === 'ArrowRight' && target.dataset.treeKind === 'folder') {
      event.preventDefault();
      if (target.getAttribute('aria-expanded') === 'false') target.click();
      else focusAt(Math.min(items.length - 1, currentIndex + 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (target.dataset.treeKind === 'folder' && target.getAttribute('aria-expanded') === 'true' && !forceExpanded) {
        target.click();
        return;
      }
      const parentKey = target.dataset.parentKey;
      if (parentKey) focusTreeItem(treeElement, parentKey);
    }
  };

  const renderFolder = (node: NoteFolderTreeNode, depth: number, parentKey = '') => {
    const key = folderKey(node.folder.id);
    const hasChildren = node.children.length > 0 || node.notes.length > 0;
    const expanded = hasChildren && (forceExpanded || expandedFolderIds.has(node.folder.id));
    const codeMatch = node.folder.name.match(/^([A-V])\s+(.+)$/u);
    const rowStyle = { '--tree-depth': depth } as CSSProperties;

    return (
      <div className="note-tree__branch" role="none" key={node.folder.id}>
        <button
          type="button"
          role="treeitem"
          aria-expanded={hasChildren ? expanded : undefined}
          aria-level={depth + 1}
          className={`note-tree__row note-tree__row--folder${activeFolderId === node.folder.id ? ' is-current-folder' : ''}`}
          style={rowStyle}
          tabIndex={focusedKey === key ? 0 : -1}
          data-note-tree-item="true"
          data-tree-kind="folder"
          data-tree-key={key}
          data-parent-key={parentKey || undefined}
          title={node.folder.name}
          onFocus={() => setFocusedKey(key)}
          onClick={() => {
            setFocusedKey(key);
            onSelectFolder(node.folder.id);
            if (hasChildren && !forceExpanded) onToggleFolder(node.folder.id);
          }}
        >
          <span className="note-tree__disclosure" aria-hidden="true">
            {hasChildren ? (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}
          </span>
          <span className="note-tree__icon" aria-hidden="true">
            {expanded ? <FolderOpen size={17} /> : <Folder size={17} />}
          </span>
          {codeMatch ? (
            <>
              <span className="note-tree__folder-code">{codeMatch[1]}</span>
              <span className="note-tree__label">{codeMatch[2]}</span>
            </>
          ) : <span className="note-tree__label">{node.folder.name}</span>}
          {node.noteCount > 0 ? <span className="note-tree__count">{node.noteCount}</span> : null}
        </button>
        {expanded ? (
          <div role="group" className="note-tree__group">
            {node.children.map((child) => renderFolder(child, depth + 1, key))}
            {node.notes.map((note) => {
              const fileKey = noteKey(note.id);
              return (
                <button
                  type="button"
                  role="treeitem"
                  aria-level={depth + 2}
                  aria-selected={selectedNoteId === note.id}
                  className={`note-tree__row note-tree__row--file${selectedNoteId === note.id ? ' is-active' : ''}`}
                  style={{ '--tree-depth': depth + 1 } as CSSProperties}
                  tabIndex={focusedKey === fileKey ? 0 : -1}
                  data-note-tree-item="true"
                  data-tree-kind="file"
                  data-tree-key={fileKey}
                  data-parent-key={key}
                  title={note.title || '未命名笔记'}
                  key={note.id}
                  onFocus={() => setFocusedKey(fileKey)}
                  onClick={() => {
                    setFocusedKey(fileKey);
                    onSelectNote(note.id, node.folder.id);
                  }}
                >
                  <span className="note-tree__disclosure" aria-hidden="true" />
                  <span className="note-tree__icon note-tree__icon--file" aria-hidden="true"><FileText size={16} /></span>
                  <span className="note-tree__label"><MarkdownTitle source={note.title || '未命名笔记'} /></span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="note-tree" role="tree" aria-label="笔记文件树" onKeyDown={handleKeyDown}>
      {tree.map((node) => renderFolder(node, 0))}
    </div>
  );
}
