import { ArrowRight, ChevronLeft, ChevronRight, Flame, GripVertical, PencilLine, RadioTower } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { CompanyLogo, ExternalLink, getJobApplicationUrl, hasActionableJobLink } from '../components/JobBits';
import { PriorityPicker } from '../components/PriorityPicker';
import { sortJobsForDisplay } from '../lib/jobSort';
import {
  formatJobStatusChangeDate,
  formatJobStatusChangeFullDate,
  getCurrentJobStatusChange,
  getJobStatusLabel,
  jobStatusOptions,
} from '../lib/jobStatus';
import type { Job, JobStatus, Priority } from '../types';

const columnPresentation: Record<JobStatus, { tone: string }> = {
  '收藏': { tone: '#8a8d98' },
  '已投递': { tone: '#5c67d9' },
  '笔试': { tone: '#a366d6' },
  '面试': { tone: '#e08335' },
  Offer: { tone: '#2f9b70' },
  '已结束': { tone: '#8b6b70' },
};

const columns = jobStatusOptions.map((status) => ({ status, ...columnPresentation[status] }));

interface PipelineViewProps {
  jobs: Job[];
  onStatusChange: (id: string, status: JobStatus) => void;
  onPriorityChange: (id: string, priority: Priority) => void;
  onEditJob: (job: Job) => void;
}

interface MoveState {
  jobId: string;
  targetStatus: JobStatus;
  mode: 'pointer' | 'keyboard';
}

interface CompanyIndexProps {
  items: Job[];
  label: string;
  onReveal: (job: Job) => void;
}

