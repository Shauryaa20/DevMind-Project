import React, { useState } from 'react';
import { useApp } from '../hooks/useApp';
import { 
  GitPullRequest, 
  FolderOpen, 
  Plus, 
  Loader2,
  AlertCircle
} from 'lucide-react';

const IndexRepositoryForm = ({ onSuccess }) => {
  const { triggerIndexing, loading, error } = useApp();
  const [activeTab, setActiveTab] = useState('github'); // 'github' or 'local'
  
  // GitHub Fields
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('');

  // Local Fields
  const [repositoryPath, setRepositoryPath] = useState('');
  const [repositoryName, setRepositoryName] = useState('');

  const [formError, setFormError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    const payload = {};
    if (activeTab === 'github') {
      if (!owner.trim() || !repo.trim()) {
        setFormError('GitHub owner and repository name are required.');
        return;
      }
      payload.owner = owner.trim();
      payload.repo = repo.trim();
      if (ref.trim()) payload.ref = ref.trim();
    } else {
      if (!repositoryPath.trim()) {
        setFormError('Local directory path is required.');
        return;
      }
      payload.repositoryPath = repositoryPath.trim();
      if (repositoryName.trim()) {
        payload.repositoryName = repositoryName.trim();
      }
    }

    try {
      const result = await triggerIndexing(payload);
      setSuccessMsg(result?.message || 'Repository successfully indexed!');
      // Reset fields
      setOwner('');
      setRepo('');
      setRef('');
      setRepositoryPath('');
      setRepositoryName('');
      
      if (onSuccess) {
        onSuccess(result?.data);
      }
    } catch (err) {
      setFormError(err.message || 'Indexing failed. Please check inputs and server connection.');
    }
  };

  return (
    <div className="index-form-card card">
      <div className="form-header">
        <h2>Index New Repository</h2>
        <p>Index codebase files into ChromaDB vector storage for context retrieval reviews.</p>
      </div>

      <div className="tab-buttons">
        <button
          type="button"
          onClick={() => { setActiveTab('github'); setFormError(null); setSuccessMsg(null); }}
          className={`tab-btn ${activeTab === 'github' ? 'active' : ''}`}
        >
          <GitPullRequest size={16} />
          <span>GitHub Repo</span>
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('local'); setFormError(null); setSuccessMsg(null); }}
          className={`tab-btn ${activeTab === 'local' ? 'active' : ''}`}
        >
          <FolderOpen size={16} />
          <span>Local Path</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="index-form">
        {activeTab === 'github' ? (
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="owner">GitHub Owner / Org</label>
              <input
                id="owner"
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g. facebook"
                disabled={loading.indexing}
              />
            </div>
            <div className="form-group">
              <label htmlFor="repo">Repository Name</label>
              <input
                id="repo"
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="e.g. react"
                disabled={loading.indexing}
              />
            </div>
            <div className="form-group">
              <label htmlFor="ref">Branch / Ref (Optional)</label>
              <input
                id="ref"
                type="text"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="e.g. main or commit SHA"
                disabled={loading.indexing}
              />
            </div>
          </div>
        ) : (
          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="path">Local Absolute Path</label>
              <input
                id="path"
                type="text"
                value={repositoryPath}
                onChange={(e) => setRepositoryPath(e.target.value)}
                placeholder="e.g. C:/Projects/my-app"
                disabled={loading.indexing}
              />
            </div>
            <div className="form-group">
              <label htmlFor="localName">Name Display (Optional)</label>
              <input
                id="localName"
                type="text"
                value={repositoryName}
                onChange={(e) => setRepositoryName(e.target.value)}
                placeholder="e.g. local/my-app"
                disabled={loading.indexing}
              />
            </div>
          </div>
        )}

        {formError && (
          <div className="form-alert error">
            <AlertCircle size={16} className="alert-icon" />
            <span>{formError}</span>
          </div>
        )}

        {successMsg && (
          <div className="form-alert success">
            <span>{successMsg}</span>
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading.indexing}
          className="submit-btn"
        >
          {loading.indexing ? (
            <>
              <Loader2 size={16} className="spinning" />
              <span>Indexing Codebase...</span>
            </>
          ) : (
            <>
              <Plus size={16} />
              <span>Index Codebase</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};

export default IndexRepositoryForm;
