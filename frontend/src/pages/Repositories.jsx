import React, { useEffect, useState } from 'react';
import { useApp } from '../hooks/useApp';
import IndexRepositoryForm from '../components/IndexRepositoryForm';
import RepositoryCard from '../components/RepositoryCard';
import { Loader2, RefreshCw, FolderSearch } from 'lucide-react';

const Repositories = () => {
  const { 
    repositories, 
    loading, 
    error, 
    fetchRepositories,
    triggerIndexing 
  } = useApp();

  const [activeReIndex, setActiveReIndex] = useState({});

  useEffect(() => {
    fetchRepositories();
  }, [fetchRepositories]);

  const handleReIndex = async ({ owner, repo, ref }) => {
    const key = `${owner}/${repo}`;
    setActiveReIndex((prev) => ({ ...prev, [key]: true }));
    try {
      await triggerIndexing({ owner, repo, ref });
    } catch (err) {
      console.error('Re-indexing failed:', err);
    } finally {
      setActiveReIndex((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div className="page-container repositories-page">
      {/* Top Section: Indexing Form */}
      <IndexRepositoryForm />

      {/* Bottom Section: Grid of Indexed Repos */}
      <div className="repos-section">
        <div className="section-header">
          <div className="title-area">
            <h2>Indexed Codebases</h2>
            <span className="count-badge">{repositories.length}</span>
          </div>
          <button 
            onClick={() => fetchRepositories(true)} 
            disabled={loading.repos}
            className="refresh-list-btn"
            title="Refresh repository list"
          >
            <RefreshCw size={14} className={loading.repos ? 'spinning' : ''} />
            <span>Sync List</span>
          </button>
        </div>

        {loading.repos && repositories.length === 0 ? (
          <div className="loading-state">
            <Loader2 size={40} className="spinning text-primary" />
            <p>Fetching repositories from database...</p>
          </div>
        ) : error.repos ? (
          <div className="error-state card">
            <h3>Failed to load repositories</h3>
            <p>{error.repos}</p>
            <button onClick={() => fetchRepositories(true)} className="retry-btn">
              Retry Sync
            </button>
          </div>
        ) : repositories.length === 0 ? (
          <div className="empty-state card">
            <div className="empty-icon-wrapper">
              <FolderSearch size={48} />
            </div>
            <h3>No Indexed Repositories</h3>
            <p>Index your first codebase using the form above to enable AI-powered pull request analysis.</p>
          </div>
        ) : (
          <div className="repos-grid">
            {repositories.map((repo) => (
              <RepositoryCard
                key={repo._id}
                repository={repo}
                onReIndex={handleReIndex}
                isIndexing={activeReIndex[`${repo.owner}/${repo.repo}`] || false}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Repositories;
