import type { ResumeProfile } from './types';

export const emptyProfile: ResumeProfile = {
  fullName: '', gender: '', phone: '', email: '', birthday: '', city: '', currentCity: '', idNumber: '',
  school: '', major: '', degree: '', graduationYear: '', expectedSalary: '', availableDate: '',
  targetRole: '', researchFocus: '', undergraduateSchool: '', undergraduateMajor: '', graduatePeriod: '', undergraduatePeriod: '', honors: '', skills: '',
  workAuthorization: '', linkedin: '', github: '', website: '', summary: '',
};

export const profileLabels: Record<keyof ResumeProfile, string> = {
  fullName: '姓名', gender: '性别', phone: '手机号', email: '邮箱', birthday: '出生日期', city: '期望城市',
  currentCity: '现居城市', idNumber: '身份证号', school: '学校', major: '专业', degree: '学历',
  graduationYear: '毕业年份', expectedSalary: '期望薪资', availableDate: '到岗日期',
  targetRole: '目标岗位', researchFocus: '研究方向', undergraduateSchool: '本科院校',
  undergraduateMajor: '本科专业', graduatePeriod: '硕士就读时间', undergraduatePeriod: '本科就读时间', honors: '奖项与证书', skills: '专业技能',
  workAuthorization: '工作许可', linkedin: 'LinkedIn', github: 'GitHub', website: '个人网站', summary: '个人简介',
};
