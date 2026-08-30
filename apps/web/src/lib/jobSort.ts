import type { Job, Priority } from '../types';

const priorityRank: Record<Priority, number> = {
  S: 0,
  A: 1,
  B: 2,
};

const displayNameCollator = new Intl.Collator(['zh-CN-u-co-pinyin', 'en'], {
  usage: 'sort',
  ignorePunctuation: true,
  numeric: true,
  sensitivity: 'base',
});

type DisplayJob = Pick<Job, 'company' | 'id' | 'priority' | 'title'>;

const normalizeSortText = (value: string) => value.normalize('NFKC').trim();

export function compareJobsForDisplay(left: DisplayJob, right: DisplayJob) {
  return (priorityRank[left.priority] ?? 3) - (priorityRank[right.priority] ?? 3)
    || displayNameCollator.compare(normalizeSortText(left.company), normalizeSortText(right.company))
    || displayNameCollator.compare(normalizeSortText(left.title), normalizeSortText(right.title))
    || displayNameCollator.compare(left.id, right.id);
}

export function sortJobsForDisplay<T extends DisplayJob>(jobs: readonly T[]) {
  return [...jobs].sort(compareJobsForDisplay);
}