function CompanyIndex({ items, label, onReveal }: CompanyIndexProps) {
  const indexRef = useRef<HTMLElement>(null);
  const [scrollState, setScrollState] = useState({ previous: false, next: false });
  const itemIdentity = items.map((job) => `${job.company}:${job.id}`).join('|');

  const updateScrollState = useCallback(() => {
    const index = indexRef.current;
    if (!index) return;
    const maximum = Math.max(0, index.scrollWidth - index.clientWidth);
    const nextState = {
      previous: index.scrollLeft > 1,
      next: index.scrollLeft < maximum - 1,
    };
    setScrollState((current) => (
      current.previous === nextState.previous && current.next === nextState.next ? current : nextState
    ));
  }, []);

  const handleWheel = useCallback((event: WheelEvent) => {
    const index = indexRef.current;
    if (!index) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const maximum = Math.max(0, index.scrollWidth - index.clientWidth);
    const canConsume = (delta < 0 && index.scrollLeft > 1)
      || (delta > 0 && index.scrollLeft < maximum - 1);
    if (!delta || !canConsume) return;
    event.preventDefault();
    event.stopPropagation();
    index.scrollBy({ left: delta, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const index = indexRef.current;
    if (!index) return undefined;
    const frame = window.requestAnimationFrame(updateScrollState);
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(index);
    index.addEventListener('scroll', updateScrollState, { passive: true });
    index.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      index.removeEventListener('scroll', updateScrollState);
      index.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel, itemIdentity, updateScrollState]);

  const scrollByPage = (direction: -1 | 1) => {
    const index = indexRef.current;
    if (!index) return;
    index.scrollBy({
      left: direction * Math.max(132, Math.floor(index.clientWidth * 0.72)),
      behavior: 'smooth',
    });
  };

  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    const index = event.currentTarget;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End') {
      index.scrollTo({ left: event.key === 'Home' ? 0 : index.scrollWidth, behavior: 'smooth' });
      return;
    }
    scrollByPage(event.key === 'ArrowLeft' ? -1 : 1);
  };

  const revealIndexItem = (button: HTMLButtonElement) => {
    const index = indexRef.current;
    if (!index) return;
    const indexBounds = index.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    if (buttonBounds.left < indexBounds.left) {
      index.scrollBy({ left: buttonBounds.left - indexBounds.left - 4, behavior: 'smooth' });
    } else if (buttonBounds.right > indexBounds.right) {
      index.scrollBy({ left: buttonBounds.right - indexBounds.right + 4, behavior: 'smooth' });
    }
  };

  return (
    <div className="kanban-company-nav">
      <button
        type="button"
        className="kanban-company-nav__control"
        onClick={() => scrollByPage(-1)}
        disabled={!scrollState.previous}
        aria-label={`向前浏览${label}栏公司`}
        title="向前浏览公司"
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <nav
        ref={indexRef}
        className="kanban-company-index"
        aria-label={`${label}栏公司快速跳转`}
        tabIndex={0}
        onKeyDown={handleKeys}
      >
        {items.map((job) => (
          <button
            type="button"
            key={job.company}
            onClick={() => onReveal(job)}
            onFocus={(event) => revealIndexItem(event.currentTarget)}
            title={`跳转到 ${job.company}`}
            aria-label={`跳转到${job.company}`}
          >
            <CompanyLogo company={job.company} text={job.logo} tone={job.logoTone} size="micro" />
          </button>
        ))}
      </nav>
      <button
        type="button"
        className="kanban-company-nav__control"
        onClick={() => scrollByPage(1)}
        disabled={!scrollState.next}
        aria-label={`向后浏览${label}栏公司`}
        title="向后浏览公司"
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function PipelineView({ jobs, onStatusChange, onPriorityChange, onEditJob }: PipelineViewProps) {
  const [moveState, setMoveState] = useState<MoveState>();
  const [highlightedJobId, setHighlightedJobId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const columnBodyRefs = useRef(new Map<JobStatus, HTMLDivElement>());
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const highlightTimerRef = useRef<number | undefined>(undefined);
  const orderedJobs = useMemo(() => sortJobsForDisplay(jobs), [jobs]);
  const activeJobs = jobs.filter((job) => job.status !== '已结束');
  const openTargets = activeJobs.filter((job) => ['已开放', '部分开放'].includes(job.recruitmentStatus)
    && hasActionableJobLink(job)).length;
  const priorityTargets = new Set(activeJobs.filter((job) => job.priority === 'S').map((job) => job.company)).size;

  const completeMove = (jobId: string, status: JobStatus) => {
    const job = jobs.find((item) => item.id === jobId);
    const statusLabel = getJobStatusLabel(status);
    setMoveState(undefined);
    if (!job) return;
    if (job.status === status) {
      setAnnouncement(`${job.company} 仍在${statusLabel}`);
      return;
    }
    onStatusChange(jobId, status);
    setAnnouncement(`${job.company} 已移动到${statusLabel}`);
  };

  const changePriority = (job: Job, priority: Priority) => {
    if (job.priority === priority) return;
    onPriorityChange(job.id, priority);
    setAnnouncement(`${job.company} ${job.title} 的优先级已调整为 ${priority} 级`);
  };

  const startPointerMove = (event: DragEvent<HTMLElement>, job: Job) => {
    if ((event.target as HTMLElement).closest('a, button, input, select, textarea')) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', job.id);
    setMoveState({ jobId: job.id, targetStatus: job.status, mode: 'pointer' });
    setAnnouncement(`正在移动${job.company}`);
  };

  const dropIntoColumn = (event: DragEvent<HTMLElement>, status: JobStatus) => {
    event.preventDefault();
    event.stopPropagation();
    const jobId = event.dataTransfer.getData('text/plain') || moveState?.jobId;
    if (jobId) completeMove(jobId, status);
  };

  useEffect(() => () => {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
  }, []);

  const revealCompany = (job: Job) => {
    const container = columnBodyRefs.current.get(job.status);
    const card = cardRefs.current.get(job.id);
    if (!container || !card) return;
    const containerBounds = container.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    const targetTop = container.scrollTop + cardBounds.top - containerBounds.top - 12;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    setHighlightedJobId(job.id);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedJobId(undefined), 1600);
    setAnnouncement(`已跳转到${getJobStatusLabel(job.status)}栏中的${job.company}`);
  };

  const toggleKeyboardMove = (job: Job) => {
    if (moveState?.mode === 'keyboard' && moveState.jobId === job.id) {
      completeMove(job.id, moveState.targetStatus);
      return;
    }
    setMoveState({ jobId: job.id, targetStatus: job.status, mode: 'keyboard' });
    setAnnouncement(`已拿起${job.company}，使用左右方向键选择阶段，按回车放下`);
  };

  const handleMoveKeys = (event: KeyboardEvent<HTMLButtonElement>, job: Job) => {
    if (moveState?.mode !== 'keyboard' || moveState.jobId !== job.id) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setMoveState(undefined);
      setAnnouncement(`已取消移动${job.company}`);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      completeMove(job.id, moveState.targetStatus);
      return;
    }

    const currentIndex = columns.findIndex((column) => column.status === moveState.targetStatus);
    const nextIndex = event.key === 'ArrowLeft'
      ? Math.max(0, currentIndex - 1)
      : event.key === 'ArrowRight'
        ? Math.min(columns.length - 1, currentIndex + 1)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? columns.length - 1
            : currentIndex;
    if (nextIndex === currentIndex || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const targetStatus = columns[nextIndex].status;
    setMoveState({ ...moveState, targetStatus });
    setAnnouncement(`目标阶段：${getJobStatusLabel(targetStatus)}`);
  };

  return (
    <div className="view pipeline-view">
      <section className="page-intro page-intro--compact">
        <div><div className="eyebrow">APPLICATION PIPELINE</div><h1>投递看板</h1><p>各阶段独立滚动；拖动卡片调整流程，点开详情维护岗位。</p></div>
        <div className="pipeline-summary"><div><RadioTower size={18} /><span>可立即投递</span><strong>{openTargets}</strong></div><i /><div><Flame size={18} /><span>S 级目标</span><strong>{priorityTargets}</strong></div></div>
      </section>
      <div className={`kanban-board-shell ${moveState ? 'is-moving' : ''}`}>
        {moveState && (
          <nav className="kanban-move-targets" aria-label="选择岗位移动目标阶段">
            {columns.map((column) => {
              const count = jobs.filter((job) => job.status === column.status).length;
              const isTarget = moveState.targetStatus === column.status;
              const label = getJobStatusLabel(column.status);
              return (
                <button
                  type="button"
                  className={`${isTarget ? 'is-target' : ''} ${column.status === '已结束' ? 'is-terminal' : ''}`}
                  key={column.status}
                  onClick={() => completeMove(moveState.jobId, column.status)}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    if (moveState.mode === 'pointer') setMoveState({ ...moveState, targetStatus: column.status });
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => dropIntoColumn(event, column.status)}
                  aria-label={`将岗位移动到${label}`}
                >
                  <i style={{ background: column.tone }} aria-hidden="true" />
                  <span>{label}</span>
                  <strong>{count}</strong>
                </button>
              );
            })}
          </nav>
        )}
        <section className="kanban-board" aria-label="岗位投递阶段看板" aria-describedby="kanban-instructions">
          {columns.map((column, columnIndex) => {
            const stageItems = orderedJobs.filter((job) => job.status === column.status);
            const companyItems = Array.from(stageItems.reduce((companies, job) => {
              if (!companies.has(job.company)) companies.set(job.company, job);
              return companies;
            }, new Map<string, Job>()).values());
            const items = stageItems;
            const nextStatus = columns[columnIndex + 1]?.status;
            const isTarget = moveState?.targetStatus === column.status;
            const label = getJobStatusLabel(column.status);
            return (
              <div
                className={`kanban-column ${items.length ? 'has-items' : 'is-empty'} ${isTarget ? 'is-move-target' : ''} ${column.status === '已结束' ? 'is-terminal' : ''}`}
                key={column.status}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (moveState?.mode === 'pointer') setMoveState({ ...moveState, targetStatus: column.status });
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => dropIntoColumn(event, column.status)}
              >
                <div className="kanban-column__header">
                  <div className="kanban-column__title"><i style={{ background: column.tone }} /><strong>{label}</strong><span>{items.length}</span></div>
                  {companyItems.length > 0 && (
                    <CompanyIndex
                      items={companyItems}
                      label={label}
                      onReveal={revealCompany}
                    />
                  )}
                </div>
                <div className="kanban-column__workspace">
                  <div
                    className="kanban-column__body"
                    ref={(element) => {
                      if (element) columnBodyRefs.current.set(column.status, element);
                      else columnBodyRefs.current.delete(column.status);
                    }}
                  >
                    {items.map((job) => {
                      const isMoving = moveState?.jobId === job.id;
                      const isKeyboardMoving = isMoving && moveState.mode === 'keyboard';
                      const hasApplicationLink = hasActionableJobLink(job);
                      const hasReferenceLink = Boolean(job.companyUrl);
                      const externalUrl = hasApplicationLink ? getJobApplicationUrl(job) : job.companyUrl || '';
                      const externalLabel = hasApplicationLink ? (job.referralUrl ? '内推投递' : '岗位投递') : '招聘官网';
                      const statusChange = getCurrentJobStatusChange(job);
                      const statusChangeDate = statusChange
                        ? formatJobStatusChangeDate(statusChange.changedAt)
                        : '';
                      const statusChangeFullDate = statusChange
                        ? formatJobStatusChangeFullDate(statusChange.changedAt)
                        : '';
                      return (
                        <article
                          className={`kanban-card ${isMoving ? 'is-moving' : ''} ${highlightedJobId === job.id ? 'is-company-highlighted' : ''}`}
                          key={job.id}
                          ref={(element) => {
                            if (element) cardRefs.current.set(job.id, element);
                            else cardRefs.current.delete(job.id);
                          }}
                          draggable
                          onDragStart={(event) => startPointerMove(event, job)}
                          onDragEnd={() => setMoveState(undefined)}
                        >
                          <div className="kanban-card__top">
                            <CompanyLogo company={job.company} text={job.logo} tone={job.logoTone} size="small" />
                            {statusChange && statusChangeDate && (
                              <time
                                className="kanban-card__status-date"
                                dateTime={statusChange.changedAt}
                                title={`${statusChangeFullDate}进入${getJobStatusLabel(job.status)}`}
                                aria-label={`${statusChangeFullDate}进入${getJobStatusLabel(job.status)}`}
                              >
                                {statusChangeDate}
                              </time>
                            )}
                            <PriorityPicker
                              value={job.priority}
                              onChange={(priority) => changePriority(job, priority)}
                              ariaLabel={`${job.company} ${job.title} 优先级`}
                              disabled={Boolean(moveState)}
                            />
                            <button
                              type="button"
                              className="kanban-drag-handle"
                              draggable={false}
                              aria-label={isKeyboardMoving ? `放下 ${job.company}` : `使用键盘移动 ${job.company}`}
                              aria-pressed={isKeyboardMoving}
                              title="拖动卡片；或点击后用左右方向键选择阶段"
                              onClick={() => toggleKeyboardMove(job)}
                              onKeyDown={(event) => handleMoveKeys(event, job)}
                              onDragStart={(event) => event.preventDefault()}
                            >
                              <GripVertical size={17} />
                            </button>
                          </div>
                          <h3>{job.company}</h3><p>{job.title}</p>
                          <div className="tag-list compact">{job.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div>
                          <div className={`kanban-card__actions ${hasApplicationLink ? 'is-actionable' : hasReferenceLink ? 'is-reference' : 'is-details-only'}`}>
                            {externalUrl && <ExternalLink url={externalUrl} label={externalLabel} ariaLabel={`${externalLabel}：${job.company} ${job.title}（新窗口）`} />}
                            <button type="button" className="kanban-card__details" draggable={false} onClick={() => onEditJob(job)} aria-label={`打开 ${job.company} ${job.title} 的岗位详情维护面板`}><PencilLine size={14} aria-hidden="true" />岗位详情</button>
                          </div>
                        </article>
                      );
                    })}
                    {!items.length && !isTarget && <div className="kanban-empty">暂无岗位</div>}
                    {moveState && (isTarget || moveState.mode === 'keyboard') && (
                      <button
                        type="button"
                        className="kanban-drop-hint"
                        onClick={() => completeMove(moveState.jobId, column.status)}
                        aria-label={`将岗位移动到${label}`}
                      >
                        {moveState.mode === 'pointer'
                          ? `松开移动到「${label}」`
                          : isTarget
                            ? `按回车或点击放到「${label}」`
                            : `点击移到「${label}」`}
                      </button>
                    )}
                  </div>
                </div>
                {nextStatus && <div className="kanban-flow"><ArrowRight size={14} /></div>}
              </div>
            );
          })}
        </section>
      </div>
      <p className="kanban-tip" id="kanban-instructions">每列可独立上下滚动；拖动卡片调整阶段，也可在“岗位详情”中维护状态。停止推进的岗位可移入“流程终止”，之后仍可移回其他阶段。</p>
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}
