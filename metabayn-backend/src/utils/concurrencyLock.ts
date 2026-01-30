// Simple in-memory concurrency lock per worker instance
// Ensures a user only has limited active AI jobs at a time on this worker.

const activeJobs = new Map<number, Set<string>>(); // userId -> Set of lockIds

// Max job duration (TTL) just in case a job crashes or hangs without releasing lock
const LOCK_TTL_MS = 60 * 1000; // 1 minute
const MAX_CONCURRENT_JOBS = 5; // Allow up to 5 concurrent jobs

// Map to track creation time of locks for TTL cleanup
const lockTimestamps = new Map<string, number>();

export function acquireLock(userId: number): string | null {
  const now = Date.now();
  
  if (!activeJobs.has(userId)) {
    activeJobs.set(userId, new Set());
  }
  
  const userJobs = activeJobs.get(userId)!;

  // Cleanup expired locks first
  for (const lockId of userJobs) {
    const start = lockTimestamps.get(lockId);
    if (!start || (now - start > LOCK_TTL_MS)) {
      userJobs.delete(lockId);
      lockTimestamps.delete(lockId);
    }
  }

  if (userJobs.size >= MAX_CONCURRENT_JOBS) {
    return null; // Too many active jobs
  }

  const lockId = `${userId}_${now}_${Math.random().toString(36).substr(2, 9)}`;
  userJobs.add(lockId);
  lockTimestamps.set(lockId, now);
  
  return lockId;
}

export function releaseLock(userId: number, lockId: string): void {
  const userJobs = activeJobs.get(userId);
  if (userJobs) {
    userJobs.delete(lockId);
    lockTimestamps.delete(lockId);
    if (userJobs.size === 0) {
      activeJobs.delete(userId);
    }
  }
}
