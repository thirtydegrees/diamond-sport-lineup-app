import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { SingleWriter } from './components/SingleWriter';

// Diagnostic metadata only; never rendered in the coach interface.
document.documentElement.dataset.build = __BUILD_ID__;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SingleWriter><App /></SingleWriter>
  </React.StrictMode>
);
