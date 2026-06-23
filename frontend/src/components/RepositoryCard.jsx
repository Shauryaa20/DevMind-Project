import React from 'react';
import { 
  GitBranch, 
  Calendar, 
  RefreshCw, 
  ExternalLink,
  FolderGit2
} from 'lucide-react';

const RepositoryCard = ({ repository, onReIndex, isIndexing }) => {
  const { owner, repo, fullName, defaultBranch, htmlUrl, lastIndexedAt, language } = repository;

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="repo-card card">
      <div className="repo-card-header">
        <div className="repo-icon-wrapper">
          <FolderGit2 size={20} className="repo-icon" />
        </div>
        <div className="repo-details">
          <h3 className="repo-title" title={fullName}>{repo}</h3>
          <span className="repo-owner">{owner}</span>
        </div>
        <span className="repo-badge">Indexed</span>
      </div>

      <div className="repo-card-meta">
        <div className="meta-item">
          <GitBranch size={14} className="meta-icon" />
          <span>{defaultBranch || 'main'}</span>
        </div>
        {language && (
          <div className="meta-item">
            <span className="language-indicator"></span>
            <span>{language}</span>
          </div>
        )}
      </div>

      <div className="repo-card-footer">
        <div className="indexed-time">
          <Calendar size={12} className="time-icon" />
          <span>Indexed: {formatDate(lastIndexedAt)}</span>
        </div>

        <div className="repo-card-actions">
          {htmlUrl && (
            <a 
              href={htmlUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="action-btn-icon"
              title="Open GitHub Repository"
            >
              <ExternalLink size={14} />
            </a>
          )}
          <button 
            onClick={() => onReIndex({ owner, repo, ref: defaultBranch })} 
            disabled={isIndexing}
            className={`action-btn-icon ${isIndexing ? 'spinning' : ''}`}
            title="Re-index Repository"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default RepositoryCard;
