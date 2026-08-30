import { useEffect, useRef, useState } from 'react';
import { Link2, Trash2, X } from 'lucide-react';
import { getNextStepForStatus } from './JobBits';
import { PriorityPicker } from './PriorityPicker';
import { createEntityId } from '../lib/createEntityId';
import { appendJobStatusTransition, getJobStatusLabel, jobStatusOptions } from '../lib/jobStatus';
import { normalizeOptionalWebUrl } from '../lib/safeUrl';
import type { Job, JobLinkType, JobStatus, MaintenanceStatus, Priority, RecruitmentStatus } from '../types';

interface JobModalProps {
  open: boolean;
  job?: Job;
  stale?: boolean;
  onClose: () => void;
  onSubmit: (job: Job) => void;
  onDelete?: (job: Job) => void;
}

const editableJobFields: (keyof Job)[] = [
  'company', 'title', 'department', 'location', 'deadline', 'applicationStartDate', 'applicationEndDate',
  'dateSourceNote', 'url', 'companyUrl', 'referralUrl', 'referralCode', 'referralNote', 'source', 'evidenceUrl', 'jobCode',
  'linkType', 'priority', 'status', 'recruitmentStatus', 'maintenanceStatus', 'season', 'recruitmentNote', 'tags', 'notes',
];

const jobUrlFields = ['url', 'companyUrl', 'referralUrl', 'evidenceUrl'] as const;
type JobUrlField = typeof jobUrlFields[number];
const jobUrlValidationMessage = '链接必须为空，或使用 http:// / https:// 地址';

const jobSections = [
  { id: 'overview', label: '岗位概况', description: '公司、岗位与优先级' },
  { id: 'recruitment', label: '秋招口径', description: '开放状态与申请日期' },
  { id: 'application', label: '投递与内推', description: '岗位、官网与内推入口' },
  { id: 'evidence', label: '核验与备注', description: '来源、标签与准备建议' },
] as const;

type JobSectionId = typeof jobSections[number]['id'];

function formFromJob(job?: Job) {
  return {
    company: job?.company || '',
    title: job?.title || '',
    department: job?.department || '',
    location: job?.location || '',
    applicationStartDate: job?.applicationStartDate || '',
    applicationEndDate: job?.applicationEndDate || job?.deadline || '',
    dateSourceNote: job?.dateSourceNote || '',
    url: job?.url || '',
    companyUrl: job?.companyUrl || '',
    referralUrl: job?.referralUrl || '',
    referralCode: job?.referralCode || '',
    referralNote: job?.referralNote || '',
    source: job?.source || '',
    evidenceUrl: job?.evidenceUrl || '',
    jobCode: job?.jobCode || '',
    linkType: (job?.linkType || '具体岗位') as JobLinkType,
    priority: (job?.priority || 'A') as Priority,
    status: (job?.status || '收藏') as JobStatus,
    recruitmentStatus: (job?.recruitmentStatus || '待确认') as RecruitmentStatus,
    maintenanceStatus: (job?.maintenanceStatus || '自动维护') as MaintenanceStatus,
    season: job?.season || '2027 届秋招',
    recruitmentNote: job?.recruitmentNote || '',
    tags: job?.tags.join('，') || '',
    notes: job?.notes || '',
  };
}

