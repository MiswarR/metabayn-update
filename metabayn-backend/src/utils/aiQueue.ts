
type Task<T> = () => Promise<T>;

interface QueueItem<T> {
  task: Task<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

// Global queue in memory (per worker instance)
const queue: QueueItem<any>[] = [];
let activeCount = 0;
// Cloudflare Workers often allow 6 concurrent subrequests. 
// OPTIMIZATION: Increased to 30 for high-throughput Flash models
// Cloudflare supports up to 50 subrequests on Standard plan.
const CONCURRENCY_LIMIT = 100; 

export function enqueue<T>(task: Task<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    // Add timeout to queue itself (prevent infinite waiting)
    const queueTimeout = setTimeout(() => {
        // Remove from queue if still waiting
        const index = queue.findIndex(i => i.resolve === resolve);
        if (index !== -1) {
            queue.splice(index, 1);
            reject(new Error("Queue Timeout: System busy, please retry."));
        }
    }, 10000);

    queue.push({ 
        task, 
        resolve: (val) => { clearTimeout(queueTimeout); resolve(val); }, 
        reject: (err) => { clearTimeout(queueTimeout); reject(err); } 
    });
    
    processQueue();
  });
}

function processQueue() {
  // While we have capacity and items in queue
  while (activeCount < CONCURRENCY_LIMIT && queue.length > 0) {
    const item = queue.shift();
    if (item) {
      activeCount++;
      
      // Execute task (Do NOT await here, let it run in background)
      item.task()
        .then((res) => {
            item.resolve(res);
        })
        .catch((err) => {
            item.reject(err);
        })
        .finally(() => {
            activeCount--;
            // When a task finishes, try to process the next one
            processQueue();
        });
    }
  }
}
