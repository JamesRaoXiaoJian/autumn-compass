import { BriefcaseBusiness, Grid2X2, List, MapPin, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CompanyLogo, hasActionableJobLink, JobActionLinks, MaintenancePill, RecruitmentPill } from '../components/JobBits';
import { PriorityPicker } from '../components/PriorityPicker';
import { sortJobsForDisplay } from '../lib/jobSort';
import { getJobStatusLabel, jobStatusOptions } from '../lib/jobStatus';
import type { Job, JobStatus, MaintenanceStatus, Priority, RecruitmentStatus } from '../types';

interface JobsViewProps {
  jobs: Job[];
  search: string;
  onSearch: (value: string) => void;
  onAddJob: () => void;
  onEditJob: (job: Job) => void;
  onDeleteJob: (job: Job) => void;
  onStatusChange: (id: string, status: JobStatus) => void;
  onPriorityChange: (id: string, priority: Priority) => void;
}

const statuses: ('全部' | JobStatus)[] = ['全部', ...jobStatusOptions];
const recruitmentStatuses: ('全部开放状态' | RecruitmentStatus)[] = ['全部开放状态', '已开放', '部分开放', '待开放', '待确认'];
const maintenanceStatuses: ('全部维护状态' | MaintenanceStatus)[] = ['全部维护状态', '自动维护', '无需维护'];

function getLinkState(job: Job) {
  if (hasActionableJobLink(job)) return 'exact';
  if (job.companyUrl) return 'portal';
  return 'missing';
}

