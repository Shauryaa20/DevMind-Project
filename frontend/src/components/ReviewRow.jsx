import React from 'react';
import { useNavigate } from 'react-router-dom';
import SeverityBadge from './SeverityBadge';
import { 
  GitPullRequest, 
  ChevronRight, 
  Calendar,
  AlertOctagon,
  Play,
  CheckCircle2,
  XCircle
} from 'lucide-react';

const ReviewRow = ({ review }) => {
  const navigate = useNavigate();
  const { _id, repository, pullRequest, status, severityReport, reviewedAt, createdAt } = review;

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (statusName) => {
    const name = (statusName || 'completed').toLowerCase();
    switch (name) {
      case 'completed':
        return (
          <span className="status-pill completed">
            <CheckCircle2 size={12} />
            <span>Completed</span>
          </span>
        );
      case 'failed':
        return (
          <span className="status-pill failed">
            <XCircle size={12} />
            <span>Failed</span>
          </span>
        );
      case 'running':
        return (
          <span className="status-pill running">
            <Play size={12} className="pulsing" />
            <span>Running</span>
          </span>
        );
      default:
        return (
          <span className="status-pill pending">
            <AlertOctagon size={12} className="pulsing" />
            <span>Pending</span>
          </span>
        );
    }
  };

  // Extract counts from severityReport or fallback
  const counts = severityReport?.summary?.counts || {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  const handleRowClick = () => {
    navigate(`/reviews/${_id}`);
  };

  return (
    <tr className="review-row" onClick={handleRowClick}>
      <td className="col-repo">
        <div className="repo-info-cell">
          <div className="repo-icon">
            <GitPullRequest size={16} />
          </div>
          <div className="repo-texts">
            <span className="repo-name">{repository?.fullName}</span>
            <span className="pr-number">PR #{pullRequest?.number}</span>
          </div>
        </div>
      </td>

      <td className="col-date">
        <div className="date-cell">
          <Calendar size={13} className="cell-icon" />
          <span>{formatDate(reviewedAt || createdAt)}</span>
        </div>
      </td>

      <td className="col-status">
        {getStatusBadge(status)}
      </td>

      <td className="col-severity">
        <div className="severities-summary">
          {counts.critical > 0 && <SeverityBadge severity="critical" count={counts.critical} />}
          {counts.high > 0 && <SeverityBadge severity="high" count={counts.high} />}
          {counts.medium > 0 && <SeverityBadge severity="medium" count={counts.medium} />}
          {counts.low > 0 && <SeverityBadge severity="low" count={counts.low} />}
          {counts.critical === 0 && counts.high === 0 && counts.medium === 0 && counts.low === 0 && (
            <span className="no-findings">No issues detected</span>
          )}
        </div>
      </td>

      <td className="col-actions">
        <button className="row-action-btn">
          <span>Analyze</span>
          <ChevronRight size={14} />
        </button>
      </td>
    </tr>
  );
};

export default ReviewRow;
