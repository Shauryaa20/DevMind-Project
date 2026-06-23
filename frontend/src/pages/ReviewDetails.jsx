import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApp } from '../hooks/useApp';
import ReviewSummary from '../components/ReviewSummary';
import FindingsSection from '../components/FindingsSection';
import { Loader2, ArrowLeft, AlertCircle } from 'lucide-react';

const ReviewDetails = () => {
  const { id } = useParams();
  const { 
    selectedReview, 
    loading, 
    error, 
    fetchReviewDetails, 
    clearSelectedReview 
  } = useApp();

  useEffect(() => {
    fetchReviewDetails(id);
    return () => {
      clearSelectedReview();
    };
  }, [id, fetchReviewDetails, clearSelectedReview]);

  return (
    <div className="page-container review-details-page">
      <div className="details-navigation">
        <Link to="/reviews" className="back-link-btn">
          <ArrowLeft size={14} />
          <span>Back to Reviews</span>
        </Link>
      </div>

      {loading.selectedReview && !selectedReview ? (
        <div className="loading-state">
          <Loader2 size={40} className="spinning text-primary" />
          <p>Compiling analysis findings and loading reports...</p>
        </div>
      ) : error.selectedReview ? (
        <div className="error-state card">
          <div className="error-icon-wrapper">
            <AlertCircle size={40} className="text-critical" />
          </div>
          <h3>Failed to load review analysis</h3>
          <p>{error.selectedReview}</p>
          <div className="error-actions">
            <button onClick={() => fetchReviewDetails(id, true)} className="retry-btn">
              Retry Load
            </button>
            <Link to="/reviews" className="retry-btn secondary">
              Back to History
            </Link>
          </div>
        </div>
      ) : !selectedReview ? (
        <div className="empty-state card">
          <h3>Review Report Not Found</h3>
          <p>The review analysis record you are trying to view does not exist in the database.</p>
          <Link to="/reviews" className="retry-btn">
            Back to Reviews
          </Link>
        </div>
      ) : (
        <div className="details-content">
          {/* Top Panel: Summary Metadata */}
          <ReviewSummary review={selectedReview} />

          {/* Bottom Tabs & Accordions List of Issues */}
          <FindingsSection findings={selectedReview.findings || []} />
        </div>
      )}
    </div>
  );
};

export default ReviewDetails;
