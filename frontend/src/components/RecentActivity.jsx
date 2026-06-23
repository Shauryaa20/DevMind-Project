import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  GitPullRequest, 
  FolderGit2, 
  ChevronRight, 
  Calendar, 
  ExternalLink
} from 'lucide-react';
import SeverityBadge from './SeverityBadge';

const RecentActivity = ({ recentReviews = [], recentRepos = [] }) => {
  const navigate = useNavigate();

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusClass = (statusName) => {
    const name = (statusName || 'completed').toLowerCase();
    switch (name) {
      case 'completed': return 'status-pill completed';
      case 'failed': return 'status-pill failed';
      case 'running': return 'status-pill running pulsing';
      default: return 'status-pill pending pulsing';
    }
  };

  return (
    <div className="recent-activity-grid">
      {/* Recent Reviews Column */}
      <div className="recent-activity-card card">
        <div className="card-header-area">
          <h3>Recent Code Reviews</h3>
          <p>Latest pull request analyses conducted</p>
        </div>

        {recentReviews.length === 0 ? (
          <div className="activity-empty-state">
            <p>No recent code reviews found.</p>
          </div>
        ) : (
          <div className="activity-list">
            {recentReviews.map((review) => {
              const counts = review.severityReport?.summary?.counts || {
                critical: 0,
                high: 0,
                medium: 0,
                low: 0
              };
              const hasFindings = counts.critical > 0 || counts.high > 0 || counts.medium > 0 || counts.low > 0;

              return (
                <div 
                  key={review._id} 
                  className="activity-item clickable"
                  onClick={() => navigate(`/reviews/${review._id}`)}
                >
                  <div className="item-left">
                    <div className="item-icon-wrapper review-icon">
                      <GitPullRequest size={16} />
                    </div>
                    <div className="item-details">
                      <div className="item-title-row">
                        <span className="item-main-title">{review.repository?.fullName}</span>
                        <span className="item-subtitle">PR #{review.pullRequest?.number}</span>
                      </div>
                      <div className="item-meta">
                        <span className="item-time">
                          <Calendar size={11} /> {formatDate(review.reviewedAt || review.createdAt)}
                        </span>
                        <span className={getStatusClass(review.status)}>
                          {review.status || 'Completed'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="item-right">
                    <div className="activity-severities">
                      {counts.critical > 0 && <SeverityBadge severity="critical" count={counts.critical} />}
                      {counts.high > 0 && <SeverityBadge severity="high" count={counts.high} />}
                      {!hasFindings && <span className="no-findings-short">Clean</span>}
                    </div>
                    <ChevronRight size={16} className="chevron-arrow" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Repositories Column */}
      <div className="recent-activity-card card">
        <div className="card-header-area">
          <h3>Recent Repository Activity</h3>
          <p>Latest indexed codebases in local / GitHub</p>
        </div>

        {recentRepos.length === 0 ? (
          <div className="activity-empty-state">
            <p>No indexed repositories found.</p>
          </div>
        ) : (
          <div className="activity-list">
            {recentRepos.map((repo) => (
              <div 
                key={repo._id} 
                className="activity-item clickable"
                onClick={() => navigate('/repositories')}
              >
                <div className="item-left">
                  <div className="item-icon-wrapper repo-icon">
                    <FolderGit2 size={16} />
                  </div>
                  <div className="item-details">
                    <div className="item-title-row">
                      <span className="item-main-title">{repo.repo}</span>
                      <span className="item-subtitle">{repo.owner}</span>
                    </div>
                    <div className="item-meta">
                      <span className="item-time">
                        <Calendar size={11} /> Indexed: {formatDate(repo.lastIndexedAt)}
                      </span>
                      {repo.language && (
                        <span className="repo-lang-badge">
                          {repo.language}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="item-right">
                  {repo.htmlUrl && (
                    <a 
                      href={repo.htmlUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="action-btn-icon"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                  <ChevronRight size={16} className="chevron-arrow" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RecentActivity;
