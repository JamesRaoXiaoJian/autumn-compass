import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  FileText,
  Gauge,
  KanbanSquare,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { ViewKey } from '../types';

const navItems: { key: ViewKey; label: string; shortLabel: string; icon: typeof Gauge }[] = [
  { key: 'dashboard', label: '总览', shortLabel: '总览', icon: Gauge },
  { key: 'jobs', label: '公司与岗位', shortLabel: '岗位', icon: BriefcaseBusiness },
  { key: 'pipeline', label: '投递看板', shortLabel: '看板', icon: KanbanSquare },
  { key: 'interviews', label: '面试日历', shortLabel: '面试', icon: CalendarDays },
  { key: 'resume', label: '简历资料', shortLabel: '简历', icon: FileText },
  { key: 'notes', label: '求职笔记', shortLabel: '笔记', icon: BarChart3 },
];

interface SidebarProps {
  activeView: ViewKey;
  onViewChange: (view: ViewKey) => void;
  collapsed: boolean;
  onToggle: () => void;
  interviewCount: number;
  openCompanyCount: number;
  priorityCompanyCount: number;
}

export function Sidebar({ activeView, onViewChange, collapsed, onToggle, interviewCount, openCompanyCount, priorityCompanyCount }: SidebarProps) {
  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="brand">
        <div className="brand__mark"><Sparkles size={19} strokeWidth={2.1} /></div>
        {!collapsed && (
          <div>
            <div className="brand__name">秋招罗盘</div>
            <div className="brand__en">AUTUMN COMPASS</div>
          </div>
        )}
      </div>

      <nav className="nav">
        {!collapsed && <div className="nav__eyebrow">工作台</div>}
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              className={`nav__item ${activeView === item.key ? 'is-active' : ''}`}
              key={item.key}
              title={item.label}
              aria-label={item.label}
              aria-current={activeView === item.key ? 'page' : undefined}
              onClick={() => onViewChange(item.key)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span className="nav__label nav__label--desktop">{item.label}</span>
              <span className="nav__label nav__label--mobile">{item.shortLabel}</span>
              {item.key === 'interviews' && !collapsed && interviewCount > 0 && <span className="nav__badge">{interviewCount}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar__bottom">
        {!collapsed && (
          <div className="season-card">
            <div className="season-card__icon"><Sparkles size={16} /></div>
            <div className="season-card__label">2027 届秋招作战台</div>
            <div className="season-card__meta">{openCompanyCount} 家开放 · {priorityCompanyCount} 家 S 级 · {interviewCount} 个面试</div>
          </div>
        )}
        <button type="button" className="nav__item muted" aria-label="偏好设置"><Settings size={18} />{!collapsed && <span>偏好设置</span>}</button>
        <button type="button" className="collapse-button" onClick={onToggle} aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}>
          <ChevronLeft size={16} />
        </button>
      </div>
    </aside>
  );
}
