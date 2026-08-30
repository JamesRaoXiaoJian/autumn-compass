import { ArrowRight, CalendarClock, Plus, Radar, Sparkles, Target, Zap } from 'lucide-react';
import { CompanyLogo, hasActionableJobLink, RecruitmentPill } from '../components/JobBits';
import type { Interview, Job, ViewKey } from '../types';

interface DashboardProps {
  jobs: Job[];
  interviews: Interview[];
  onAddJob: () => void;
  onNavigate: (view: ViewKey) => void;
}

export function Dashboard({ jobs, interviews, onAddJob, onNavigate }: DashboardProps) {
  const openJobs = jobs.filter((job) => job.recruitmentStatus === '已开放');
  const partialOpenJobs = jobs.filter((job) => job.recruitmentStatus === '部分开放');
  const priorityJobs = jobs.filter((job) => job.priority === 'S');
  const openCompanies = new Set(openJobs.map((job) => job.company));
  const partialOpenCompanies = new Set(partialOpenJobs.filter((job) => !openCompanies.has(job.company)).map((job) => job.company));
  const priorityCompanies = new Set(priorityJobs.map((job) => job.company));
  const openPriorityCompanies = new Set(priorityJobs
    .filter((job) => job.recruitmentStatus === '已开放' && hasActionableJobLink(job))
    .map((job) => job.company));
  const readyJobs = jobs.filter(
    (job) => job.status === '收藏'
      && ['已开放', '部分开放'].includes(job.recruitmentStatus)
      && hasActionableJobLink(job),
  );
  const readyPriorityJobs = readyJobs.filter((job) => job.priority === 'S');
  const priorityRank = { S: 0, A: 1, B: 2 } as const;
  const recruitmentRank = { 已开放: 0, 部分开放: 1, 待开放: 2, 待确认: 3 } as const;
  const priorityTargets = [...jobs]
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]
      || recruitmentRank[a.recruitmentStatus] - recruitmentRank[b.recruitmentStatus])
    .filter((job, index, sorted) => sorted.findIndex((item) => item.company === job.company) === index)
    .slice(0, 4);
  const upcomingInterviews = [...interviews]
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
    .slice(0, 3);
  const suggestedCompanies = [...new Set(readyPriorityJobs.map((job) => job.company))].slice(0, 3);

  const stats = [
    { label: '已开放公司', value: openCompanies.size, delta: `另有 ${partialOpenCompanies.size} 家部分开放`, icon: Radar, tone: 'green' },
    { label: 'S 级目标', value: priorityCompanies.size, delta: `${openPriorityCompanies.size} 家已有正式入口`, icon: Target, tone: 'indigo' },
    { label: '可立即投递', value: readyJobs.length, delta: '开放且已有具体岗位链接', icon: Zap, tone: 'blue' },
    { label: '面试安排', value: interviews.length, delta: interviews.length ? '查看时间与准备事项' : '可在日历中添加安排', icon: CalendarClock, tone: 'orange' },
  ];

  return (
    <div className="view dashboard-view">
      <section className="page-intro page-intro--dashboard">
        <div>
          <div className="eyebrow">RECRUITMENT WORKSPACE</div>
          <h1>从岗位匹配出发，<br /><em>把准备落到证据。</em></h1>
          <p>聚焦后端开发、分布式系统、数据库与云原生工程，优先处理已开放且高度匹配的岗位。</p>
        </div>
        <button type="button" className="button button--primary button--large" onClick={onAddJob}><Plus size={18} />添加岗位</button>
      </section>

      <section className="stats-grid">
        {stats.map(({ label, value, delta, icon: Icon, tone }) => (
          <article className="stat-card" key={label}>
            <div className={`stat-card__icon stat-card__icon--${tone}`}><Icon size={19} /></div>
            <div className="stat-card__value">{String(value).padStart(2, '0')}</div>
            <div className="stat-card__label">{label}</div>
            <div className="stat-card__delta">{delta}</div>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel panel--applications">
          <div className="panel__header">
            <div><div className="eyebrow">PRIORITY TARGETS</div><h2>优先目标公司</h2></div>
            <button type="button" className="text-button" onClick={() => onNavigate('jobs')}>全部岗位 <ArrowRight size={15} /></button>
          </div>
          <div className="application-list">
            {priorityTargets.map((job) => (
              <div className="application-row" key={job.id}>
                <CompanyLogo company={job.company} text={job.logo} tone={job.logoTone} />
                <div className="application-row__main">
                  <strong>{job.company}</strong>
                  <span>{job.priority} 级 · {job.title} · {job.location}</span>
                </div>
                <div className="application-row__next">
                  <span>岗位方向</span>
                  <strong>{job.department || job.tags.slice(0, 2).join(' · ')}</strong>
                </div>
                <RecruitmentPill status={job.recruitmentStatus} />
              </div>
            ))}
            {!priorityTargets.length && <div className="agenda-empty"><Target size={22} /><span>尚未添加目标公司</span><small>添加公司后将按优先级展示</small></div>}
          </div>
        </article>

        <article className="panel agenda-panel">
          <div className="panel__header">
            <div><div className="eyebrow">UP NEXT</div><h2>近期安排</h2></div>
            <button type="button" className="icon-button compact" onClick={() => onNavigate('interviews')}><ArrowRight size={17} /></button>
          </div>
          <div className="agenda-list">
            {upcomingInterviews.map((item) => (
              <div className="agenda-item" key={item.id}>
                <div className="agenda-item__date"><strong>{item.date.slice(8)}</strong><span>{item.date.slice(5, 7)}月</span></div>
                <div className="agenda-item__line"><i /></div>
                <div className="agenda-item__content"><span>{item.time}{item.endTime ? `–${item.endTime}` : ' · 结束待补充'}</span><strong>{item.company} · {item.round}</strong><small>{item.mode}</small></div>
              </div>
            ))}
            {!interviews.length && <div className="agenda-empty"><CalendarClock size={22} /><span>暂无面试安排</span><small>在面试日历中添加后会显示在这里</small></div>}
          </div>
        </article>

        <article className="focus-card">
          <div className="focus-card__top"><div className="focus-card__spark"><Sparkles size={19} /></div><span>岗位匹配地图</span><span className="focus-card__count">S / A 级优先</span></div>
          <h3>用项目证据对应岗位关键词</h3>
          <p>把岗位要求拆成语言基础、数据存储、系统设计与工程质量，再从简历资料库选择最直接的项目证据。</p>
          <div className="focus-tasks">
            <span><ArrowRight size={14} />语言基础：Java / Go、并发与网络</span>
            <span><ArrowRight size={14} />数据存储：索引、事务、缓存与消息队列</span>
            <span><ArrowRight size={14} />系统设计：高可用、一致性与容量规划</span>
            <span><ArrowRight size={14} />工程实践：测试、监控、排障与性能优化</span>
          </div>
        </article>

        <article className="panel insight-panel">
          <div className="eyebrow">NEXT ACTION</div>
          <div className="insight-panel__content">
            <Target size={42} color="#4c55d7" strokeWidth={1.5} />
            <div>
              <h3>{suggestedCompanies.length ? `优先查看 ${suggestedCompanies.join('、')}` : '先核验高优先级岗位入口'}</h3>
              <p>{readyPriorityJobs.length ? '这些 S 级岗位已有可用入口，按岗位关键词调整项目顺序和自我介绍。' : '关注待开放公司的校招入口，同时完善后端项目的性能指标与故障复盘证据。'}</p>
              <button type="button" className="text-button" onClick={() => onNavigate('jobs')}>查看目标岗位 <ArrowRight size={14} /></button>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
