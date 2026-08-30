import { Bell, Search } from 'lucide-react';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

interface AppHeaderProps {
  search: string;
  onSearch: (value: string) => void;
}

export function AppHeader({ search, onSearch }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__date">{dateFormatter.format(new Date())}</div>
      <div className="app-header__tools">
        <label className="global-search">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="搜索公司、岗位或标签"
          />
          <kbd>⌘ K</kbd>
        </label>
        <button type="button" className="icon-button notification-button" aria-label="通知">
          <Bell size={19} />
          <span />
        </button>
        <div className="avatar" aria-label="秋招罗盘">秋</div>
      </div>
    </header>
  );
}
