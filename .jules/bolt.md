## 2025-05-22 - Stable Keys for Memoization in High-Frequency List Rendering
**Learning:** In this application, batch processing generates a high volume of logs (up to 2,000 entries) with frequent status updates (e.g., from 'processing' to 'success'). Without stable IDs, React re-renders the entire list on every update, causing significant UI jank during high-concurrency tasks.
**Action:** Always ensure log entries are generated with unique stable IDs at the source (Dashboard.tsx) and use a memoized component (LogLine) with these IDs as keys to isolate re-renders to only the affected items.
