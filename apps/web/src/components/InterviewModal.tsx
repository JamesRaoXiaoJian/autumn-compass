import { useEffect, useState } from 'react';
import { CheckCircle2, Plus, Trash2, X } from 'lucide-react';
import { createEntityId } from '../lib/createEntityId';
import type { Interview, InterviewChecklistItem } from '../types';

interface InterviewModalProps {
  interview?: Interview;
  stale?: boolean;
  onClose: () => void;
  onSubmit: (interview: Interview) => void;
}

const checklistSeeds = [
  '准备 90 秒自我介绍，并明确与岗位的匹配点',
  '复盘后端项目中的系统架构、性能指标、技术取舍与故障案例',
  '梳理数据库、缓存、消息队列与分布式一致性问题',
];

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function createChecklist(): InterviewChecklistItem[] {
  return checklistSeeds.map((text) => ({ id: createEntityId('check'), text, done: false }));
}

function createDraft(interview?: Interview): Interview {
  if (interview) {
    return {
      ...interview,
      endTime: interview.endTime || '',
      checklist: interview.checklist.map((item) => ({ ...item })),
    };
  }

  return {
    id: createEntityId('interview'),
    company: '',
    logo: '',
    logoTone: '#4c55d7',
    title: '',
    round: '技术一面',
    date: localDate(),
    time: '14:00',
    endTime: '15:00',
    mode: '视频面试',
    interviewer: '',
    checklist: createChecklist(),
    notes: '',
  };
}

export function InterviewModal({ interview, stale = false, onClose, onSubmit }: InterviewModalProps) {
  const [draft, setDraft] = useState<Interview>(() => createDraft(interview));
  const requiresEndTime = !interview || Boolean(interview.endTime);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const update = <K extends keyof Interview>(key: K, value: Interview[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateChecklist = (id: string, changes: Partial<InterviewChecklistItem>) => {
    update('checklist', draft.checklist.map((item) => item.id === id ? { ...item, ...changes } : item));
  };

  const addChecklistItem = () => {
    update('checklist', [...draft.checklist, { id: createEntityId('check'), text: '', done: false }]);
  };

  const removeChecklistItem = (id: string) => {
    update('checklist', draft.checklist.filter((item) => item.id !== id));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stale) return;
    const company = draft.company.trim();
    const title = draft.title.trim();
    const endTime = draft.endTime?.trim() || '';
    if (!company || !title || !draft.date || !draft.time || (requiresEndTime && !endTime)) return;

    onSubmit({
      ...draft,
      company,
      title,
      endTime: endTime || undefined,
      round: draft.round.trim() || '技术面试',
      logo: draft.logo || company.slice(0, 2).toUpperCase(),
      interviewer: draft.interviewer?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
      checklist: draft.checklist
        .map((item) => ({ ...item, text: item.text.trim() }))
        .filter((item) => item.text),
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="job-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="interview-modal-title">
        <div className="modal-header">
          <div>
            <div className="eyebrow">INTERVIEW ENTRY</div>
            <h2 id="interview-modal-title">{interview ? '编辑面试安排' : '添加面试安排'}</h2>
            <p>记录准确时间、面试形式，以及这场面试真正需要验证的内容。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭面试编辑器"><X size={20} /></button>
        </div>

        <div className="form-grid">
          <label><span>公司名称 *</span><input autoFocus required value={draft.company} onChange={(event) => update('company', event.target.value)} placeholder="例如：示例科技" /></label>
          <label><span>目标岗位 *</span><input required value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder="例如：后端开发工程师" /></label>
          <label><span>面试轮次</span><input value={draft.round} onChange={(event) => update('round', event.target.value)} placeholder="技术一面 / HR 面" /></label>
          <label><span>面试形式</span><select value={draft.mode} onChange={(event) => update('mode', event.target.value)}><option>视频面试</option><option>现场面试</option><option>电话面试</option><option>线上群面</option><option>其他</option></select></label>
          <label><span>日期 *</span><input required type="date" value={draft.date} onChange={(event) => update('date', event.target.value)} /></label>
          <label><span>开始时间 *</span><input required type="time" value={draft.time} onChange={(event) => update('time', event.target.value)} /></label>
          <label><span>{requiresEndTime ? '结束时间 *' : '结束时间（待补充）'}</span><input required={requiresEndTime} type="time" min={draft.time || undefined} value={draft.endTime || ''} onChange={(event) => update('endTime', event.target.value)} /></label>
          <label className="form-grid__full"><span>面试官 / 会议入口</span><input value={draft.interviewer || ''} onChange={(event) => update('interviewer', event.target.value)} placeholder="姓名、团队或会议链接均可" /></label>

          <label className="form-grid__full">
            <span>准备清单</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draft.checklist.map((item) => (
                <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr) 36px', gap: 7, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="icon-button compact"
                    onClick={() => updateChecklist(item.id, { done: !item.done })}
                    aria-label={item.done ? '标记为待准备' : '标记为已准备'}
                    aria-pressed={item.done}
                    title={item.done ? '标记为待准备' : '标记为已准备'}
                  >
                    <CheckCircle2 size={17} color={item.done ? '#2f8b68' : undefined} />
                  </button>
                  <input value={item.text} onChange={(event) => updateChecklist(item.id, { text: event.target.value })} placeholder="添加需要核验或准备的问题" />
                  <button type="button" className="icon-button" onClick={() => removeChecklistItem(item.id)} aria-label="删除准备项" title="删除准备项"><Trash2 size={16} /></button>
                </div>
              ))}
              <button type="button" className="button button--quiet" onClick={addChecklistItem} style={{ alignSelf: 'flex-start' }}><Plus size={15} />添加准备项</button>
            </div>
          </label>

          <label className="form-grid__full"><span>面试备注</span><textarea rows={4} value={draft.notes || ''} onChange={(event) => update('notes', event.target.value)} placeholder="记录岗位 JD、重点追问、会议材料或需要向面试官确认的问题……" /></label>
        </div>

        {stale && (
          <div className="modal-stale-warning" role="alert">
            该面试已在另一设备更新。当前草稿不会覆盖服务器；请复制需要保留的内容，取消后重新打开日程。
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button button--quiet" onClick={onClose}>取消</button>
          <button type="submit" className="button button--primary" disabled={stale}>{stale ? '请重新打开' : interview ? '保存修改' : '添加到日历'}</button>
        </div>
      </form>
    </div>
  );
}
