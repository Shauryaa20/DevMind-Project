import React from 'react';
import ReviewRow from './ReviewRow';
import { Loader2, Inbox } from 'lucide-react';

const ReviewTable = ({ reviews, isLoading }) => {
  if (isLoading && reviews.length === 0) {
    return (
      <div className="table-loading">
        <Loader2 size={36} className="spinning" />
        <p>Loading code review records...</p>
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="table-empty card">
        <Inbox size={40} className="empty-icon" />
        <h3>No Code Reviews Found</h3>
        <p>There are no pull request reviews logged for the selected filter combination.</p>
      </div>
    );
  }

  return (
    <div className="table-responsive card">
      <table className="dashboard-table">
        <thead>
          <tr>
            <th className="col-repo">Repository & Pull Request</th>
            <th className="col-date">Reviewed At</th>
            <th className="col-status">Status</th>
            <th className="col-severity">Severity Breakdown</th>
            <th className="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map((review) => (
            <ReviewRow key={review._id} review={review} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ReviewTable;
