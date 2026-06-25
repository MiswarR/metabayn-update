## 2025-05-14 - [Log Panel Optimization]
**Learning:** High-frequency state updates in React lists (like log panels) where every item re-renders on every update causes significant "jank" as the list grows (e.g., up to 2000 entries). Using stable unique IDs for keys and memoizing individual list items (`LogLine`) prevents unnecessary re-renders of the entire list.
**Action:** Always use stable unique IDs for list keys and memoize items in high-frequency rendering paths.
