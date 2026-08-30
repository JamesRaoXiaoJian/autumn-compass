import { StrictMode, useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import {
  bootstrapWorkspace,
  discardPendingWorkspaceChanges,
  getWorkspaceSyncStatus,
  initializeEmptyWorkspace,
  retryWorkspaceSync,
  startWorkspaceSync,
  WorkspaceInitializationRequiredError,
  workspaceSyncStatusEvent,
  type WorkspaceSyncStatus,
} from './lib/workspaceSync';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

function subscribeWorkspaceSyncStatus(onStoreChange: () => void) {
  const handleStatus = () => onStoreChange();
  window.addEventListener(workspaceSyncStatusEvent, handleStatus);
  return () => window.removeEventListener(workspaceSyncStatusEvent, handleStatus);
}

function StartupScreen({
  error,
  initializationRequired = false,
  onRetry,
}: {
  error?: string;
  initializationRequired?: boolean;
  onRetry?: () => void;
}) {
  const title = initializationRequired ? '创建新的服务器工作区' : error ? '服务器工作区不可用' : '正在载入服务器工作区';
  const description = initializationRequired
    ? '服务器、本浏览器缓存与简历本机副本中均未发现旧数据。确认后会创建空工作区，再载入项目内置的初始资料。'
    : error || '正在读取服务器中的岗位、面试、笔记与简历数据，完成前不会进入编辑界面。';
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f4f4ef', color: '#17191f' }}>
      <section aria-live="polite" style={{ width: 'min(520px, 100%)', padding: 32, border: '1px solid #dedfd8', borderRadius: 16, background: '#fff', boxShadow: '0 18px 50px rgba(18, 20, 30, .08)' }}>
        <div className="eyebrow">SERVER WORKSPACE</div>
        <h1 style={{ margin: '10px 0 12px', fontSize: 28 }}>{title}</h1>
        <p style={{ margin: 0, lineHeight: 1.7, color: '#62655f' }}>
          {description}
        </p>
        {(error || initializationRequired) && onRetry && (
          <button type="button" className="button button--primary" style={{ marginTop: 22 }} onClick={onRetry}>
            {initializationRequired ? '确认没有旧数据，初始化新工作区' : '重新连接'}
          </button>
        )}
      </section>
    </main>
  );
}

function WorkspaceApplication() {
  const syncStatus = useSyncExternalStore(
    subscribeWorkspaceSyncStatus,
    getWorkspaceSyncStatus,
    getWorkspaceSyncStatus,
  );
  const [displaySyncStatus, setDisplaySyncStatus] = useState<WorkspaceSyncStatus>(getWorkspaceSyncStatus);
  const [retrying, setRetrying] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  useEffect(() => {
    if (syncStatus.state !== 'syncing') {
      setDisplaySyncStatus(syncStatus);
      return undefined;
    }
    // Normal local writes usually finish in a few milliseconds. Only show a
    // saving state when it lasts long enough to be meaningful to the user.
    const timer = window.setTimeout(() => setDisplaySyncStatus(syncStatus), 450);
    return () => window.clearTimeout(timer);
  }, [syncStatus]);

  const retry = async () => {
    setRetrying(true);
    try {
      await retryWorkspaceSync();
    } catch {
      // The sync status event carries the actionable error shown below.
    } finally {
      setRetrying(false);
    }
  };

  const discardLocalChanges = async () => {
    if (!window.confirm('确认放弃本浏览器尚未写入服务器的冲突修改，并载入服务器版本？')) return;
    setDiscarding(true);
    try {
      await discardPendingWorkspaceChanges();
    } catch {
      // The global status contains the server read error.
    } finally {
      setDiscarding(false);
    }
  };

  const state = retrying || discarding ? 'syncing' : displaySyncStatus.state;
  const isError = state === 'error';
  const isReconnecting = state === 'reconnecting';
  const statusClass = isError
    ? 'error'
    : isReconnecting
      ? 'reconnecting'
      : state === 'syncing' || state === 'bootstrapping'
        ? 'syncing'
        : 'online';
  const label = isError
    ? displaySyncStatus.pendingWrites > 0 ? '保存未完成' : '同步连接异常'
    : isReconnecting
      ? '实时连接重连中'
      : state === 'syncing' || state === 'bootstrapping'
        ? syncStatus.pendingWrites > 0 ? '正在保存…' : '正在同步…'
        : '已同步';

  return (
    <>
      {statusClass !== 'online' && (
        <aside
          className={`workspace-sync-status workspace-sync-status--${statusClass}`}
          role={isError ? 'alert' : 'status'}
          aria-live={isError ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <i aria-hidden="true" />
          <div>
            <strong>{label}</strong>
            {(isError || isReconnecting) && (
              <span>{displaySyncStatus.message || (isError
                ? '修改尚未确认写入服务器，请重新连接。'
                : '修改仍会正常保存，连接恢复后将继续接收其他设备的更新。')}</span>
            )}
          </div>
          {isError && (
            <div className="workspace-sync-status__actions">
              <button type="button" disabled={retrying || discarding} onClick={() => void retry()}>
                {retrying ? '重试中…' : syncStatus.pendingWrites > 0 ? '重试保存' : '重新连接'}
              </button>
              {syncStatus.canDiscardLocalChanges && (
                <button type="button" disabled={retrying || discarding} onClick={() => void discardLocalChanges()}>
                  {discarding ? '载入中…' : '使用服务器版本'}
                </button>
              )}
            </div>
          )}
        </aside>
      )}
      <App />
    </>
  );
}

function renderApplication() {
  root.render(
    <StrictMode>
      <WorkspaceApplication />
    </StrictMode>,
  );
  startWorkspaceSync();
}

async function launch() {
  root.render(<StartupScreen />);
  try {
    await bootstrapWorkspace();
    renderApplication();
  } catch (error) {
    if (error instanceof WorkspaceInitializationRequiredError) {
      root.render(<StartupScreen initializationRequired onRetry={() => void initializeAndLaunch()} />);
      return;
    }
    const message = error instanceof Error ? error.message : '无法连接服务器同步接口';
    root.render(<StartupScreen error={message} onRetry={() => void launch()} />);
  }
}

async function initializeAndLaunch() {
  root.render(<StartupScreen />);
  try {
    await initializeEmptyWorkspace();
    renderApplication();
  } catch {
    // Another browser may have completed the one-time migration after this
    // screen was shown. Re-run bootstrap so its canonical data wins instead of
    // retrying an empty initialization against a newer server revision.
    await launch();
  }
}

void launch();
