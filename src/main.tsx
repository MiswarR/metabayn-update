import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'

// Visual debug: Ensure JS is running
console.log('React App Mounting...');

try {
  const root = createRoot(document.getElementById('root')!);
  root.render(<App />);
} catch (e) {
  console.error("Fatal Error Mounting React:", e);
  document.body.innerHTML = `<div style="padding:20px;color:red"><h1>Fatal Error</h1><pre>${String(e)}</pre></div>`;
}
