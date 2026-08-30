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

export interface FieldMatch {
  key: keyof ResumeProfile | null;
  label: string;
  confidence: number;
  valuePresent: boolean;
  tag: string;
}

export interface ScanResponse {
  ok: boolean;
  total: number;
  matched: number;
  fields: FieldMatch[];
  reason?: string;
}

export interface FillResponse extends ScanResponse {
  filled: number;
  skipped: number;
}
