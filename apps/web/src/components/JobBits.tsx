import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { companyLogoAssets } from '../lib/companyLogos';
import { getJobStatusLabel } from '../lib/jobStatus';
import { firstSafeWebUrl, getSafeWebUrl } from '../lib/safeUrl';
import type { Job, JobStatus, MaintenanceStatus, RecruitmentStatus } from '../types';

const actionableLinkTypes = ['具体岗位', '第三方具体岗位', '岗位精准筛选'];

export function getJobApplicationUrl(job: Pick<Job, 'url' | 'referralUrl'>) {
  return firstSafeWebUrl(job.referralUrl, job.url);
}

export function hasActionableJobLink(job: Job) {
  const recruitmentIsOpen = job.recruitmentStatus === '已开放' || job.recruitmentStatus === '部分开放';
  return recruitmentIsOpen && actionableLinkTypes.includes(job.linkType || '') && Boolean(getJobApplicationUrl(job));
}

export function getNextStepForStatus(status: JobStatus) {
  const nextSteps: Record<JobStatus, string> = {
    '收藏': '核验岗位并准备投递材料',
    '已投递': '等待后续通知',
    '笔试': '准备笔试',
    '面试': '准备面试',
    Offer: '确认 Offer 细节',
    '已结束': '记录结果并复盘',
  };
  return nextSteps[status];
}

export function CompanyLogo({ company, text, tone, size = 'normal' }: {
  company: string;
  text: string;
  tone: string;
  size?: 'micro' | 'small' | 'normal' | 'large';
}) {
  const asset = companyLogoAssets[company];
  const [failedSource, setFailedSource] = useState<string>();
  const hasImage = Boolean(asset && failedSource !== asset.src);
  const isLight = ['#ffc300'].includes(tone.toLowerCase());
  const className = [
    'company-logo',
    `company-logo--${size}`,
    hasImage ? 'company-logo--image' : '',
    hasImage && asset?.padding ? `company-logo--padding-${asset.padding}` : '',
    hasImage && asset?.aspect === 'wide' ? 'company-logo--wide' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      style={{
        background: hasImage ? asset?.surface || '#fff' : tone,
        color: isLight ? '#1f2329' : '#fff',
      }}
      role="img"
      aria-label={`${company} Logo`}
    >
      {hasImage
        ? <img src={asset?.src} alt="" referrerPolicy="no-referrer" onError={() => setFailedSource(asset?.src)} />
        : text}
    </div>
  );
}

export function StatusPill({ status }: { status: JobStatus }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}><i />{getJobStatusLabel(status)}</span>;
}

export function RecruitmentPill({ status }: { status: RecruitmentStatus }) {
  return <span className={`recruitment-pill recruitment-${status}`}><i />{status}</span>;
}

export function MaintenancePill({ status }: { status: MaintenanceStatus }) {
  return <span className={`maintenance-pill maintenance-${status}`}><i />{status}</span>;
}

export function ExternalLink({ url, label = '查看岗位', ariaLabel }: { url: string; label?: string; ariaLabel?: string }) {
  const safeUrl = getSafeWebUrl(url);
  if (!safeUrl) return <span className="link-disabled">暂无具体岗位</span>;
  return <a className="external-link" href={safeUrl} target="_blank" rel="noreferrer" draggable={false} aria-label={ariaLabel}>{label}<ArrowUpRight size={14} aria-hidden="true" /></a>;
}

export function JobActionLinks({ job, companyLabel = '查看官网' }: {
  job: Job;
  companyLabel?: string;
}) {
  const isActionable = hasActionableJobLink(job);
  if (!isActionable) return <ExternalLink url={getSafeWebUrl(job.companyUrl)} label={companyLabel} ariaLabel={`${companyLabel}：${job.company}（新窗口）`} />;

  const applicationUrl = getJobApplicationUrl(job);
  const referralUrl = getSafeWebUrl(job.referralUrl);
  const jobUrl = getSafeWebUrl(job.url);
  const applicationLabel = referralUrl ? '内推投递' : '岗位投递';
  const showDetails = Boolean(referralUrl && jobUrl && jobUrl !== applicationUrl);

  return (
    <>
      <ExternalLink url={applicationUrl} label={applicationLabel} ariaLabel={`${applicationLabel}：${job.company} ${job.title}（新窗口）`} />
      {showDetails && <ExternalLink url={jobUrl} label="官网岗位页" ariaLabel={`官网岗位页：${job.company} ${job.title}（新窗口）`} />}
    </>
  );
}
