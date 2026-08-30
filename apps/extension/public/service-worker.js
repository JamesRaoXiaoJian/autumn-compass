const defaultProfile = {
  fullName: '', gender: '', phone: '', email: '', birthday: '',
  city: '', currentCity: '', idNumber: '', school: '', major: '', degree: '',
  graduationYear: '', targetRole: '', researchFocus: '',
  undergraduateSchool: '', undergraduateMajor: '', graduatePeriod: '', undergraduatePeriod: '',
  honors: '', skills: '',
  expectedSalary: '', availableDate: '', workAuthorization: '', linkedin: '',
  github: '', website: '', summary: '',
};

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get(['profile', 'profileVersion', 'settings']);
  if (saved.profileVersion !== 5) {
    const profile = Object.fromEntries(
      Object.entries(defaultProfile).map(([key, value]) => [key, saved.profile?.[key] || value]),
    );
    await chrome.storage.local.set({ profile, profileVersion: 5 });
  }
  if (!saved.settings) await chrome.storage.local.set({ settings: { onlyEmpty: true, highlight: true } });
});
