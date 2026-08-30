export interface CompanyLogoAsset {
  src: string;
  surface?: string;
  padding?: 'compact' | 'roomy';
  aspect?: 'square' | 'wide';
}

// Trademark artwork is intentionally not distributed with the source code.
// These optional same-origin paths keep locally supplied assets working; when
// a file is absent, CompanyLogo falls back to the neutral text monogram.
const localCompanyLogoAssets: Record<string, CompanyLogoAsset> = {
  小米集团: { src: '/company-logos/xiaomi.svg', padding: 'compact' },
  字节跳动: { src: '/company-logos/bytedance.png' },
  美团: { src: '/company-logos/meituan.svg', padding: 'compact', aspect: 'wide' },
};

// Public builds use trademark-neutral monograms. A local operator who has the
// right to use these assets can opt in through an ignored .env.local file.
export const companyLogoAssets = import.meta.env.VITE_ENABLE_LOCAL_COMPANY_LOGOS === 'true'
  ? localCompanyLogoAssets
  : {};
