import { Database, Download, FileJson, FileText, Info, Plus, Save, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ResumeStorageStatus } from '../hooks/useResumeDocument';
import { createEntityId } from '../lib/createEntityId';
import { isJobStatusHistory, jobStatusOptions } from '../lib/jobStatus';
import { captureWorkspaceReplaceRevision, readCanonicalWorkspaceItems, replaceWorkspaceItems, WorkspaceReplaceError } from '../lib/workspaceSync';
import type { ExperienceCategory, ResumeDocument, ResumeExperience, ResumeProfile } from '../types';

interface ResumeViewProps {
  document: ResumeDocument;
  storageStatus: ResumeStorageStatus;
  onChange: (document: ResumeDocument) => void;
}

interface WorkspaceBackup {
  kind: 'autumn-compass-workspace-backup';
  schemaVersion: 1;
  origin: string;
  exportedAt: string;
  localStorage: Record<string, string>;
}

const maxWorkspaceBackupBytes = 32 * 1024 * 1024;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasStringFields(value: Record<string, unknown>, fields: readonly string[]) {
  return fields.every((field) => typeof value[field] === 'string');
}

function hasOptionalStringFields(value: Record<string, unknown>, fields: readonly string[]) {
  return fields.every((field) => value[field] === undefined || typeof value[field] === 'string');
}

function hasUniqueStringIds(values: unknown[]) {
  const ids = values.map((value) => isPlainRecord(value) ? value.id : undefined);
  return ids.every(isNonEmptyString) && new Set(ids).size === ids.length;
}

const jobStatuses = new Set<string>(jobStatusOptions);
const jobPriorities = new Set(['S', 'A', 'B']);
const recruitmentStatuses = new Set(['已开放', '部分开放', '待开放', '待确认']);
const maintenanceStatuses = new Set(['自动维护', '无需维护']);
const jobLinkTypes = new Set(['具体岗位', '第三方具体岗位', '岗位精准筛选', '岗位列表', '暂无有效岗位']);
const requiredJobStringFields = [
  'id', 'company', 'logo', 'logoTone', 'title', 'department', 'location', 'type',
  'status', 'priority', 'deadline', 'url', 'source', 'recruitmentStatus', 'season',
  'verifiedAt', 'recruitmentNote', 'evidenceUrl',
] as const;
const optionalJobStringFields = [
  'appliedAt', 'nextStep', 'companyUrl', 'referralUrl', 'referralCode', 'referralNote',
  'notes', 'applicationStartDate', 'applicationEndDate', 'dateSourceNote', 'jobCode',
  'linkType', 'userEditedAt',
  'maintenanceStatus',
] as const;
const resumeProfileStringFields = [
  'fullName', 'gender', 'phone', 'email', 'birthday', 'city', 'currentCity', 'idNumber',
  'school', 'major', 'degree', 'graduationYear', 'targetRole', 'researchFocus',
  'undergraduateSchool', 'undergraduateMajor', 'graduatePeriod', 'undergraduatePeriod',
  'honors', 'skills', 'expectedSalary', 'availableDate', 'workAuthorization', 'linkedin',
  'github', 'website', 'summary',
] as const;
const resumeExperienceStringFields = [
  'id', 'title', 'organization', 'role', 'startDate', 'endDate', 'location', 'link',
  'technologies', 'summary',
] as const;

