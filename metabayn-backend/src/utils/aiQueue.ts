
type Task<T> = () => Promise<T>;

interface QueueItem<T> {
  task: Task<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

type QueueState = {
  queue: QueueItem<any>[];
  activeCount: number;
  concurrencyLimit: number;
};

const queues = new Map<string, QueueState>();

function getState(key: string): QueueState {
  const k = key || 'default';
  const existing = queues.get(k);
  if (existing) return existing;

  const created: QueueState = {
    queue: [],
    activeCount: 0,
    concurrencyLimit: 3
  };
  queues.set(k, created);
  return created;
}

export function enqueue<T>(task: Task<T>, queueKey: string = 'default'): Promise<T> {
  return new Promise((resolve, reject) => {
    const state = getState(queueKey);
    
    // Create item first to reference it
    let item: any; // Forward declaration
    
    // Add timeout to queue itself (prevent infinite waiting)
    const queueTimeout = setTimeout(() => {
        // Remove from queue if still waiting
        if (item) {
            const index = state.queue.indexOf(item);
            if (index !== -1) {
                state.queue.splice(index, 1);
                reject(new Error("Queue Timeout: System busy, please retry."));
            }
        }
    }, 10000);

    item = { 
        task, 
        resolve: (val: T) => { clearTimeout(queueTimeout); resolve(val); }, 
        reject: (err: any) => { clearTimeout(queueTimeout); reject(err); } 
    };

    state.queue.push(item);
    
    processQueue(queueKey);
  });
}

function processQueue(queueKey: string) {
  const state = getState(queueKey);
  // While we have capacity and items in queue
  while (state.activeCount < state.concurrencyLimit && state.queue.length > 0) {
    const item = state.queue.shift();
    if (item) {
      state.activeCount++;
      
      // Execute task (Do NOT await here, let it run in background)
      // Note: item.task is expected to return a Promise
      Promise.resolve(item.task())
        .then((res) => {
            item.resolve(res);
        })
        .catch((err) => {
            item.reject(err);
        })
        .finally(() => {
            state.activeCount--;
            // When a task finishes, try to process the next one
            processQueue(queueKey);
        });
    }
  }
}

export function setConcurrencyLimit(n: number, queueKey: string = 'default') {
  if (typeof n === 'number' && n > 0) {
    const state = getState(queueKey);
    state.concurrencyLimit = n;
  }
}
