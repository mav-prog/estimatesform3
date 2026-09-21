// Browser-mode stand-in for utils/pdfCache.ts. The desktop build caches
// rendered page images on disk; here a small in-memory cache does the job.
const MAX_ENTRIES = 64;
const cache = new Map<string, Blob>();

export const ensureCacheDir = async () => {
  return;
};

export const getPageImage = async (fileId: string, pageIndex: number): Promise<Blob | null> => {
  return cache.get(`${fileId}:${pageIndex}`) ?? null;
};

export const savePageImage = async (fileId: string, pageIndex: number, blob: Blob): Promise<void> => {
  const key = `${fileId}:${pageIndex}`;
  cache.delete(key);
  cache.set(key, blob);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};
