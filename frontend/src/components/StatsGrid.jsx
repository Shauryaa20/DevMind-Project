import React from 'react';
import { FolderGit2, History, AlertOctagon, ShieldAlert, AlertTriangle, Info } from 'lucide-react';

const StatsGrid = ({ totalRepos, totalReviews, criticalCount, highCount, mediumCount, lowCount }) => {
  const stats = [
    {
      title: 'Monitored Repositories',
      value: totalRepos,
      icon: FolderGit2,
      iconColor: 'var(--accent-blue)',
      description: 'Indexed codebases in ChromaDB'
    },
    {
      title: 'Total Reviews',
      value: totalReviews,
      icon: History,
      iconColor: 'var(--accent-purple)',
      description: 'Reviews logged in MongoDB'
    },
    {
      title: 'Critical Findings',
      value: criticalCount,
      icon: ShieldAlert,
      iconColor: 'var(--text-critical)',
      description: 'Require immediate resolution'
    },
    {
      title: 'High Findings',
      value: highCount,
      icon: AlertOctagon,
      iconColor: 'var(--text-high)',
      description: 'Important fixes requested'
    },
    {
      title: 'Medium Findings',
      value: mediumCount,
      icon: AlertTriangle,
      iconColor: 'var(--text-medium)',
      description: 'Moderate issues detected'
    },
    {
      title: 'Low Findings',
      value: lowCount,
      icon: Info,
      iconColor: 'var(--text-low)',
      description: 'Optimizations & minor issues'
    }
  ];

  return (
    <div className="stats-grid">
      {stats.map((stat, idx) => {
        const Icon = stat.icon;
        return (
          <div key={idx} className="stat-card card">
            <div className="stat-card-header">
              <span className="stat-title">{stat.title}</span>
              <div 
                className="stat-icon-wrapper" 
                style={{ color: stat.iconColor, background: `rgba(255, 255, 255, 0.02)` }}
              >
                <Icon size={16} />
              </div>
            </div>
            <div className="stat-card-value">{stat.value}</div>
            <span className="stat-description">{stat.description}</span>
          </div>
        );
      })}
    </div>
  );
};

export default StatsGrid;
