const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const request = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const config = {
    ...options,
    headers,
  };

  try {
    const response = await fetch(url, config);
    const contentType = response.headers.get('content-type');
    
    let payload = null;
    if (contentType && contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }

    if (!response.ok) {
      const errorMessage = payload?.error || payload?.message || `Request failed with status ${response.status}`;
      throw new ApiError(errorMessage, response.status, payload);
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Network errors or fetch errors
    throw new ApiError('Unable to connect to the server. Please check if the backend is running.', 500, error.message);
  }
};

export const api = {
  /**
   * Fetch all indexed repositories.
   */
  getRepositories: async ({ page = 1, limit = 50 } = {}) => {
    return request(`/repositories?page=${page}&limit=${limit}`);
  },

  /**
   * Trigger indexing of a repository.
   * Can be either a local repository path or owner/repo GitHub names.
   */
  indexRepository: async ({ owner, repo, ref, repositoryPath, repositoryName, collectionName } = {}) => {
    return request('/repositories/index', {
      method: 'POST',
      body: JSON.stringify({
        owner,
        repo,
        ref,
        repositoryPath,
        repositoryName,
        collectionName,
      }),
    });
  },

  /**
   * Fetch all reviews, with optional pagination.
   */
  getReviews: async ({ page = 1, limit = 50 } = {}) => {
    return request(`/reviews?page=${page}&limit=${limit}`);
  },

  /**
   * Fetch detailed analysis and findings of a specific review.
   */
  getReviewById: async (id) => {
    if (!id) {
      throw new Error('Review ID is required to fetch details.');
    }
    return request(`/reviews/${id}`);
  },
};
export default api;