function validateKnownWorkspaceValue(key: string, value: string) {
  if (/^autumn-compass-jobs-2027-v\d+$/u.test(key)) {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !hasUniqueStringIds(parsed) || !parsed.every((job) => isPlainRecord(job)
      && isNonEmptyString(job.id)
      && isNonEmptyString(job.company)
      && isNonEmptyString(job.title)
      && hasStringFields(job, requiredJobStringFields)
      && hasOptionalStringFields(job, optionalJobStringFields)
      && jobStatuses.has(job.status as string)
      && jobPriorities.has(job.priority as string)
      && recruitmentStatuses.has(job.recruitmentStatus as string)
      && (job.maintenanceStatus === undefined || maintenanceStatuses.has(job.maintenanceStatus as string))
      && (job.linkType === undefined || jobLinkTypes.has(job.linkType as string))
      && (job.statusHistory === undefined || isJobStatusHistory(job.statusHistory))
      && Array.isArray(job.tags)
      && job.tags.every((tag) => typeof tag === 'string')
      && (job.editedFields === undefined
        || (Array.isArray(job.editedFields) && job.editedFields.every((field) => typeof field === 'string'))))) {
      throw new Error(`invalid jobs entry: ${key}`);
    }
    return;
  }
  if (key === 'autumn-compass-deleted-job-ids-2027-v1'
    || key === 'autumn-compass-deleted-job-fingerprints-2027-v1') {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
      throw new Error('invalid deleted job id entry');
    }
    return;
  }
  if (key === 'autumn-compass-interviews-v2') {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !hasUniqueStringIds(parsed) || !parsed.every((interview) => isPlainRecord(interview)
      && isNonEmptyString(interview.id)
      && isNonEmptyString(interview.company)
      && isNonEmptyString(interview.title)
      && typeof interview.logo === 'string'
      && typeof interview.logoTone === 'string'
      && typeof interview.round === 'string'
      && typeof interview.date === 'string'
      && typeof interview.time === 'string'
      && (interview.endTime === undefined || typeof interview.endTime === 'string')
      && typeof interview.mode === 'string'
      && (interview.interviewer === undefined || typeof interview.interviewer === 'string')
      && (interview.notes === undefined || typeof interview.notes === 'string')
      && Array.isArray(interview.checklist)
      && hasUniqueStringIds(interview.checklist)
      && interview.checklist.every((item) => isPlainRecord(item)
        && isNonEmptyString(item.id)
        && typeof item.text === 'string'
        && typeof item.done === 'boolean'))) {
      throw new Error('invalid interviews entry');
    }
    return;
  }
  if (key === 'autumn-compass-notes-v2-embodied') {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !hasUniqueStringIds(parsed) || !parsed.every((note) => isPlainRecord(note)
      && isNonEmptyString(note.id)
      && typeof note.title === 'string'
      && typeof note.category === 'string'
      && typeof note.content === 'string'
      && (note.folderId === undefined || note.folderId === null || isNonEmptyString(note.folderId)))) {
      throw new Error('invalid notes entry');
    }
    return;
  }
  if (key === 'autumn-compass-note-folders-v1') {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !hasUniqueStringIds(parsed) || !parsed.every((folder) => isPlainRecord(folder)
      && isNonEmptyString(folder.id)
      && isNonEmptyString(folder.name)
      && (folder.parentId === null || isNonEmptyString(folder.parentId))
      && Number.isFinite(folder.sortOrder))) {
      throw new Error('invalid note folders entry');
    }
    const folders = parsed as Array<Record<string, unknown>>;
    const byId = new Map(folders.map((folder) => [folder.id as string, folder]));
    const siblingNames = new Set<string>();
    for (const folder of folders) {
      const id = folder.id as string;
      const parentId = folder.parentId as string | null;
      if (parentId !== null && !byId.has(parentId)) throw new Error('orphan note folder entry');
      const siblingKey = `${parentId || ''}\u0000${String(folder.name).trim().toLocaleLowerCase('zh-CN')}`;
      if (siblingNames.has(siblingKey)) throw new Error('duplicate sibling note folder entry');
      siblingNames.add(siblingKey);
      const seen = new Set([id]);
      let cursor = parentId;
      while (cursor !== null) {
        if (seen.has(cursor)) throw new Error('cyclic note folder entry');
        seen.add(cursor);
        const parent = byId.get(cursor);
        if (!parent) throw new Error('orphan note folder entry');
        cursor = parent.parentId as string | null;
      }
    }
    return;
  }
  if (key === 'autumn-compass-resume-document-v4' || key === 'autumn-compass-resume-document-v3') {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainRecord(parsed)
      || typeof parsed.version !== 'number'
      || typeof parsed.updatedAt !== 'string'
      || !isPlainRecord(parsed.profile)
      || !hasStringFields(parsed.profile, resumeProfileStringFields)
      || !Array.isArray(parsed.experiences)
      || !hasUniqueStringIds(parsed.experiences)) {
      throw new Error(`invalid resume document entry: ${key}`);
    }
    if (!parsed.experiences.every((experience) => isPlainRecord(experience)
      && isNonEmptyString(experience.id)
      && hasStringFields(experience, resumeExperienceStringFields)
      && ['internship', 'research', 'project'].includes(String(experience.category))
      && typeof experience.current === 'boolean'
      && Array.isArray(experience.highlights)
      && experience.highlights.every((highlight) => typeof highlight === 'string'))) {
      throw new Error(`invalid resume experiences entry: ${key}`);
    }
    return;
  }
  if (key === 'autumn-compass-profile-v2') {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainRecord(parsed) || !Object.values(parsed).every((field) => typeof field === 'string')) {
      throw new Error('invalid legacy profile entry');
    }
  }
}

