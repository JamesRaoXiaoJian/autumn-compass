import { useEffect, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { getNextStepForStatus } from './components/JobBits';
import { JobModal } from './components/JobModal';
import { Sidebar } from './components/Sidebar';
import {
  initialInterviews,
  initialJobs,
  initialResumeDocument,
  jobCatalogRevision,
  retiredJobIdentities,
} from './data';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useJobs } from './hooks/useJobs';
import { useResumeDocument } from './hooks/useResumeDocument';
import { appendJobStatusTransition, getJobStatusLabel } from './lib/jobStatus';
import type { Interview, Job, JobStatus, Priority, ResumeDocument, ViewKey } from './types';
import { Dashboard } from './views/Dashboard';
import { InterviewsView } from './views/InterviewsView';
import { JobsView } from './views/JobsView';
import { NotesView } from './views/NotesView';
import { PipelineView } from './views/PipelineView';
import { ResumeView } from './views/ResumeView';

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | undefined>();
  const [toast, setToast] = useState('');
  const [jobs, setJobs, deleteJob, restoreJobTracking] = useJobs(
    initialJobs,
    retiredJobIdentities,
    jobCatalogRevision,
  );
  const [interviews, setInterviews] = useLocalStorage<Interview[]>('autumn-compass-interviews-v2', initialInterviews);
  const [resumeDocument, setResumeDocument, resumeStorageStatus] = useResumeDocument(initialResumeDocument);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.global-search input')?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeView]);

  const currentEditingJob = editingJob ? jobs.find((job) => job.id === editingJob.id) : undefined;
  const jobEditorStale = Boolean(modalOpen && editingJob
    && (!currentEditingJob || JSON.stringify(currentEditingJob) !== JSON.stringify(editingJob)));

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };
  const addJob = (job: Job) => {
    if (editingJob && jobEditorStale) {
      notify('该岗位已在另一设备更新；请取消并重新打开后再编辑');
      return;
    }
    if (!editingJob) restoreJobTracking(job);
    setJobs((current) => editingJob ? current.map((item) => item.id === job.id ? job : item) : [job, ...current]);
    setModalOpen(false);
    setEditingJob(undefined);
    if (!editingJob) setActiveView('jobs');
    notify(editingJob ? '岗位信息已保存' : '岗位已加入目标清单');
  };
  const openNewJob = () => { setEditingJob(undefined); setModalOpen(true); };
  const openEditJob = (job: Job) => { setEditingJob(job); setModalOpen(true); };
  const closeJobModal = () => { setModalOpen(false); setEditingJob(undefined); };
  const removeJob = (job: Job) => {
    if (modalOpen && editingJob?.id === job.id && jobEditorStale) {
      notify('该岗位已在另一设备更新；请取消并重新打开后再删除');
      return;
    }
    deleteJob(job.id);
    closeJobModal();
    notify('岗位已删除');
  };
  const updateStatus = (id: string, status: JobStatus) => {
    const target = jobs.find((job) => job.id === id);
    if (!target || target.status === status) return;
    const changedAt = new Date().toISOString();
    setJobs((current) => current.map((job) => {
      if (job.id !== id || job.status === status) return job;
      const curatedNextStep = initialJobs.find((initial) => initial.id === id)?.nextStep;
      return {
        ...job,
        statusHistory: appendJobStatusTransition(job.statusHistory, job.status, status, changedAt),
        status,
        nextStep: status === '收藏' ? curatedNextStep || getNextStepForStatus(status) : getNextStepForStatus(status),
        appliedAt: status === '收藏' ? undefined : status === '已结束' ? job.appliedAt : job.appliedAt || changedAt.slice(0, 10),
      };
    }));
    notify(`投递状态已更新为「${getJobStatusLabel(status)}」`);
  };
  const updatePriority = (id: string, priority: Priority) => {
    const target = jobs.find((job) => job.id === id);
    if (!target || target.priority === priority) return;
    setJobs((current) => current.map((job) => job.id === id ? { ...job, priority } : job));
    notify(`岗位优先级已调整为 ${priority} 级`);
  };
  const updateResumeDocument = (next: ResumeDocument) => setResumeDocument({ ...next, updatedAt: new Date().toISOString() });

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onViewChange={setActiveView} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} interviewCount={interviews.length} openCompanyCount={new Set(jobs.filter((job) => job.recruitmentStatus === '已开放').map((job) => job.company)).size} priorityCompanyCount={new Set(jobs.filter((job) => job.priority === 'S').map((job) => job.company)).size} />
      <main className="main-shell">
        <AppHeader search={search} onSearch={(value) => { setSearch(value); if (value) setActiveView('jobs'); }} />
        <div className="content-scroll">
          {activeView === 'dashboard' && <Dashboard jobs={jobs} interviews={interviews} onAddJob={openNewJob} onNavigate={setActiveView} />}
          {activeView === 'jobs' && <JobsView jobs={jobs} search={search} onSearch={setSearch} onAddJob={openNewJob} onEditJob={openEditJob} onDeleteJob={removeJob} onStatusChange={updateStatus} onPriorityChange={updatePriority} />}
          {activeView === 'pipeline' && <PipelineView jobs={jobs} onStatusChange={updateStatus} onPriorityChange={updatePriority} onEditJob={openEditJob} />}
          {activeView === 'interviews' && <InterviewsView interviews={interviews} onChange={setInterviews} />}
          {activeView === 'resume' && <ResumeView document={resumeDocument} storageStatus={resumeStorageStatus} onChange={updateResumeDocument} />}
          {activeView === 'notes' && <NotesView />}
        </div>
      </main>
      <JobModal key={editingJob?.id || 'new-job'} open={modalOpen} job={editingJob} stale={jobEditorStale} onClose={closeJobModal} onSubmit={addJob} onDelete={removeJob} />
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}
