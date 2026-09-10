import React from 'react';
import ReactDOM from 'react-dom/client';
import { DashboardApp } from './dashboard/DashboardApp';
import './dashboard/dashboard.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>,
);
