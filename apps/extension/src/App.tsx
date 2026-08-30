import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  FileJson,
  FileUser,
  Gauge,
  Import,
  Info,
  LockKeyhole,
  MousePointer2,
  RefreshCw,
  ScanSearch,
  Settings,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { queryActiveTab, sendToTab, storageGet, storageSet } from './browserApi';
import { emptyProfile, profileLabels } from './data';
import type { FillResponse, ResumeProfile, ScanResponse } from './types';

type Tab = 'fill' | 'profile' | 'settings';
interface ExtensionSettings { onlyEmpty: boolean; highlight: boolean }

const editableFields: (keyof ResumeProfile)[] = ['fullName', 'phone', 'email', 'gender', 'birthday', 'currentCity', 'city', 'school', 'major', 'degree', 'graduationYear', 'targetRole', 'skills', 'github', 'website'];

function displayHost(url?: string) {
  try { return new URL(url || '').hostname.replace(/^www\./, ''); } catch { return '当前页面'; }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('fill');
  const [profile, setProfile] = useState<ResumeProfile>(emptyProfile);
  const [settings, setSettings] = useState<ExtensionSettings>({ onlyEmpty: true, highlight: true });
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [pageHost, setPageHost] = useState('当前招聘页面');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    storageGet(['profile', 'settings']).then((saved) => {
      if (saved.profile) setProfile({ ...emptyProfile, ...saved.profile });
      if (saved.settings) setSettings(saved.settings as ExtensionSettings);
    });
    queryActiveTab().then((current) => setPageHost(displayHost(current?.url)));
  }, []);

  const persistProfile = (next: ResumeProfile) => {
    setProfile(next);
    storageSet({ profile: next });
  };
  const persistSettings = (next: ExtensionSettings) => {
    setSettings(next);
    storageSet({ settings: next });
  };
  const send = async <T,>(payload: object): Promise<T> => {
    const current = await queryActiveTab();
    if (!current?.id) throw new Error('无法读取当前标签页');
    try {
      return await sendToTab<T>(current.id, payload);
    } catch {
      throw new Error('此页面不允许插件运行，请打开招聘网站的申请表单后重试');
    }
  };
  const scanPage = async () => {
    setBusy(true); setMessage(null);
    try {
      const response = await send<ScanResponse>({ type: 'SCAN_FORM' });
      setScan(response);
      if (!response.total) setMessage({ type: 'error', text: '页面上暂未发现可填写表单' });
    } catch (error) {
      setScan(null);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '扫描失败' });
    } finally { setBusy(false); }
  };
  const fillPage = async () => {
    setBusy(true); setMessage(null);
    try {
      const response = await send<FillResponse>({ type: 'AUTOFILL', profile, settings });
      setScan(response);
      setMessage({ type: response.filled ? 'success' : 'error', text: response.filled ? `已安全填充 ${response.filled} 个字段，请检查后提交` : '没有可填充字段，请先完善资料或检查页面' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '填充失败' });
    } finally { setBusy(false); }
  };
  const importProfile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<ResumeProfile>;
      const next = { ...emptyProfile, ...parsed };
      persistProfile(next);
      setMessage({ type: 'success', text: '资料导入成功，已安全保存在本机' });
    } catch {
      setMessage({ type: 'error', text: '无法读取该文件，请选择管理端导出的 JSON' });
    }
    event.target.value = '';
  };

  const completion = Math.round((Object.values(profile).filter(Boolean).length / Object.keys(profile).length) * 100);
  const matchedFields = scan?.fields.filter((field) => field.key).slice(0, 6) || [];

  return (
    <div className="extension-shell">
      <header className="extension-header">
        <div className="extension-brand"><span><Sparkles size={16} /></span><div><strong>秋招罗盘</strong><small>AUTOFILL</small></div></div>
        <div className="secure-label"><LockKeyhole size={12} />本地运行</div>
      </header>

      {tab === 'fill' && (
        <main className="popup-main fill-view">
          <section className="page-context">
            <div className="page-context__icon"><FileUser size={19} /></div>
            <div><span>正在查看</span><strong>{pageHost}</strong></div>
            <button type="button" onClick={scanPage} className={busy ? 'is-spinning' : ''} title="重新扫描"><RefreshCw size={15} /></button>
          </section>

          <section className="fill-hero">
            <div className="fill-hero__art"><div className="scan-orbit"><ScanSearch size={25} /><i /><i /><i /></div></div>
            <div className="eyebrow">SMART FORM ASSISTANT</div>
            <h1>{scan ? `识别到 ${scan.matched} 个可匹配字段` : '准备好，少填一点。'}</h1>
            <p>{scan ? `页面共有 ${scan.total} 个输入项，填充前会保留你已输入的内容。` : '扫描当前申请表单，预览匹配结果后再一键填充。'}</p>
            {!scan ? <button type="button" className="primary-button" onClick={scanPage} disabled={busy}><ScanSearch size={17} />{busy ? '正在扫描…' : '扫描当前页面'}</button> : <button type="button" className="primary-button magic" onClick={fillPage} disabled={busy || !scan.matched}><WandSparkles size={17} />{busy ? '正在填充…' : `一键填充 ${scan.matched} 项`}</button>}
          </section>

          {message && <div className={`popup-message popup-message--${message.type}`}>{message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}<span>{message.text}</span><button type="button" onClick={() => setMessage(null)}><X size={13} /></button></div>}

          {scan && (
            <section className="matches-card">
              <div className="section-heading"><div><span>字段预览</span><small>{scan.matched} / {scan.total} 已匹配</small></div><button type="button" onClick={() => setTab('profile')}>编辑资料 <ChevronRight size={13} /></button></div>
              <div className="match-list">
                {matchedFields.map((field, index) => <div className="match-row" key={`${field.label}-${index}`}><span className="match-check"><Check size={11} /></span><div><strong>{field.key ? profileLabels[field.key] : field.label}</strong><small>{field.valuePresent ? '页面已有内容，将跳过' : field.label}</small></div><span className="confidence">{field.confidence}%</span></div>)}
                {scan.matched > 6 && <div className="more-matches">还有 {scan.matched - 6} 个匹配字段</div>}
              </div>
            </section>
          )}

          {!scan && (
            <section className="tip-card"><MousePointer2 size={18} /><div><strong>由你掌控每次填写</strong><p>插件只会在你点击后工作，也不会自动提交申请。</p></div></section>
          )}
        </main>
      )}

      {tab === 'profile' && (
        <main className="popup-main profile-view">
          <div className="subpage-title"><button type="button" onClick={() => setTab('fill')}><ArrowLeft size={16} /></button><div><span>MY PROFILE</span><h1>我的资料</h1></div><div className="mini-progress">{completion}%</div></div>
          <div className="import-strip"><FileJson size={18} /><div><strong>从管理端同步</strong><span>导入秋招罗盘导出的 JSON 文件</span></div><button type="button" onClick={() => fileInput.current?.click()}><Import size={14} />导入</button><input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={importProfile} /></div>
          {message && <div className={`popup-message popup-message--${message.type}`}>{message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}<span>{message.text}</span></div>}
          <div className="popup-form">
            {editableFields.map((key) => <label key={key} className={['github', 'website'].includes(key) ? 'wide' : ''}><span>{profileLabels[key]}</span><input type={key === 'email' ? 'email' : key === 'birthday' ? 'date' : 'text'} value={profile[key]} onChange={(event) => persistProfile({ ...profile, [key]: event.target.value })} placeholder={`填写${profileLabels[key]}`} /></label>)}
          </div>
          <div className="autosave-note"><CheckCircle2 size={14} />修改会自动保存在当前浏览器</div>
        </main>
      )}

      {tab === 'settings' && (
        <main className="popup-main settings-view">
          <div className="subpage-title"><button type="button" onClick={() => setTab('fill')}><ArrowLeft size={16} /></button><div><span>PREFERENCES</span><h1>填充设置</h1></div></div>
          <section className="settings-card">
            <label className="setting-row"><div><strong>仅填写空白字段</strong><span>保留你已经手动输入的内容</span></div><input type="checkbox" checked={settings.onlyEmpty} onChange={(e) => persistSettings({ ...settings, onlyEmpty: e.target.checked })} /><i /></label>
            <label className="setting-row"><div><strong>高亮匹配结果</strong><span>填充后短暂标记已匹配字段</span></div><input type="checkbox" checked={settings.highlight} onChange={(e) => persistSettings({ ...settings, highlight: e.target.checked })} /><i /></label>
          </section>
          <section className="privacy-card"><ShieldCheck size={25} /><h2>资料属于你</h2><p>所有简历字段只存储在 Chrome 本地空间。插件不收集页面内容、不发送网络请求，也绝不会替你点击提交。</p><div><Info size={14} />建议提交前逐项核对自动填充结果。</div></section>
          <section className="supported-card"><span>已适配的字段</span><div>姓名 · 手机 · 邮箱 · 性别 · 城市 · 教育经历 · 个人链接 · 求职偏好</div></section>
        </main>
      )}

      <nav className="popup-nav">
        <button type="button" className={tab === 'fill' ? 'is-active' : ''} onClick={() => setTab('fill')}><Gauge size={17} /><span>智能填充</span></button>
        <button type="button" className={tab === 'profile' ? 'is-active' : ''} onClick={() => setTab('profile')}><FileUser size={17} /><span>我的资料</span></button>
        <button type="button" className={tab === 'settings' ? 'is-active' : ''} onClick={() => setTab('settings')}><Settings size={17} /><span>设置</span></button>
      </nav>
    </div>
  );
}
