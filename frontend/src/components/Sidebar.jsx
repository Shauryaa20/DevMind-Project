import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  GitBranch, 
  History, 
  Terminal, 
  AlertCircle,
  CheckCircle2
} from 'lucide-react';

const Sidebar = () => {
  const [backendStatus, setBackendStatus] = useState('checking');

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
        const healthUrl = apiBase.endsWith('/api') ? apiBase.replace(/\/api$/, '/health') : `${apiBase}/health`;
        const res = await fetch(healthUrl);
        const data = await res.json();
        if (data.status === 'ok') {
          setBackendStatus('online');
        } else {
          setBackendStatus('offline');
        }
      } catch (err) {
        setBackendStatus('offline');
      }
    };
    checkStatus();
    // Check every 30s
    const timer = setInterval(checkStatus, 30000);
    return () => clearInterval(timer);
  }, []);

  const navItems = [
    { to: '/', label: 'System Overview', icon: LayoutDashboard },
    { to: '/repositories', label: 'Repositories', icon: GitBranch },
    { to: '/reviews', label: 'Review History', icon: History },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="logo-icon">
          <Terminal size={20} />
        </div>
        <div className="logo-text">
          <h2>DevMind</h2>
          <span>GitHub Review Agent</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => 
                `nav-item ${isActive ? 'active' : ''}`
              }
            >
              <Icon size={18} className="nav-icon" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="status-indicator">
          {backendStatus === 'online' ? (
            <span className="status-badge online">
              <CheckCircle2 size={12} />
              <span>API Online</span>
            </span>
          ) : backendStatus === 'offline' ? (
            <span className="status-badge offline">
              <AlertCircle size={12} />
              <span>API Offline</span>
            </span>
          ) : (
            <span className="status-badge checking">
              <span className="pulse-dot"></span>
              <span>Checking...</span>
            </span>
          )}
        </div>
        <div className="footer-meta">
          <span>v1.0.0</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
