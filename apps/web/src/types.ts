export type JobStatus = '收藏' | '已投递' | '笔试' | '面试' | 'Offer' | '已结束';
export type Priority = 'S' | 'A' | 'B';
export type RecruitmentStatus = '已开放' | '部分开放' | '待开放' | '待确认';
export type MaintenanceStatus = '自动维护' | '无需维护';
export type JobLinkType = '具体岗位' | '第三方具体岗位' | '岗位精准筛选' | '岗位列表' | '暂无有效岗位';

export interface JobStatusChange {
  fromStatus: JobStatus | null;
  toStatus: JobStatus;
  changedAt: string;
}

export interface Job {
  id: string;
  company: string;
  logo: string;
  logoTone: string;
  title: string;
  department: string;
  location: string;
  type: string;
  status: JobStatus;
  statusHistory?: JobStatusChange[];
  priority: Priority;
  deadline: string;
  appliedAt?: string;
  nextStep?: string;
  url: string;
  companyUrl?: string;
  referralUrl?: string;
  referralCode?: string;
  referralNote?: string;
  source: string;
  tags: string[];
  notes?: string;
  recruitmentStatus: RecruitmentStatus;
  maintenanceStatus: MaintenanceStatus;
  season: string;
  verifiedAt: string;
  recruitmentNote: string;
  evidenceUrl: string;
  applicationStartDate?: string;
  applicationEndDate?: string;
  dateSourceNote?: string;
  jobCode?: string;
  linkType?: JobLinkType;
  userEditedAt?: string;
  editedFields?: (keyof Job)[];
}

export interface Interview {
  id: string;
  company: string;
  logo: string;
  logoTone: string;
  title: string;
  round: string;
  date: string;
  time: string;
  endTime?: string;
  mode: string;
  interviewer?: string;
  checklist: InterviewChecklistItem[];
  notes?: string;
}

export interface InterviewChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ResumeProfile {
  fullName: string;
  gender: string;
  phone: string;
  email: string;
  birthday: string;
  city: string;
  currentCity: string;
  idNumber: string;
  school: string;
  major: string;
  degree: string;
  graduationYear: string;
  targetRole: string;
  researchFocus: string;
  undergraduateSchool: string;
  undergraduateMajor: string;
  graduatePeriod: string;
  undergraduatePeriod: string;
  honors: string;
  skills: string;
  expectedSalary: string;
  availableDate: string;
  workAuthorization: string;
  linkedin: string;
  github: string;
  website: string;
  summary: string;
}

export type ExperienceCategory = 'internship' | 'research' | 'project';

export interface ResumeExperience {
  id: string;
  category: ExperienceCategory;
  title: string;
  organization: string;
  role: string;
  startDate: string;
  endDate: string;
  current: boolean;
  location: string;
  link: string;
  technologies: string;
  summary: string;
  highlights: string[];
}

export interface ResumeDocument {
  version: number;
  updatedAt: string;
  profile: ResumeProfile;
  experiences: ResumeExperience[];
}

export type ViewKey = 'dashboard' | 'jobs' | 'pipeline' | 'interviews' | 'resume' | 'notes';