const personalFields: { key: keyof ResumeProfile; label: string; placeholder?: string; type?: string }[] = [
  { key: 'fullName', label: '姓名' }, { key: 'gender', label: '性别' }, { key: 'phone', label: '手机号', type: 'tel' },
  { key: 'email', label: '邮箱', type: 'email' }, { key: 'birthday', label: '出生日期', type: 'date' }, { key: 'city', label: '期望城市' },
  { key: 'currentCity', label: '现居城市' }, { key: 'idNumber', label: '身份证号', placeholder: '敏感信息，可留空' },
];

const educationFields: { key: keyof ResumeProfile; label: string }[] = [
  { key: 'school', label: '学校' }, { key: 'major', label: '专业' }, { key: 'degree', label: '最高学历' }, { key: 'graduationYear', label: '毕业年份' },
  { key: 'undergraduateSchool', label: '本科院校' }, { key: 'undergraduateMajor', label: '本科专业' },
  { key: 'graduatePeriod', label: '硕士就读时间' }, { key: 'undergraduatePeriod', label: '本科就读时间' },
];

const linkFields: { key: keyof ResumeProfile; label: string }[] = [
  { key: 'github', label: 'GitHub' }, { key: 'linkedin', label: 'LinkedIn' }, { key: 'website', label: '个人网站 / 作品集' },
];

const experienceSections: { category: ExperienceCategory; number: string; title: string; description: string }[] = [
  { category: 'internship', number: '04', title: '实习经历', description: '公司、岗位、职责与可验证结果' },
  { category: 'research', number: '05', title: '科研经历', description: '研究问题、方法、论文与实验结果' },
  { category: 'project', number: '06', title: '项目经历', description: '工程链路、技术指标与个人贡献' },
];

