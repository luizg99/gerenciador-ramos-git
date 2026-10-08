import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './views/App';
import { AppController } from './controllers/appController';
import './views/styles.css';
createRoot(document.getElementById('root')!).render(window.gitManager ? <App controller={new AppController(window.gitManager)} /> : <div className="browser-message"><h1>Gerenciador de Ramos</h1><p>Abra este aplicativo pelo Electron usando <code>npm run dev</code>.</p></div>);
