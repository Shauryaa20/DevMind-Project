import React from 'react';
import SeverityBadge from './SeverityBadge';
import { 
  GitBranch, 
  Calendar, 
  FileText, 
  ShieldAlert, 
  Cpu, 
  Sparkles,
  GitPullRequest
} from 'lucide-react';

const ReviewSummary = ({ review }) => {
  const { repository, pullRequest, severityReport, reviewedAt, createdAt } = review;

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const counts = severityReport?.summary?.counts || {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  const totalScore = severityReport?.summary?.totalScore ?? 0;
  const overallSeverity = severityReport?.summary?.overallSeverityLabel || 'Low';

  return (
    <div className="review-summary-card card">
      <div className="summary-header">
        <div className="summary-title-area">
          <div className="repo-icon-glow">
            <GitPullRequest size={24} />
          </div>
          <div className="title-texts">
            <h2>PR Review Details</h2>
            <span className="repo-path">
              {repository?.fullName} <span className="branch-sep">/</span> <span className="branch-name"><GitBranch size={12} /> {repository?.ref || 'main'}</span>
            </span>
          </div>
        </div>

        <div className="overall-score-badge">
          <span className="score-label">Overall Severity</span>
          <span className="score-value">{overallSeverity}</span>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-info-block">
          <div className="info-item">
            <Calendar size={14} className="info-icon" />
            <div className="info-texts">
              <span className="label">Analyzed At</span>
              <span className="value">{formatDate(reviewedAt || createdAt)}</span>
            </div>
          </div>
          <div className="info-item">
            <FileText size={14} className="info-icon" />
            <div className="info-texts">
              <span className="label">Pull Request</span>
              <span className="value">Pull Request #{pullRequest?.number}</span>
            </div>
          </div>
        </div>

        <div className="summary-metrics-block">
          <div className="metrics-header-text">Findings Severity Grid</div>
          <div className="metric-pills">
            <div className="metric-pill critical">
              <ShieldAlert size={14} />
              <span>Critical</span>
              <span className="val">{counts.critical}</span>
            </div>
            <div className="metric-pill high">
              <ShieldAlert size={14} />
              <span>High</span>
              <span className="val">{counts.high}</span>
            </div>
            <div className="metric-pill medium">
              <Cpu size={14} />
              <span>Medium</span>
              <span className="val">{counts.medium}</span>
            </div>
            <div className="metric-pill low">
              <Sparkles size={14} />
              <span>Low</span>
              <span className="val">{counts.low}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReviewSummary;
