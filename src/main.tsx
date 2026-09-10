import React from 'react';
import ReactDOM from 'react-dom/client';
import { VizApp } from './viz/VizApp';
import './viz/viz.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VizApp />
  </React.StrictMode>,
);
