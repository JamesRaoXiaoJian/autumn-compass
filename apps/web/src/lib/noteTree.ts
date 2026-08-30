import type { CareerNote, NoteFolder } from '../data/noteDefaults';
import { preparationFolderId, unfiledFolderId } from '../data/noteDefaults';

export const interviewTrainingFolderId = 'note-folder-interview-training';
export const interviewTrainingLedgerFolderId = 'note-folder-interview-training-ledger';

const naturalCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const maxFolderDepth = 8;
const maxFolderNameLength = 80;

export interface NoteFolderTreeNode {
  folder: NoteFolder;
  children: NoteFolderTreeNode[];
  notes: CareerNote[];
  noteCount: number;
}

export interface FolderPathValidation {
  path: string[];
  error: string;
}

function compactMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_`~#]/gu, '')
    .trim();
}

function normalizedName(value: string) {
  return compactMarkdown(value)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/^([a-v])\s*[·.、:_-]?\s*/u, '')
    .replace(/[\s/\\·•._-]+/gu, '');
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function legacyCategoryFolderId(parentId: string, name: string) {
  return `note-folder-category-${stableHash(`${parentId}\u0000${normalizedName(name)}`)}`;
}

export function ledgerSectionFolderId(code: string) {
  return `note-folder-interview-training-${code.toLocaleLowerCase('en-US')}`;
}

function splitMarkdownRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return [];
  return trimmed
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell) => compactMarkdown(cell));
}

function parseLedgerSections(content: string) {
  const sections = new Map<string, string>();
  for (const line of content.split(/\r?\n/u)) {
    const cells = splitMarkdownRow(line);
    if (cells.length < 2) continue;
    const match = cells[0].match(/^([A-V])\d{3}\s*[–—-]\s*(?:[A-V])?\d{3}$/iu);
    const name = cells[1]?.trim();
    if (!match || !name || /^[-:]+$/u.test(name)) continue;
    sections.set(match[1].toLocaleUpperCase('en-US'), name);
  }
  return sections;
}

function noteCode(note: CareerNote) {
  return compactMarkdown(note.title).match(/^([A-V])\d{3}(?:\b|\s|[｜|·:：—-])/iu)?.[1].toLocaleUpperCase('en-US') || '';
}

function trainingCategoryParts(category: string) {
  const parts = category.split(/[·•]/u).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [];
}

function insertFolder(folders: NoteFolder[], folder: NoteFolder) {
  if (folders.some((candidate) => candidate.id === folder.id)) return;
  folders.push(folder);
}

function findChildByName(folders: NoteFolder[], parentId: string | null, name: string) {
  const target = normalizedName(name);
  return folders.find((folder) => folder.parentId === parentId && normalizedName(folder.name) === target);
}

/**
 * Creates the first private folder snapshot. The interview section names are
 * parsed from the user's own ledger and never copied into public source data.
 */
export function createInitialNoteFolders(notes: CareerNote[], neutralFolders: NoteFolder[]) {
  const folders = neutralFolders.map((folder) => ({ ...folder }));
  const ledger = notes.find((note) => {
    const parts = trainingCategoryParts(note.category);
    return normalizedName(parts.at(-1) || '') === normalizedName('总账')
      && parseLedgerSections(note.content).size > 0;
  }) || notes.find((note) => parseLedgerSections(note.content).size >= 3);
  const trainingNotes = notes.filter((note) => trainingCategoryParts(note.category).length > 0);

  if (ledger || trainingNotes.length) {
    const ledgerCategory = ledger ? trainingCategoryParts(ledger.category) : [];
    const rootName = ledgerCategory[0] || trainingCategoryParts(trainingNotes[0]?.category || '')[0] || '面试训练';
    insertFolder(folders, {
      id: interviewTrainingFolderId,
      name: rootName,
      parentId: null,
      sortOrder: 10,
    });
    insertFolder(folders, {
      id: interviewTrainingLedgerFolderId,
      name: ledgerCategory[1] || '总账',
      parentId: interviewTrainingFolderId,
      sortOrder: 0,
    });

    const ledgerSections = ledger ? parseLedgerSections(ledger.content) : new Map<string, string>();
    for (const note of trainingNotes) {
      const code = noteCode(note);
      const parts = trainingCategoryParts(note.category);
      if (code && !ledgerSections.has(code) && parts[1] && normalizedName(parts[1]) !== normalizedName('总账')) {
        ledgerSections.set(code, parts[1]);
      }
    }
    for (const [code, name] of [...ledgerSections].sort(([left], [right]) => left.localeCompare(right))) {
      insertFolder(folders, {
        id: ledgerSectionFolderId(code),
        name: `${code} ${name}`,
        parentId: interviewTrainingFolderId,
        sortOrder: (code.charCodeAt(0) - 64) * 10,
      });
    }
  }

  // Preserve pre-existing non-training categories without embedding them in
  // public defaults. Exact category names become private folder entities.
  for (const note of notes) {
    if (!note.category.trim() || trainingCategoryParts(note.category).length) continue;
    if (findChildByName(folders, preparationFolderId, note.category)) continue;
    insertFolder(folders, {
      id: legacyCategoryFolderId(preparationFolderId, note.category),
      name: note.category.trim(),
      parentId: preparationFolderId,
      sortOrder: 100 + folders.filter((folder) => folder.parentId === preparationFolderId).length * 10,
    });
  }

  return folders;
}

export function mergeMissingNoteFolders(current: NoteFolder[], required: NoteFolder[]) {
  const knownIds = new Set(current.map((folder) => folder.id));
  const missing = required.filter((folder) => !knownIds.has(folder.id));
  return missing.length ? [...current, ...missing.map((folder) => ({ ...folder }))] : current;
}

function folderMap(folders: NoteFolder[]) {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

function inferLegacyNoteFolderId(note: CareerNote, folders: NoteFolder[]) {
  const byId = folderMap(folders);
  const code = noteCode(note);
  const parts = trainingCategoryParts(note.category);
  const categoryLeaf = parts.at(-1) || note.category;

  if (parts.length && normalizedName(categoryLeaf) === normalizedName('总账')
    && byId.has(interviewTrainingLedgerFolderId)) return interviewTrainingLedgerFolderId;
  if (code && byId.has(ledgerSectionFolderId(code))) return ledgerSectionFolderId(code);

  const preferredParent = parts.length ? interviewTrainingFolderId : preparationFolderId;
  const exact = folders.find((folder) => folder.parentId === preferredParent
    && normalizedName(folder.name) === normalizedName(categoryLeaf));
  if (exact) return exact.id;

  const loose = folders.find((folder) => normalizedName(folder.name) === normalizedName(categoryLeaf));
  return loose?.id || null;
}

export function resolveNoteFolderId(note: CareerNote, folders: NoteFolder[]) {
  const ids = new Set(folders.map((folder) => folder.id));
  if (note.folderId !== undefined) {
    if (note.folderId && ids.has(note.folderId)) return note.folderId;
    return ids.has(unfiledFolderId) ? unfiledFolderId : null;
  }
  return inferLegacyNoteFolderId(note, folders) || (ids.has(unfiledFolderId) ? unfiledFolderId : null);
}

export function migrateLegacyNoteFolders(notes: CareerNote[], folders: NoteFolder[]) {
  let changed = false;
  const migrated = notes.map((note) => {
    if (note.folderId !== undefined) return note;
    const folderId = inferLegacyNoteFolderId(note, folders);
    if (!folderId) return note;
    changed = true;
    return { ...note, folderId };
  });
  return changed ? migrated : notes;
}

function safeParentId(folder: NoteFolder, byId: Map<string, NoteFolder>) {
  if (!folder.parentId || !byId.has(folder.parentId) || folder.parentId === folder.id) return null;
  const seen = new Set([folder.id]);
  let cursor: NoteFolder | undefined = folder;
  while (cursor?.parentId) {
    if (seen.has(cursor.parentId)) return null;
    seen.add(cursor.parentId);
    cursor = byId.get(cursor.parentId);
    if (!cursor) return null;
  }
  return folder.parentId;
}

export function getNoteFolderPath(folderId: string | null | undefined, folders: NoteFolder[]) {
  if (!folderId) return [];
  const byId = folderMap(folders);
  const path: NoteFolder[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(folderId);
  while (cursor && !seen.has(cursor.id)) {
    path.unshift(cursor);
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path;
}

export function getNoteFolderPathLabel(folderId: string | null | undefined, folders: NoteFolder[]) {
  return getNoteFolderPath(folderId, folders).map((folder) => folder.name).join(' › ');
}

export function buildNoteFolderTree(
  folders: NoteFolder[],
  notes: CareerNote[],
  options: { includeEmptyFolders?: boolean } = {},
) {
  const uniqueFolders = [...new Map(folders.map((folder) => [folder.id, folder])).values()];
  const byId = folderMap(uniqueFolders);
  const childrenByParent = new Map<string | null, NoteFolder[]>();
  for (const folder of uniqueFolders) {
    const parentId = safeParentId(folder, byId);
    const siblings = childrenByParent.get(parentId) || [];
    siblings.push(folder);
    childrenByParent.set(parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => left.sortOrder - right.sortOrder || naturalCollator.compare(left.name, right.name));
  }

  const notesByFolder = new Map<string, CareerNote[]>();
  for (const note of notes) {
    const folderId = resolveNoteFolderId(note, uniqueFolders);
    if (!folderId) continue;
    const siblings = notesByFolder.get(folderId) || [];
    siblings.push(note);
    notesByFolder.set(folderId, siblings);
  }
  for (const siblings of notesByFolder.values()) {
    siblings.sort((left, right) => naturalCollator.compare(compactMarkdown(left.title), compactMarkdown(right.title)));
  }

  const build = (folder: NoteFolder, ancestors: Set<string>): NoteFolderTreeNode => {
    const nextAncestors = new Set(ancestors).add(folder.id);
    const children = (childrenByParent.get(folder.id) || [])
      .filter((child) => !nextAncestors.has(child.id))
      .map((child) => build(child, nextAncestors));
    const folderNotes = notesByFolder.get(folder.id) || [];
    const noteCount = folderNotes.length + children.reduce((total, child) => total + child.noteCount, 0);
    return { folder, children, notes: folderNotes, noteCount };
  };

  const roots = (childrenByParent.get(null) || []).map((folder) => build(folder, new Set()));
  if (options.includeEmptyFolders !== false) return roots;
  const prune = (node: NoteFolderTreeNode): NoteFolderTreeNode | null => {
    const children = node.children.map(prune).filter((child): child is NoteFolderTreeNode => child !== null);
    if (!node.notes.length && !children.length) return null;
    return { ...node, children, noteCount: node.notes.length + children.reduce((total, child) => total + child.noteCount, 0) };
  };
  return roots.map(prune).filter((node): node is NoteFolderTreeNode => node !== null);
}

export function validateNoteFolderPathInput(value: string): FolderPathValidation {
  const rawSegments = value.split(/\s*(?:>|›)\s*/u);
  const path = rawSegments.map((segment) => segment.trim());
  if (!path.length || path.every((segment) => !segment)) return { path: [], error: '文件夹路径不能为空' };
  if (path.some((segment) => !segment)) return { path: [], error: '层级之间不能有空文件夹名称' };
  if (path.length > maxFolderDepth) return { path: [], error: `文件夹最多支持 ${maxFolderDepth} 层` };
  if (path.some((segment) => segment.length > maxFolderNameLength)) {
    return { path: [], error: `单个文件夹名称不能超过 ${maxFolderNameLength} 个字符` };
  }
  if (path.some((segment) => segment === '.' || segment === '..')) return { path: [], error: '文件夹名称不能是 . 或 ..' };
  if (path.some((segment) => /[\u0000-\u001f\u007f>›]/u.test(segment))) {
    return { path: [], error: '文件夹名称不能包含控制字符、> 或 ›' };
  }
  return { path, error: '' };
}

export function ensureNoteFolderPath(
  path: string[],
  folders: NoteFolder[],
  createId: () => string,
) {
  const nextFolders = [...folders];
  let parentId: string | null = null;
  let folderId: string | null = null;
  for (const name of path) {
    const existing = findChildByName(nextFolders, parentId, name);
    if (existing) {
      folderId = existing.id;
      parentId = existing.id;
      continue;
    }
    const siblingOrders = nextFolders.filter((folder) => folder.parentId === parentId).map((folder) => folder.sortOrder);
    const folder: NoteFolder = {
      id: createId(),
      name,
      parentId,
      sortOrder: (siblingOrders.length ? Math.max(...siblingOrders) : 0) + 10,
    };
    nextFolders.push(folder);
    folderId = folder.id;
    parentId = folder.id;
  }
  return { folders: nextFolders, folderId };
}
