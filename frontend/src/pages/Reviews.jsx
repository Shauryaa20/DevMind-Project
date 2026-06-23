import React, { useEffect, useState } from 'react';
import { useApp } from '../hooks/useApp';
import ReviewTable from '../components/ReviewTable';
import { RefreshCw, Filter, AlertCircle } from 'lucide-react';

const Reviews = () => {
  const { 
    reviews, 
    repositories, 
    loading, 
    error, 
    fetchReviews, 
    fetchRepositories 
  } = useApp();

  const [selectedRepo, setSelectedRepo] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  useEffect(() => {
    fetchReviews();
    fetchRepositories();
  }, [fetchReviews, fetchRepositories]);

  // Handle local filtering
  const filteredReviews = reviews.filter((review) => {
    const matchesRepo = selectedRepo === 'all' || review.repository?.fullName === selectedRepo;
    const matchesStatus = selectedStatus === 'all' || (review.status || 'completed').toLowerCase() === selectedStatus.toLowerCase();
    return matchesRepo && matchesStatus;
  });

  return (
    <div className="page-container reviews-page">
      {/* Filtering Section */}
      <div className="filters-card card">
        <div className="filters-header">
          <div className="title-area">
            <Filter size={16} className="title-icon" />
            <h3>Filter Code Reviews</h3>
          </div>
          <button 
            onClick={() => fetchReviews(true)} 
            disabled={loading.reviews}
            className="refresh-list-btn"
            title="Sync Reviews"
          >
            <RefreshCw size={13} className={loading.reviews ? 'spinning' : ''} />
            <span>Sync Reviews</span>
          </button>
        </div>

        <div className="filters-row">
          <div className="filter-group">
            <label htmlFor="repo-select">Repository</label>
            <select
              id="repo-select"
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Indexed Repositories</option>
              {repositories.map((repo) => (
                <option key={repo._id} value={repo.fullName}>
                  {repo.fullName}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label htmlFor="status-select">Analysis Status</label>
            <select
              id="status-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="running">Running</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table Section */}
      <div className="reviews-table-section">
        {error.reviews && (
          <div className="form-alert error">
            <AlertCircle size={16} />
            <span>{error.reviews}</span>
          </div>
        )}

        <ReviewTable 
          reviews={filteredReviews} 
          isLoading={loading.reviews} 
        />
      </div>
    </div>
  );
};

export default Reviews;