export function JobsView({ jobs, search, onSearch, onAddJob, onEditJob, onDeleteJob, onStatusChange, onPriorityChange }: JobsViewProps) {
  const [filter, setFilter] = useState<(typeof statuses)[number]>('全部');
  const [recruitmentFilter, setRecruitmentFilter] = useState<(typeof recruitmentStatuses)[number]>('全部开放状态');
  const [maintenanceFilter, setMaintenanceFilter] = useState<(typeof maintenanceStatuses)[number]>('全部维护状态');
  const [preferredLayout, setPreferredLayout] = useState<'table' | 'cards'>('cards');
  const [isCompactViewport, setIsCompactViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1380px)').matches);
  const [pendingDelete, setPendingDelete] = useState<Job>();
  const layout = isCompactViewport ? 'cards' : preferredLayout;

  useEffect(() => {
    const viewport = window.matchMedia('(max-width: 1380px)');
    const handleViewportChange = (event: MediaQueryListEvent) => setIsCompactViewport(event.matches);
    setIsCompactViewport(viewport.matches);
    viewport.addEventListener('change', handleViewportChange);
    return () => viewport.removeEventListener('change', handleViewportChange);
  }, []);

  useEffect(() => {
    if (!pendingDelete) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingDelete(undefined);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [pendingDelete]);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    onDeleteJob(pendingDelete);
    setPendingDelete(undefined);
  };

  const filtered = useMemo(() => sortJobsForDisplay(jobs.filter((job) => {
    const matchesStatus = filter === '全部' || job.status === filter;
    const matchesRecruitment = recruitmentFilter === '全部开放状态' || job.recruitmentStatus === recruitmentFilter;
    const matchesMaintenance = maintenanceFilter === '全部维护状态' || job.maintenanceStatus === maintenanceFilter;
    const haystack = `${job.company} ${job.title} ${job.location} ${job.tags.join(' ')} ${job.recruitmentNote} ${job.jobCode || ''} ${job.referralCode || ''} ${job.referralNote || ''}`.toLowerCase();
    return matchesStatus && matchesRecruitment && matchesMaintenance && haystack.includes(search.toLowerCase());
  })), [filter, jobs, maintenanceFilter, recruitmentFilter, search]);

  return (
    <div className="view jobs-view">
      <section className="page-intro page-intro--compact">
        <div><div className="eyebrow">2027 CAMPUS RECRUITMENT</div><h1>目标公司与具体岗位</h1><p>维护岗位级投递链接、起止日期和核验依据；未公布的信息保持空白，后续可直接编辑。</p></div>
        <button type="button" className="button button--primary" onClick={onAddJob}><Plus size={17} />添加岗位</button>
      </section>

      <section className="jobs-toolbar">
        <div className="status-tabs">
          {statuses.map((status) => <button type="button" key={status} className={filter === status ? 'is-active' : ''} onClick={() => setFilter(status)}>{status === '全部' ? status : getJobStatusLabel(status)}<span>{status === '全部' ? jobs.length : jobs.filter((job) => job.status === status).length}</span></button>)}
        </div>
        <div className="toolbar-actions">
          <select className="recruitment-filter" value={recruitmentFilter} onChange={(event) => setRecruitmentFilter(event.target.value as (typeof recruitmentStatuses)[number])} aria-label="筛选秋招开放状态">
            {recruitmentStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
          <select className="recruitment-filter" value={maintenanceFilter} onChange={(event) => setMaintenanceFilter(event.target.value as (typeof maintenanceStatuses)[number])} aria-label="筛选岗位维护状态">
            {maintenanceStatuses.map((status) => <option key={status}>{status}</option>)}
          </select>
          <label className="table-search"><Search size={16} /><input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="搜索岗位" /></label>
          <div className="view-switch">
            <button type="button" className={layout === 'table' ? 'is-active' : ''} onClick={() => setPreferredLayout('table')} disabled={isCompactViewport} aria-label="切换到表格视图" title={isCompactViewport ? '窄屏下自动使用卡片视图' : '切换到表格视图'}><List size={16} /></button>
            <button type="button" className={layout === 'cards' ? 'is-active' : ''} onClick={() => setPreferredLayout('cards')} aria-label="切换到卡片视图" title="切换到卡片视图"><Grid2X2 size={15} /></button>
          </div>
        </div>
      </section>

      {layout === 'table' ? (
        <section className="jobs-table-wrap panel">
          <table className="jobs-table">
            <thead><tr><th>公司 / 具体岗位</th><th>优先级</th><th>秋招状态</th><th>投递状态</th><th>投递起止</th><th>下一步</th><th /></tr></thead>
            <tbody>
              {filtered.map((job) => (
                <tr key={job.id}>
                  <td><div className="job-company-cell"><CompanyLogo company={job.company} text={job.logo} tone={job.logoTone} /><div><strong>{job.company}</strong><span>{job.title} · {job.department}</span><small><MapPin size={12} />{job.location} · {job.type}</small></div></div></td>
                  <td><PriorityPicker value={job.priority} onChange={(priority) => onPriorityChange(job.id, priority)} ariaLabel={`${job.company} ${job.title} 优先级`} /></td>
                  <td><div className="recruitment-cell"><div className="recruitment-cell__pills"><RecruitmentPill status={job.recruitmentStatus} /><MaintenancePill status={job.maintenanceStatus} /></div><small title={job.recruitmentNote}>{job.season}</small></div></td>
                  <td><select className="job-status-select" value={job.status} onChange={(e) => onStatusChange(job.id, e.target.value as JobStatus)} aria-label={`修改 ${job.company} 的投递状态`}>{jobStatusOptions.map((status) => <option key={status} value={status}>{getJobStatusLabel(status)}</option>)}</select></td>
                  <td><div className="application-window" title={job.dateSourceNote || '日期未公布'}><span>开始 {job.applicationStartDate || '未公布'}</span><small>结束 {job.applicationEndDate || '未公布'}</small><em>{job.dateSourceNote || '日期依据待核验'}</em></div></td>
                  <td><span className="next-step-cell">{job.nextStep || '待安排'}</span></td>
                  <td><div className="job-row-actions"><JobActionLinks job={job} /><button type="button" className="icon-button compact icon-button--danger" onClick={() => setPendingDelete(job)} aria-label={`删除 ${job.company} ${job.title}`} title="删除岗位"><Trash2 size={13} /></button><button type="button" className="icon-button compact" onClick={() => onEditJob(job)} aria-label={`编辑 ${job.company} 岗位`} title="编辑岗位"><Pencil size={13} /></button></div><small className={`link-type link-type--${getLinkState(job)}`} title={job.referralNote}>{hasActionableJobLink(job) && job.referralUrl ? `${job.referralCode ? `内推码 ${job.referralCode} · ` : '内推链接 · '}${job.linkType || '待核验'}` : job.linkType || '待核验'}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <div className="empty-state"><BriefcaseBusiness size={26} /><h3>没有找到匹配岗位</h3><p>换个关键词或清除筛选条件试试。</p></div>}
        </section>
      ) : (
        <section className="job-card-grid">
          {filtered.map((job) => (
            <article className="job-card" key={job.id}>
              <div className="job-card__head"><CompanyLogo company={job.company} text={job.logo} tone={job.logoTone} size="large" /><div><MaintenancePill status={job.maintenanceStatus} /><RecruitmentPill status={job.recruitmentStatus} /><PriorityPicker value={job.priority} onChange={(priority) => onPriorityChange(job.id, priority)} ariaLabel={`${job.company} ${job.title} 优先级`} /></div></div>
              <h3>{job.title}</h3><p>{job.company} · {job.department}</p>
              <div className="job-card__meta"><span><MapPin size={14} />{job.location}</span><span>{job.applicationStartDate || '开始未公布'} → {job.applicationEndDate || '结束未公布'}</span></div>
              <small className="date-source">{job.dateSourceNote || '日期依据待核验'}</small>
              <div className="tag-list">{job.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <p className="recruitment-note">{job.recruitmentNote}</p>
              {hasActionableJobLink(job) && job.referralUrl && <p className="referral-note" title={job.referralNote}><strong>内推</strong>{job.referralCode ? `内推码 ${job.referralCode} · ` : ''}{job.referralNote || '已绑定岗位级内推入口'}</p>}
              <label className="job-card__status">投递阶段<select className="job-status-select" value={job.status} onChange={(e) => onStatusChange(job.id, e.target.value as JobStatus)} aria-label={`修改 ${job.company} 的投递状态`}>{jobStatusOptions.map((status) => <option key={status} value={status}>{getJobStatusLabel(status)}</option>)}</select></label>
              <div className="job-card__footer"><small>{job.nextStep}</small><div className="job-row-actions"><button type="button" className="icon-button compact icon-button--danger" onClick={() => setPendingDelete(job)} aria-label={`删除 ${job.company} ${job.title}`} title="删除岗位"><Trash2 size={13} /></button><button type="button" className="icon-button compact" onClick={() => onEditJob(job)} aria-label={`编辑 ${job.company} 岗位`} title="编辑岗位"><Pencil size={13} /></button><JobActionLinks job={job} /></div></div>
            </article>
          ))}
          {!filtered.length && <div className="empty-state job-card-grid__empty"><BriefcaseBusiness size={26} /><h3>没有找到匹配岗位</h3><p>换个关键词或清除筛选条件试试。</p></div>}
        </section>
      )}
      {pendingDelete && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPendingDelete(undefined)}>
          <section className="job-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="job-delete-title" aria-describedby="job-delete-description job-delete-warning">
            <div className="job-delete-dialog__icon"><Trash2 size={21} aria-hidden="true" /></div>
            <div className="eyebrow">REMOVE JOB TARGET</div>
            <h2 id="job-delete-title">删除这个岗位？</h2>
            <p id="job-delete-description"><strong>{pendingDelete.company}</strong> · {pendingDelete.title}</p>
            <small id="job-delete-warning">删除后刷新也不会重新出现；如需恢复，请导入删除前的全站备份。</small>
            <div className="modal-actions">
              <button type="button" className="button button--quiet" autoFocus onClick={() => setPendingDelete(undefined)}>保留岗位</button>
              <button type="button" className="button button--danger" onClick={confirmDelete}><Trash2 size={16} />确认删除</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
