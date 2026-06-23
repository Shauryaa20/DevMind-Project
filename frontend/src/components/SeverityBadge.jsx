import React from 'react';

const SeverityBadge = ({ severity, count }) => {
  const getBadgeClass = () => {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 'badge-critical';
      case 'high':
        return 'badge-high';
      case 'medium':
        return 'badge-medium';
      case 'low':
        return 'badge-low';
      default:
        return 'badge-info';
    }
  };

  const getLabel = () => {
    return severity.charAt(0).toUpperCase() + severity.slice(1);
  };

  return (
    <span className={`severity-badge ${getBadgeClass()}`}>
      <span className="badge-dot"></span>
      <span className="badge-label">{getLabel()}</span>
      {count !== undefined && count > 0 && (
        <span className="badge-count">{count}</span>
      )}
    </span>
  );
};

export default SeverityBadge;
