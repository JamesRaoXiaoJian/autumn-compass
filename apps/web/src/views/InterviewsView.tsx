import { useState } from 'react';
import {
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Headphones,
  MapPin,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Video,
} from 'lucide-react';
import { InterviewModal } from '../components/InterviewModal';
import { CompanyLogo } from '../components/JobBits';
import type { Interview } from '../types';

interface InterviewsViewProps {
  interviews: Interview[];
  onChange: (interviews: Interview[]) => void;
}

function dateParts(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year, Math.max(0, month - 1), day);
  return {
    month: `${String(month || 0).padStart(2, '0')}月`,
    day: String(day || '--').padStart(2, '0'),
    weekday: Number.isNaN(value.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(value),
  };
}

function ModeIcon({ mode }: { mode: string }) {
  if (mode.includes('视频') || mode.includes('线上')) return <Video size={15} />;
  if (mode.includes('电话')) return <Headphones size={15} />;
  return <MapPin size={15} />;
}

export function InterviewsView({ interviews, onChange }: InterviewsViewProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Interview | undefined>();
  const currentEditingInterview = editing ? interviews.find((interview) => interview.id === editing.id) : undefined;
  const editorStale = Boolean(editorOpen && editing
    && (!currentEditingInterview || JSON.stringify(currentEditingInterview) !== JSON.stringify(editing)));
  const sorted = [...interviews].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  const openNew = () => {
    setEditing(undefined);
    setEditorOpen(true);
  };

  const openEdit = (interview: Interview) => {
    setEditing(interview);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(undefined);
  };

  const saveInterview = (interview: Interview) => {
    if (editing && editorStale) return;
    onChange(editing
      ? interviews.map((item) => item.id === interview.id ? interview : item)
      : [...interviews, interview]);
    closeEditor();
  };

  const removeInterview = (interview: Interview) => {
    if (!window.confirm(`确认删除“${interview.company} · ${interview.round}”的日程？`)) return;
    onChange(interviews.filter((item) => item.id !== interview.id));
  };

  const toggleChecklist = (interviewId: string, checklistId: string) => {
    onChange(interviews.map((interview) => interview.id === interviewId
      ? {
          ...interview,
          checklist: interview.checklist.map((item) => item.id === checklistId ? { ...item, done: !item.done } : item),
        }
      : interview));
  };

  return (
    <div className="view interviews-view">
      <section className="page-intro page-intro--compact">
        <div><div className="eyebrow">INTERVIEW CALENDAR</div><h1>面试日历</h1><p>把时间、轮次、准备问题和面试上下文放在同一条可编辑时间线上。</p></div>
        <button type="button" className="button button--primary" onClick={openNew}><Plus size={17} />添加面试</button>
      </section>

      <section className="interviews-layout">
        <div className="interview-timeline panel">
          <div className="panel__header"><div><div className="eyebrow">SCHEDULE</div><h2>面试安排</h2></div><span className="soft-badge">{sorted.length} 个日程</span></div>

          {!sorted.length && (
            <div className="empty-state">
              <CalendarDays size={28} />
              <h3>还没有面试安排</h3>
              <p>收到邀约后，记录轮次、时间和针对性准备清单。</p>
              <button type="button" className="button button--quiet empty-state__action" onClick={openNew}><Plus size={15} />添加第一场面试</button>
            </div>
          )}

          {sorted.map((item) => {
            const date = dateParts(item.date);
            return (
              <article className="interview-event" key={item.id}>
                <div className="interview-event__date"><span>{date.month}</span><strong>{date.day}</strong><small>{date.weekday}</small></div>
                <div className="interview-event__rule"><i /></div>
                <div className="interview-event__card">
                  <div className="interview-event__head">
                    <CompanyLogo company={item.company} text={item.logo || item.company.slice(0, 2)} tone={item.logoTone} />
                    <div><span>{item.round}</span><h3>{item.company} · {item.title}</h3></div>
                    <button type="button" className="icon-button compact" onClick={() => openEdit(item)} aria-label={`编辑 ${item.company} 面试`} title="编辑"><Pencil size={14} /></button>
                    <button type="button" className="icon-button compact" onClick={() => removeInterview(item)} aria-label={`删除 ${item.company} 面试`} title="删除"><Trash2 size={14} /></button>
                  </div>
                  <div className="interview-event__meta">
                    <span><Clock3 size={15} />{item.time}{item.endTime ? `–${item.endTime}` : ' · 结束待补充'}</span>
                    <span><ModeIcon mode={item.mode} />{item.mode}</span>
                    {item.interviewer && <span>{item.interviewer}</span>}
                  </div>

                  <div className="prep-checklist">
                    <strong>准备清单</strong>
                    {item.checklist.map((todo) => (
                      <label key={todo.id}>
                        <input type="checkbox" checked={todo.done} onChange={() => toggleChecklist(item.id, todo.id)} />
                        <span><CheckCircle2 size={15} />{todo.text}</span>
                      </label>
                    ))}
                    {!item.checklist.length && <span className="prep-checklist__empty">尚未添加准备项，可点击编辑补充。</span>}
                  </div>

                  {item.notes && <div className="interview-event__notes"><strong>备注</strong>{item.notes}</div>}
                </div>
              </article>
            );
          })}
        </div>

        <aside className="prep-sidebar">
          <article className="panel question-map">
            <BrainCircuit size={22} />
            <div className="eyebrow">BACKEND INTERVIEW QUESTION MAP</div>
            <h3>后端开发面试主线</h3>
            <p>每场面试按岗位 JD 选择真正相关的证据，不用泛泛罗列技术名词。</p>
            <div className="question-map__grid">
              {[
                ['编程基础', 'Java / Go、并发、网络协议与常用数据结构'],
                ['存储与中间件', '数据库索引与事务、缓存策略和消息队列'],
                ['系统设计', '高可用、一致性、负载均衡、限流与容量规划'],
                ['项目复盘', '性能指标、线上排障、监控告警与技术取舍'],
              ].map(([title, detail]) => <div className="question-map__item" key={title}><strong>{title}</strong><span>{detail}</span></div>)}
            </div>
          </article>

          <article className="interview-tip">
            <span>BEFORE THE INTERVIEW</span>
            <h3><ShieldCheck size={16} />面试前检查</h3>
            <p>确认 JD 与简历版本，准备项目指标和代码证据；测试会议入口、摄像头与麦克风，并写下要反问团队的问题。</p>
          </article>
        </aside>
      </section>

      {editorOpen && <InterviewModal key={editing?.id || 'new-interview'} interview={editing} stale={editorStale} onClose={closeEditor} onSubmit={saveInterview} />}
    </div>
  );
}
