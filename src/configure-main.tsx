import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigureApp } from './configure/ConfigureApp';
import './configure/configure.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigureApp />
  </React.StrictMode>,
);
