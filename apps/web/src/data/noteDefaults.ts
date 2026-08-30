export interface CareerNote {
  id: string;
  title: string;
  category: string;
  content: string;
  folderId?: string | null;
}

export interface NoteFolder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
}

export const noteFoldersStorageKey = 'autumn-compass-note-folders-v1';
export const preparationFolderId = 'note-folder-preparation';
export const unfiledFolderId = 'note-folder-unfiled';

// Keep source defaults neutral. A private workspace that already contains an
// interview-training ledger derives its additional folders once, in-browser,
// and saves those folder entities back to the authoritative server workspace.
export const initialNoteFolders: NoteFolder[] = [
  { id: preparationFolderId, name: '求职准备', parentId: null, sortOrder: 100 },
  { id: 'note-folder-application-strategy', name: '投递策略', parentId: preparationFolderId, sortOrder: 10 },
  { id: 'note-folder-project-evidence', name: '项目表达', parentId: preparationFolderId, sortOrder: 20 },
  { id: 'note-folder-interview-review', name: '面试复盘', parentId: preparationFolderId, sortOrder: 30 },
  { id: unfiledFolderId, name: '未归档', parentId: null, sortOrder: 1000 },
];

// These neutral starters are used only by a brand-new workspace. Existing
// server notes are loaded before the application renders and remain unchanged.
export const initialNotes: CareerNote[] = [
  {
    id: 'starter-role-fit',
    title: '岗位匹配清单',
    category: '投递策略',
    folderId: 'note-folder-application-strategy',
    content: `岗位最看重的三项能力：
• 能力一：
• 能力二：
• 能力三：

简历中可直接对应的证据：
• 项目 / 结果：

仍需核验的问题：
• 招聘届别、工作地点与截止时间
• 投递入口是否为具体岗位页`,
  },
  {
    id: 'starter-project-evidence',
    title: '项目证据卡',
    category: '项目表达',
    folderId: 'note-folder-project-evidence',
    content: `一句话问题定义：

我的职责与关键决策：

可复核的结果：

证据边界与失败案例：

与目标岗位的连接：`,
  },
  {
    id: 'starter-interview-review',
    title: '面试复盘模板',
    category: '面试复盘',
    folderId: 'note-folder-interview-review',
    content: `公司 / 岗位 / 轮次：

被问到的问题：

回答得好的部分：

需要补充的知识或证据：

下一次要调整的表达：`,
  },
];