export function JobModal({ open, job, stale = false, onClose, onSubmit, onDelete }: JobModalProps) {
  const [form, setForm] = useState(() => formFromJob(job));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [activeSection, setActiveSection] = useState<JobSectionId>('overview');
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<JobSectionId, HTMLElement | null>>>({});
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setForm(formFromJob(job));
      setConfirmingDelete(false);
      setActiveSection('overview');
    }
  }, [job, open]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmingDelete) {
        setConfirmingDelete(false);
        window.requestAnimationFrame(() => deleteTriggerRef.current?.focus());
      }
      else onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [confirmingDelete, onClose, open]);

  useEffect(() => {
    if (open && confirmingDelete) cancelDeleteRef.current?.focus();
  }, [confirmingDelete, open]);

  if (!open) return null;

  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const scrollToSection = (sectionId: JobSectionId) => {
    const container = bodyRef.current;
    const section = sectionRefs.current[sectionId];
    if (!container || !section) return;
    setActiveSection(sectionId);
    container.scrollTo({
      top: Math.max(0, section.offsetTop - 8),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  const syncActiveSection = () => {
    const container = bodyRef.current;
    if (!container) return;
    let nextSection: JobSectionId = 'overview';
    for (const section of jobSections) {
      const element = sectionRefs.current[section.id];
      if (element && element.offsetTop <= container.scrollTop + 90) nextSection = section.id;
    }
    setActiveSection(nextSection);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirmingDelete || stale) return;
    const company = form.company.trim();
    const title = form.title.trim();
    if (!company || !title) return;

    const normalizedUrls = {} as Record<JobUrlField, string>;
    const invalidUrlFields: JobUrlField[] = [];
    for (const field of jobUrlFields) {
      const normalizedUrl = normalizeOptionalWebUrl(form[field]);
      if (normalizedUrl === null) invalidUrlFields.push(field);
      else normalizedUrls[field] = normalizedUrl;
    }
    if (invalidUrlFields.length > 0) {
      for (const field of invalidUrlFields) {
        const input = event.currentTarget.elements.namedItem(field);
        if (input instanceof HTMLInputElement) input.setCustomValidity(jobUrlValidationMessage);
      }
      const firstInvalidInput = event.currentTarget.elements.namedItem(invalidUrlFields[0]);
      if (firstInvalidInput instanceof HTMLInputElement) firstInvalidInput.reportValidity();
      return;
    }

    const submittedAt = new Date().toISOString();
    const statusChanged = Boolean(job && job.status !== form.status);
    const nextJob: Job = {
      id: job?.id || createEntityId('job'),
      company,
      logo: job?.logo || company.slice(0, 2).toUpperCase(),
      logoTone: job?.logoTone || '#4c55d7',
      title,
      department: form.department.trim() || '待确认',
      location: form.location.trim() || '待确认',
      deadline: form.applicationEndDate,
      applicationStartDate: form.applicationStartDate,
      applicationEndDate: form.applicationEndDate,
      dateSourceNote: form.dateSourceNote.trim() || '日期未公布，待后续核验',
      url: normalizedUrls.url,
      companyUrl: normalizedUrls.companyUrl,
      referralUrl: normalizedUrls.referralUrl,
      referralCode: form.referralCode.trim(),
      referralNote: form.referralNote.trim(),
      evidenceUrl: normalizedUrls.evidenceUrl || normalizedUrls.url || normalizedUrls.referralUrl || normalizedUrls.companyUrl,
      jobCode: form.jobCode.trim(),
      linkType: normalizedUrls.url || normalizedUrls.referralUrl ? form.linkType : '暂无有效岗位',
      priority: form.priority,
      status: form.status,
      statusHistory: !job || statusChanged
        ? appendJobStatusTransition(job?.statusHistory, job?.status ?? null, form.status, submittedAt)
        : job.statusHistory,
      recruitmentStatus: form.recruitmentStatus,
      maintenanceStatus: form.maintenanceStatus,
      season: form.season.trim() || '2027 届秋招',
      recruitmentNote: form.recruitmentNote.trim() || '招聘状态待后续核验',
      type: job?.type || '校招 · 全职',
      source: form.source.trim() || '手动维护',
      nextStep: statusChanged || !job ? getNextStepForStatus(form.status) : job.nextStep,
      appliedAt: form.status === '收藏' ? undefined : statusChanged || !job ? job?.appliedAt || submittedAt.slice(0, 10) : job.appliedAt,
      tags: form.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      notes: form.notes.trim(),
      verifiedAt: job?.verifiedAt || submittedAt.slice(0, 10),
      userEditedAt: submittedAt,
    };
    if (job && (!job.userEditedAt || job.editedFields)) {
      const changedFields = editableJobFields.filter((field) => JSON.stringify(nextJob[field]) !== JSON.stringify(job[field]));
      nextJob.editedFields = [...new Set([...(job.editedFields || []), ...changedFields])];
    } else if (!job) {
      // A newly added target may later be verified and promoted into the
      // maintained catalog under the same id. Preserve explicitly personal
      // notes/referral data while allowing audited recruitment facts to update.
      nextJob.editedFields = ['notes', 'referralUrl', 'referralCode', 'referralNote']
        .filter((field) => Boolean(nextJob[field as keyof Job])) as (keyof Job)[];
    }
    onSubmit(nextJob);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="job-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="job-modal-title">
        <div className="modal-header">
          <div>
            <div className="eyebrow">{job ? 'EDIT JOB TARGET' : 'NEW JOB TARGET'}</div>
            <h2 id="job-modal-title">{job ? '编辑岗位信息' : '添加目标岗位'}</h2>
            <p>维护具体岗位、内推入口、投递起止日期和核验依据，未公布的信息保持空白。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭岗位弹窗"><X size={20} /></button>
        </div>

        <div className="job-modal__priority-bar">
          <div><strong>岗位优先级</strong><span>选择目标等级，随保存修改一起提交</span></div>
          <PriorityPicker
            value={form.priority}
            onChange={(priority) => update('priority', priority)}
            ariaLabel={`${form.company || '目标岗位'}优先级`}
            variant="form"
            disabled={stale || confirmingDelete}
          />
        </div>

        <div className="job-modal__workspace">
          <nav className="job-modal__nav" aria-label="岗位信息栏目快速导航">
            <div className="job-modal__nav-label">快速跳转</div>
            {jobSections.map((section, index) => (
              <button type="button" key={section.id} className={activeSection === section.id ? 'is-active' : ''} aria-current={activeSection === section.id ? 'location' : undefined} onClick={() => scrollToSection(section.id)}>
                <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{section.label}</strong><small>{section.description}</small></div>
              </button>
            ))}
          </nav>
          <div className="job-modal__body" ref={bodyRef} onScroll={syncActiveSection}>
            <section className="job-form-section" id="job-section-overview" ref={(element) => { sectionRefs.current.overview = element; }} aria-labelledby="job-section-overview-title">
              <div className="job-form-section__header"><span>01</span><div><h3 id="job-section-overview-title">岗位概况</h3><p>维护公司、岗位和当前投递优先级。</p></div></div>
              <div className="form-grid">
                <label><span>公司名称 *</span><input autoFocus value={form.company} onChange={(event) => update('company', event.target.value)} placeholder="例如：示例科技" required /></label>
                <label><span>具体岗位名称 *</span><input value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="例如：后端开发工程师" required /></label>
                <label><span>业务部门</span><input value={form.department} onChange={(event) => update('department', event.target.value)} placeholder="岗位所属部门" /></label>
                <label><span>工作地点</span><input value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="城市 / 远程" /></label>
                <label><span>投递状态</span><select value={form.status} onChange={(event) => update('status', event.target.value)}>{jobStatusOptions.map((status) => <option key={status} value={status}>{getJobStatusLabel(status)}</option>)}</select></label>
              </div>
            </section>

            <section className="job-form-section" id="job-section-recruitment" ref={(element) => { sectionRefs.current.recruitment = element; }} aria-labelledby="job-section-recruitment-title">
              <div className="job-form-section__header"><span>02</span><div><h3 id="job-section-recruitment-title">秋招口径</h3><p>记录开放范围、届次和申请起止依据。</p></div></div>
              <div className="form-grid">
                <label><span>招聘开放状态</span><select value={form.recruitmentStatus} onChange={(event) => update('recruitmentStatus', event.target.value)}><option>已开放</option><option>部分开放</option><option>待开放</option><option>待确认</option></select></label>
                <label><span>岗位信息维护</span><select value={form.maintenanceStatus} onChange={(event) => update('maintenanceStatus', event.target.value)}><option>自动维护</option><option>无需维护</option></select></label>
                <label><span>招聘批次</span><input value={form.season} onChange={(event) => update('season', event.target.value)} placeholder="2027 届秋招 / 提前批" /></label>
                <label><span>投递开始日期</span><input type="date" value={form.applicationStartDate} onChange={(event) => update('applicationStartDate', event.target.value)} /></label>
                <label><span>投递结束日期</span><input type="date" min={form.applicationStartDate || undefined} value={form.applicationEndDate} onChange={(event) => update('applicationEndDate', event.target.value)} /></label>
                <label className="form-grid__full"><span>日期依据 / 口径</span><input value={form.dateSourceNote} onChange={(event) => update('dateSourceNote', event.target.value)} placeholder="例如：官网仅公布启动日，结束日期未公布" /></label>
                <label><span>岗位链接类型</span><select value={form.linkType} onChange={(event) => update('linkType', event.target.value)}><option>具体岗位</option><option>第三方具体岗位</option><option>岗位精准筛选</option><option>岗位列表</option><option>暂无有效岗位</option></select></label>
                <label><span>岗位编号</span><input value={form.jobCode} onChange={(event) => update('jobCode', event.target.value)} placeholder="官网 Job ID（如有）" /></label>
              </div>
            </section>

            <section className="job-form-section" id="job-section-application" ref={(element) => { sectionRefs.current.application = element; }} aria-labelledby="job-section-application-title">
              <div className="job-form-section__header"><span>03</span><div><h3 id="job-section-application-title">投递与内推</h3><p>分别维护普通岗位入口、公司官网和内推信息。</p></div></div>
              <div className="form-grid">
                <label className="form-grid__full"><span>具体岗位详情 / 普通投递链接</span><div className="input-with-icon"><Link2 size={16} /><input name="url" type="url" value={form.url} onChange={(event) => { event.currentTarget.setCustomValidity(''); update('url', event.target.value); }} placeholder="已开放岗位填写具体岗位详情或申请页" /></div></label>
                <label className="form-grid__full"><span>公司 / 招聘官网</span><div className="input-with-icon"><Link2 size={16} /><input name="companyUrl" type="url" value={form.companyUrl} onChange={(event) => { event.currentTarget.setCustomValidity(''); update('companyUrl', event.target.value); }} placeholder="待开放时可保留官方招聘官网，不计作岗位投递入口" /></div></label>
                <label className="form-grid__full"><span>内推投递链接（填写后默认优先使用）</span><div className="input-with-icon"><Link2 size={16} /><input name="referralUrl" type="url" value={form.referralUrl} onChange={(event) => { event.currentTarget.setCustomValidity(''); update('referralUrl', event.target.value); }} placeholder="带 share_token、shareId 或推荐参数的投递入口" /></div></label>
                <label><span>内推码</span><input value={form.referralCode} onChange={(event) => update('referralCode', event.target.value)} placeholder="例如：ABC123" /></label>
                <label><span>信息来源说明</span><input value={form.source} onChange={(event) => update('source', event.target.value)} placeholder="官方岗位页 / 用户提供内推公告" /></label>
                <label className="form-grid__full"><span>内推说明</span><textarea value={form.referralNote} onChange={(event) => update('referralNote', event.target.value)} placeholder="推荐人、原始内推入口、流程提醒或使用注意事项" rows={2} /></label>
              </div>
            </section>

            <section className="job-form-section" id="job-section-evidence" ref={(element) => { sectionRefs.current.evidence = element; }} aria-labelledby="job-section-evidence-title">
              <div className="job-form-section__header"><span>04</span><div><h3 id="job-section-evidence-title">核验与备注</h3><p>保留证据、状态边界和岗位匹配提醒。</p></div></div>
              <div className="form-grid">
                <label className="form-grid__full"><span>核验来源链接</span><div className="input-with-icon"><Link2 size={16} /><input name="evidenceUrl" type="url" value={form.evidenceUrl} onChange={(event) => { event.currentTarget.setCustomValidity(''); update('evidenceUrl', event.target.value); }} placeholder="官方公告或高校就业网岗位公告" /></div></label>
                <label className="form-grid__full"><span>招聘状态说明</span><textarea value={form.recruitmentNote} onChange={(event) => update('recruitmentNote', event.target.value)} placeholder="说明当前开放范围、岗位是否有效以及待核验事项" rows={3} /></label>
                <label className="form-grid__full"><span>技术 / 能力标签</span><input value={form.tags} onChange={(event) => update('tags', event.target.value)} placeholder="Java，Go，分布式系统" /></label>
                <label className="form-grid__full"><span>备注</span><textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="岗位匹配点、简历调整建议、内推信息……" rows={3} /></label>
              </div>
            </section>
          </div>
        </div>
        {stale && (
          <div className="modal-stale-warning" role="alert">
            该岗位已在另一设备更新。当前草稿不会覆盖服务器；请复制需要保留的内容，取消后重新打开岗位。
          </div>
        )}
        <div className="modal-actions job-modal__actions">
          {job && onDelete && confirmingDelete ? (
            <>
              <div className="modal-actions__warning" role="alert"><strong>确认删除这个岗位？</strong><span>{job.company} · {job.title}。删除后刷新也不会重新出现；如需恢复，请导入删除前的全站备份。</span></div>
              <button type="button" className="button button--quiet" ref={cancelDeleteRef} onClick={() => { setConfirmingDelete(false); window.requestAnimationFrame(() => deleteTriggerRef.current?.focus()); }}>保留岗位</button>
              <button type="button" className="button button--danger" disabled={stale} onClick={() => onDelete(job)} aria-label={`确认删除 ${job.company} ${job.title}`}><Trash2 size={16} />确认删除</button>
            </>
          ) : (
            <>
              {job && onDelete && <button type="button" className="button button--danger modal-actions__delete" ref={deleteTriggerRef} disabled={stale} onClick={() => setConfirmingDelete(true)} aria-label={`删除 ${job.company} ${job.title}`}><Trash2 size={16} />删除岗位</button>}
              <button type="button" className="button button--quiet" onClick={onClose}>取消</button>
              <button type="submit" className="button button--primary" disabled={stale}>{stale ? '请重新打开' : job ? '保存修改' : '保存岗位'}</button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
