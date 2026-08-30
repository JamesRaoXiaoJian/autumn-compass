import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

const rawSource = await readFile(new URL('../src/lib/noteTree.ts', import.meta.url), 'utf8');
const source = rawSource.replace(
  "import { preparationFolderId, unfiledFolderId } from '../data/noteDefaults';",
  "const preparationFolderId = 'note-folder-preparation'; const unfiledFolderId = 'note-folder-unfiled';",
);
const { code } = await transformWithOxc(source, 'noteTree.ts');
const noteTree = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const neutralFolders = [
  { id: 'note-folder-preparation', name: '求职准备', parentId: null, sortOrder: 100 },
  { id: 'note-folder-unfiled', name: '未归档', parentId: null, sortOrder: 1000 },
];

test('first-run folders are derived from the private ledger without changing the note array shape', () => {
  const notes = [
    {
      id: 'ledger',
      title: '面试训练目录',
      category: '面试训练·总账',
      content: `| 编号范围 | 分类 | 必答主题 |
| --- | --- | --- |
| A001–A010 | 个人与岗位 | 自我介绍 |
| C001–C022 | Attention / Transformer | QKV |`,
    },
    { id: 'a001', title: 'A001｜自我介绍', category: '面试训练·个人与岗位', content: '' },
    { id: 'review', title: '一次复盘', category: '复盘记录', content: '' },
  ];

  const folders = noteTree.createInitialNoteFolders(notes, neutralFolders);
  assert.equal(folders.find((folder) => folder.id === noteTree.interviewTrainingFolderId)?.name, '面试训练');
  assert.equal(folders.find((folder) => folder.id === noteTree.ledgerSectionFolderId('A'))?.name, 'A 个人与岗位');
  assert.equal(folders.find((folder) => folder.id === noteTree.ledgerSectionFolderId('C'))?.name, 'C Attention / Transformer');
  assert.ok(folders.some((folder) => folder.parentId === 'note-folder-preparation' && folder.name === '复盘记录'));

  const migrated = noteTree.migrateLegacyNoteFolders(notes, folders);
  assert.equal(migrated.find((note) => note.id === 'ledger').folderId, noteTree.interviewTrainingLedgerFolderId);
  assert.equal(migrated.find((note) => note.id === 'a001').folderId, noteTree.ledgerSectionFolderId('A'));
  assert.deepEqual(Object.keys(migrated[0]).sort(), ['category', 'content', 'folderId', 'id', 'title']);
});

test('tree keeps empty folders and naturally sorts files by numbered title', () => {
  const folders = [
    ...neutralFolders,
    { id: 'training', name: '面试训练', parentId: null, sortOrder: 10 },
    { id: 'attention', name: 'C Attention', parentId: 'training', sortOrder: 30 },
    { id: 'empty', name: 'D LLM', parentId: 'training', sortOrder: 40 },
  ];
  const notes = [
    { id: 'c010', title: 'C010｜Mask', category: '', content: '', folderId: 'attention' },
    { id: 'c002', title: 'C002｜MHA', category: '', content: '', folderId: 'attention' },
  ];
  const roots = noteTree.buildNoteFolderTree(folders, notes);
  const training = roots.find((node) => node.folder.id === 'training');
  assert.deepEqual(training.children.map((node) => node.folder.id), ['attention', 'empty']);
  assert.deepEqual(training.children[0].notes.map((note) => note.id), ['c002', 'c010']);
  assert.equal(training.noteCount, 2);

  const searchTree = noteTree.buildNoteFolderTree(folders, [notes[1]], { includeEmptyFolders: false });
  const searchTraining = searchTree.find((node) => node.folder.id === 'training');
  assert.deepEqual(searchTraining.children.map((node) => node.folder.id), ['attention']);
});

test('orphaned, cyclic, and invalid note references remain reachable', () => {
  const folders = [
    ...neutralFolders,
    { id: 'orphan', name: '孤立目录', parentId: 'missing', sortOrder: 1 },
    { id: 'cycle-a', name: '循环 A', parentId: 'cycle-b', sortOrder: 2 },
    { id: 'cycle-b', name: '循环 B', parentId: 'cycle-a', sortOrder: 3 },
  ];
  const notes = [{ id: 'lost', title: '不会丢失', category: '', content: '', folderId: 'missing' }];
  const roots = noteTree.buildNoteFolderTree(folders, notes);
  assert.ok(roots.some((node) => node.folder.id === 'orphan'));
  assert.ok(roots.some((node) => node.folder.id === 'cycle-a'));
  assert.ok(roots.some((node) => node.folder.id === 'cycle-b'));
  assert.deepEqual(roots.find((node) => node.folder.id === 'note-folder-unfiled').notes.map((note) => note.id), ['lost']);
});

test('editable paths support arbitrary nesting and preserve slash inside folder names', () => {
  const validation = noteTree.validateNoteFolderPathInput('面试训练 > C Attention / Transformer > KV cache');
  assert.equal(validation.error, '');
  assert.deepEqual(validation.path, ['面试训练', 'C Attention / Transformer', 'KV cache']);

  let sequence = 0;
  const ensured = noteTree.ensureNoteFolderPath(validation.path, neutralFolders, () => `custom-${++sequence}`);
  assert.equal(ensured.folderId, 'custom-3');
  assert.deepEqual(
    noteTree.getNoteFolderPath(ensured.folderId, ensured.folders).map((folder) => folder.name),
    validation.path,
  );
  assert.match(noteTree.validateNoteFolderPathInput('a > > b').error, /空文件夹/u);
});
