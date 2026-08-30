import type { ResumeDocument, ResumeExperience, ResumeProfile } from '../types';

// Public source defaults are deliberately empty. Once a server workspace has
// been initialized, its SQLite snapshot wins before React renders, so changing
// these defaults never replaces an existing local resume.
export const initialProfile: ResumeProfile = {
  fullName: '',
  gender: '',
  phone: '',
  email: '',
  birthday: '',
  city: '',
  currentCity: '',
  idNumber: '',
  school: '',
  major: '',
  degree: '',
  graduationYear: '',
  targetRole: '',
  researchFocus: '',
  undergraduateSchool: '',
  undergraduateMajor: '',
  graduatePeriod: '',
  undergraduatePeriod: '',
  honors: '',
  skills: '',
  expectedSalary: '',
  availableDate: '',
  workAuthorization: '',
  linkedin: '',
  github: '',
  website: '',
  summary: '',
};

export const initialResumeExperiences: ResumeExperience[] = [];

export const initialResumeDocument: ResumeDocument = {
  version: 4,
  updatedAt: '1970-01-01T00:00:00.000Z',
  profile: initialProfile,
  experiences: initialResumeExperiences,
};
