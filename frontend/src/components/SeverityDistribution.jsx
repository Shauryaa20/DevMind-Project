import React from 'react';

const SeverityDistribution = ({ critical, high, medium, low }) => {
  const total = critical + high + medium + low;

  const getPercentage = (count) => {
    if (total === 0) return 0;
    return Math.round((count / total) * 100);
  };

  const distributions = [
    {
      label: 'Critical Severity',
      count: critical,
      percent: getPercentage(critical),
      color: 'var(--text-critical)',
      bg: 'rgba(248, 113, 113, 0.1)'
    },
    {
      label: 'High Severity',
      count: high,
      percent: getPercentage(high),
      color: 'var(--text-high)',
      bg: 'rgba(251, 191, 36, 0.1)'
    },
    {
      label: 'Medium Severity',
      count: medium,
      percent: getPercentage(medium),
      color: 'var(--text-medium)',
      bg: 'rgba(56, 189, 248, 0.1)'
    },
    {
      label: 'Low Severity',
      count: low,
      percent: getPercentage(low),
      color: 'var(--text-low)',
      bg: 'rgba(52, 211, 153, 0.1)'
    }
  ];

  return (
    <div className="severity-distribution-card card">
      <div className="card-header-area">
        <h3>Findings Severity Distribution</h3>
        <p>Proportion of issues identified across all code reviews</p>
      </div>

      {total === 0 ? (
        <div className="distribution-empty-state">
          <div className="clean-status-pulse"></div>
          <p>No issues detected across monitored repositories.</p>
        </div>
      ) : (
        <div className="distribution-bars">
          {distributions.map((item, idx) => (
            <div key={idx} className="dist-row">
              <div className="dist-labels">
                <span className="dist-name">{item.label}</span>
                <span className="dist-count" style={{ color: item.color }}>
                  {item.count} {item.count === 1 ? 'issue' : 'issues'}
                </span>
              </div>
              <div className="bar-track" style={{ background: 'var(--bg-primary)' }}>
                <div 
                  className="bar-fill" 
                  style={{ 
                    width: `${item.percent}%`, 
                    backgroundColor: item.color,
                    boxShadow: `0 0 10px ${item.color}33`
                  }}
                ></div>
              </div>
              <div className="dist-percent">{item.percent}%</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SeverityDistribution;
