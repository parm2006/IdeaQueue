import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ConnectAgent } from './components/ConnectAgent';
import { pendingConnection } from './lib/agentConnection';
import './styles.css';
const connecting = window.location.pathname === '/connect' || !!pendingConnection();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{connecting ? <ConnectAgent/> : <App/>}</React.StrictMode>);