function createExperience(category: ExperienceCategory): ResumeExperience {
  return {
    id: createEntityId('experience'),
    category,
    title: '',
    organization: '',
    role: '',
    startDate: '',
    endDate: '',
    current: false,
    location: '',
    link: '',
    technologies: '',
    summary: '',
    highlights: [''],
  };
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resumeExportBaseName(profile: ResumeProfile) {
  const safeName = profile.fullName
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return safeName ? `${safeName}-resume` : 'autumn-compass-resume';
}

async function createWorkspaceBackup(): Promise<WorkspaceBackup> {
  return {
    kind: 'autumn-compass-workspace-backup',
    schemaVersion: 1,
    origin: window.location.origin,
    exportedAt: new Date().toISOString(),
    localStorage: await readCanonicalWorkspaceItems(),
  };
}

function toMarkdown(document: ResumeDocument) {
  const { profile } = document;
  const lines = [
    `# ${profile.fullName}`,
    '',
    profile.targetRole,
    '',
    `${profile.currentCity || profile.city}｜${profile.phone}｜${profile.email}｜${profile.github}`,
    '',
    '## 教育经历',
    '',
    `**${profile.school}｜${profile.major}｜${profile.degree}**　${profile.graduatePeriod}`,
    '',
    `**${profile.undergraduateSchool}｜${profile.undergraduateMajor}｜本科**　${profile.undergraduatePeriod}`,
    '',
    profile.honors,
    '',
  ];
  for (const section of experienceSections) {
    lines.push(`## ${section.title}`, '');
    for (const item of document.experiences.filter((experience) => experience.category === section.category)) {
      const period = [item.startDate, item.current ? '至今' : item.endDate].filter(Boolean).join('–');
      lines.push(`### ${item.title}`, '', `**${item.organization}｜${item.role}**　${period}`, '');
      if (item.link) lines.push(`链接：${item.link}`, '');
      if (item.technologies) lines.push(`技术：${item.technologies}`, '');
      if (item.summary) lines.push(item.summary, '');
      item.highlights.filter(Boolean).forEach((highlight) => lines.push(`- ${highlight}`));
      lines.push('');
    }
  }
  lines.push('## 专业技能', '', profile.skills, '', '## 个人简介', '', profile.summary, '');
  return lines.join('\n');
}

export function ResumeView({ document, storageStatus, onChange }: ResumeViewProps) {
  const [message, setMessage] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const workspaceImportInput = useRef<HTMLInputElement>(null);
  const profile = document.profile;
  const exportBaseName = resumeExportBaseName(profile);

  const updateProfile = (key: keyof ResumeProfile, value: string) => onChange({ ...document, profile: { ...profile, [key]: value } });
  const updateExperience = (id: string, changes: Partial<ResumeExperience>) => onChange({
    ...document,
    experiences: document.experiences.map((experience) => experience.id === id ? { ...experience, ...changes } : experience),
  });
  const addExperience = (category: ExperienceCategory) => onChange({ ...document, experiences: [...document.experiences, createExperience(category)] });
  const removeExperience = (experience: ResumeExperience) => {
    if (!window.confirm(`确认删除“${experience.title || '未命名经历'}”？`)) return;
    onChange({ ...document, experiences: document.experiences.filter((item) => item.id !== experience.id) });
  };
  const downloadWorkspaceBackup = async () => {
    try {
      const backup = await createWorkspaceBackup();
      const date = new Date().toISOString().slice(0, 10);
      downloadFile(`autumn-compass-workspace-${date}.json`, JSON.stringify(backup, null, 2), 'application/json');
      setMessage('已从服务器导出最新全站备份');
    } catch {
      setMessage('服务器工作区读取失败，未生成可能过期的本地备份');
    }
    window.setTimeout(() => setMessage(''), 2600);
  };
  const importBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as ResumeDocument;
      if (!parsed.profile || !Array.isArray(parsed.experiences)) throw new Error('invalid backup');
      onChange({ ...parsed, version: 4, profile: { ...document.profile, ...parsed.profile } });
      setMessage('简历备份已载入，正在保存到服务器');
    } catch {
      setMessage('备份格式无法识别');
    }
    event.target.value = '';
    window.setTimeout(() => setMessage(''), 2200);
  };
  const importWorkspaceBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > maxWorkspaceBackupBytes) throw new Error('workspace backup is too large');
      const parsed = JSON.parse(await file.text()) as Partial<WorkspaceBackup>;
      if (parsed.kind !== 'autumn-compass-workspace-backup'
        || parsed.schemaVersion !== 1
        || !isPlainRecord(parsed.localStorage)) {
        throw new Error('invalid workspace backup');
      }
      const entries = Object.entries(parsed.localStorage);
      if (!entries.length) throw new Error('empty workspace backup');
      if (!entries.every(([key, value]) => key.startsWith('autumn-compass-') && typeof value === 'string')) {
        throw new Error('invalid workspace entry');
      }
      entries.forEach(([key, value]) => validateKnownWorkspaceValue(key, value as string));
      const confirmedRevision = captureWorkspaceReplaceRevision();
      if (!window.confirm(`将用备份完整替换服务器工作区，并同步影响所有已连接设备（导入 ${entries.length} 项），是否继续？`)) return;
      await replaceWorkspaceItems(Object.fromEntries(entries), { baseRevision: confirmedRevision });
      setMessage('全站备份已原子写入服务器，当前页面已同步更新');
      window.setTimeout(() => setMessage(''), 2600);
    } catch (error) {
      setMessage(error instanceof WorkspaceReplaceError && error.serverUpdated
        ? '服务器已完成恢复，但本机缓存刷新失败；请重新载入页面读取服务器数据'
        : error instanceof WorkspaceReplaceError && error.outcomeUnknown
          ? '恢复请求结果暂时未知；请重新连接并核对服务器数据，不要立即重复导入'
        : '备份格式无效或服务器写入失败，服务器工作区未替换');
      window.setTimeout(() => setMessage(''), 2600);
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="view resume-view">
      <section className="page-intro page-intro--compact">
        <div><div className="eyebrow">RESUME DATABASE</div><h1>简历资料库</h1><p>统一维护基础资料、实习、科研和项目经历；服务器保存主数据，本机保留快速缓存与恢复副本。</p></div>
        <div className="resume-actions">
          <input ref={importInput} type="file" hidden accept="application/json,.json" onChange={importBackup} />
          <input ref={workspaceImportInput} type="file" hidden accept="application/json,.json" onChange={importWorkspaceBackup} />
          <button type="button" className="button button--quiet" onClick={() => workspaceImportInput.current?.click()}><Upload size={16} />恢复全站</button>
          <button type="button" className="button button--quiet" onClick={() => void downloadWorkspaceBackup()}><Download size={16} />全站备份</button>
          <button type="button" className="button button--quiet" onClick={() => importInput.current?.click()}><Upload size={16} />恢复简历</button>
          <button type="button" className="button button--quiet" onClick={() => downloadFile(`${exportBaseName}.json`, JSON.stringify(document, null, 2), 'application/json')}><Download size={16} />简历备份</button>
          <button type="button" className="button button--quiet" onClick={() => downloadFile(`${exportBaseName}.md`, toMarkdown(document), 'text/markdown;charset=utf-8')}><FileText size={16} />导出 Markdown</button>
          <button type="button" className="button button--primary" onClick={() => downloadFile('autumn-compass-profile.json', JSON.stringify(profile, null, 2), 'application/json')}><FileJson size={16} />导出插件 JSON</button>
        </div>
      </section>
      <div className={`privacy-note ${storageStatus === 'error' ? 'privacy-note--error' : ''}`}>
        {storageStatus === 'error' ? <Info size={19} /> : <ShieldCheck size={19} />}
        <div><strong>{storageStatus === 'loading' ? '正在保存到服务器' : storageStatus === 'saved' ? '服务器主数据与本机副本已同步' : '服务器或本机副本保存失败，请检查全局同步状态'}</strong><span>“全站备份”从服务器导出岗位状态、面试、笔记与简历；浏览器缓存用于快速读取，简历另存 IndexedDB 恢复副本。</span></div>
      </div>
      {message && <div className="resume-message">{message}</div>}

      <section className="resume-overview">
        <article className="resume-database-card">
          <Database size={24} />
          <div className="eyebrow">SERVER + LOCAL COPY</div>
          <h3>服务器主存储</h3>
          <p>SQLite 统一同步各设备；浏览器缓存加速读取，IndexedDB 保留简历结构化副本。</p>
          <div><span>{document.experiences.filter((item) => item.category === 'internship').length}<small>实习</small></span><span>{document.experiences.filter((item) => item.category === 'research').length}<small>科研</small></span><span>{document.experiences.filter((item) => item.category === 'project').length}<small>项目</small></span></div>
        </article>
        <article className="plugin-guide panel"><FileJson size={20} /><h3>备份与插件数据</h3><ol><li>“全站备份”从服务器导出岗位、面试、笔记与简历</li><li>“恢复全站”先原子写入服务器，再即时更新页面</li><li>“简历备份”只保存简历资料库</li><li>“导出插件 JSON”生成填表文件</li></ol><div className="inline-note"><Info size={15} />全站备份含个人信息，只存放在可信设备。</div></article>
      </section>

      <section className="resume-layout">
        <div className="resume-forms">
          <article className="profile-section panel">
            <div className="profile-section__header"><div><span>01</span><div><h2>基本信息</h2><p>只维护已确认信息，敏感字段可留空</p></div></div><Save size={17} /></div>
            <div className="profile-field-grid">{personalFields.map((field) => <label key={field.key}><span>{field.label}</span><input type={field.type || 'text'} value={profile[field.key]} onChange={(event) => updateProfile(field.key, event.target.value)} placeholder={field.placeholder} /></label>)}</div>
          </article>

          <article className="profile-section panel">
            <div className="profile-section__header"><div><span>02</span><div><h2>教育与求职</h2><p>学历、目标岗位和求职偏好</p></div></div><Save size={17} /></div>
            <div className="profile-field-grid">{educationFields.map((field) => <label key={field.key}><span>{field.label}</span><input value={profile[field.key]} onChange={(event) => updateProfile(field.key, event.target.value)} /></label>)}<label className="profile-field-grid__wide"><span>奖项与证书</span><input value={profile.honors} onChange={(event) => updateProfile('honors', event.target.value)} /></label><label className="profile-field-grid__wide"><span>目标岗位</span><input value={profile.targetRole} onChange={(event) => updateProfile('targetRole', event.target.value)} /></label><label><span>期望薪资</span><input value={profile.expectedSalary} onChange={(event) => updateProfile('expectedSalary', event.target.value)} /></label><label><span>可到岗日期</span><input type="date" value={profile.availableDate} onChange={(event) => updateProfile('availableDate', event.target.value)} /></label><label className="profile-field-grid__wide"><span>工作许可 / 身份</span><input value={profile.workAuthorization} onChange={(event) => updateProfile('workAuthorization', event.target.value)} /></label></div>
          </article>

          <article className="profile-section panel">
            <div className="profile-section__header"><div><span>03</span><div><h2>能力、链接与简介</h2><p>研究方向、技术栈与代码作品</p></div></div><Save size={17} /></div>
            <div className="profile-field-grid">{linkFields.map((field) => <label key={field.key}><span>{field.label}</span><input type="url" value={profile[field.key]} onChange={(event) => updateProfile(field.key, event.target.value)} placeholder="https://" /></label>)}<label className="profile-field-grid__wide"><span>研究方向</span><textarea rows={3} value={profile.researchFocus} onChange={(event) => updateProfile('researchFocus', event.target.value)} /></label><label className="profile-field-grid__wide"><span>专业技能</span><textarea rows={4} value={profile.skills} onChange={(event) => updateProfile('skills', event.target.value)} /></label><label className="profile-field-grid__wide"><span>个人简介</span><textarea rows={5} value={profile.summary} onChange={(event) => updateProfile('summary', event.target.value)} /></label></div>
          </article>

          {experienceSections.map((section) => (
            <article className="profile-section panel experience-section" key={section.category}>
              <div className="profile-section__header">
                <div><span>{section.number}</span><div><h2>{section.title}</h2><p>{section.description}</p></div></div>
                <button type="button" className="button button--quiet button--small" onClick={() => addExperience(section.category)}><Plus size={14} />添加</button>
              </div>
              <div className="experience-editor-list">
                {document.experiences.filter((experience) => experience.category === section.category).map((experience) => (
                  <div className="experience-editor" key={experience.id}>
                    <div className="experience-editor__top"><strong>{experience.title || '未命名经历'}</strong><button type="button" onClick={() => removeExperience(experience)} aria-label="删除经历"><Trash2 size={15} /></button></div>
                    <div className="experience-field-grid">
                      <label className="experience-field-grid__wide"><span>经历标题</span><input value={experience.title} onChange={(event) => updateExperience(experience.id, { title: event.target.value })} /></label>
                      <label><span>单位 / 组织</span><input value={experience.organization} onChange={(event) => updateExperience(experience.id, { organization: event.target.value })} /></label>
                      <label><span>角色 / 职位</span><input value={experience.role} onChange={(event) => updateExperience(experience.id, { role: event.target.value })} /></label>
                      <label><span>开始月份</span><input type="month" value={experience.startDate} onChange={(event) => updateExperience(experience.id, { startDate: event.target.value })} /></label>
                      <label><span>结束月份</span><input type="month" value={experience.endDate} disabled={experience.current} onChange={(event) => updateExperience(experience.id, { endDate: event.target.value })} /></label>
                      <label><span>地点</span><input value={experience.location} onChange={(event) => updateExperience(experience.id, { location: event.target.value })} /></label>
                      <label className="current-check"><input type="checkbox" checked={experience.current} onChange={(event) => updateExperience(experience.id, { current: event.target.checked })} /><span>仍在职 / 持续中</span></label>
                      <label className="experience-field-grid__wide"><span>项目 / 代码链接</span><input type="url" value={experience.link} onChange={(event) => updateExperience(experience.id, { link: event.target.value })} placeholder="https://" /></label>
                      <label className="experience-field-grid__wide"><span>技术栈</span><input value={experience.technologies} onChange={(event) => updateExperience(experience.id, { technologies: event.target.value })} /></label>
                      <label className="experience-field-grid__wide"><span>经历概述</span><textarea rows={3} value={experience.summary} onChange={(event) => updateExperience(experience.id, { summary: event.target.value })} /></label>
                      <label className="experience-field-grid__wide"><span>成果要点（每行一条）</span><textarea rows={6} value={experience.highlights.join('\n')} onChange={(event) => updateExperience(experience.id, { highlights: event.target.value.split('\n') })} /></label>
                    </div>
                  </div>
                ))}
                {!document.experiences.some((experience) => experience.category === section.category) && <div className="experience-empty">尚未添加{section.title}</div>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
