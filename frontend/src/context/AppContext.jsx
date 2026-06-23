import React, { createContext, useState, useCallback, useRef, useEffect } from 'react';
import api from '../services/api';

export const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [repositories, setRepositories] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [selectedReview, setSelectedReview] = useState(null);
  
  // Grouped loading states
  const [loading, setLoading] = useState({
    repos: false,
    reviews: false,
    selectedReview: false,
    indexing: false,
  });

  // Grouped error states
  const [error, setError] = useState({
    repos: null,
    reviews: null,
    selectedReview: null,
    indexing: null,
  });

  // Utility to set specific loading keys
  const updateLoading = (key, val) => {
    setLoading((prev) => ({ ...prev, [key]: val }));
  };

  // Utility to set specific error keys
  const updateError = (key, val) => {
    setError((prev) => ({ ...prev, [key]: val }));
  };

  // Shadow state refs to enable stable callback dependency arrays (avoiding infinite re-render loops)
  const reposRef = useRef(repositories);
  const reviewsRef = useRef(reviews);
  const selectedReviewRef = useRef(selectedReview);

  // Active query status trackers to prevent concurrent duplicate HTTP requests
  const fetchingReposRef = useRef(false);
  const fetchingReviewsRef = useRef(false);
  const fetchingReviewDetailsIdRef = useRef(null);
  const indexingRef = useRef(false);

  useEffect(() => {
    reposRef.current = repositories;
  }, [repositories]);

  useEffect(() => {
    reviewsRef.current = reviews;
  }, [reviews]);

  useEffect(() => {
    selectedReviewRef.current = selectedReview;
  }, [selectedReview]);

  /**
   * Fetches repositories if not already loaded or force flag is set.
   */
  const fetchRepositories = useCallback(async (force = false) => {
    if (fetchingReposRef.current) return;
    if (reposRef.current.length > 0 && !force) {
      return; // Avoid duplicate load
    }

    fetchingReposRef.current = true;
    updateLoading('repos', true);
    updateError('repos', null);

    try {
      const res = await api.getRepositories();
      setRepositories(res?.data || []);
    } catch (err) {
      updateError('repos', err.message || 'Failed to fetch repositories.');
    } finally {
      updateLoading('repos', false);
      fetchingReposRef.current = false;
    }
  }, []);

  /**
   * Fetches reviews if not already loaded or force flag is set.
   */
  const fetchReviews = useCallback(async (force = false) => {
    if (fetchingReviewsRef.current) return;
    if (reviewsRef.current.length > 0 && !force) {
      return; // Avoid duplicate load
    }

    fetchingReviewsRef.current = true;
    updateLoading('reviews', true);
    updateError('reviews', null);

    try {
      const res = await api.getReviews();
      setReviews(res?.data || []);
    } catch (err) {
      updateError('reviews', err.message || 'Failed to fetch reviews.');
    } finally {
      updateLoading('reviews', false);
      fetchingReviewsRef.current = false;
    }
  }, []);

  /**
   * Fetches detailed review by ID.
   */
  const fetchReviewDetails = useCallback(async (id, force = false) => {
    if (!id) return;
    if (fetchingReviewDetailsIdRef.current === id) return;
    if (selectedReviewRef.current?._id === id && !force) {
      return selectedReviewRef.current; // Already loaded, avoid duplicate fetch
    }

    fetchingReviewDetailsIdRef.current = id;
    updateLoading('selectedReview', true);
    updateError('selectedReview', null);

    try {
      const res = await api.getReviewById(id);
      const detailData = res?.data || null;
      setSelectedReview(detailData);
      return detailData;
    } catch (err) {
      updateError('selectedReview', err.message || 'Failed to fetch review details.');
      throw err;
    } finally {
      updateLoading('selectedReview', false);
      fetchingReviewDetailsIdRef.current = null;
    }
  }, []);

  /**
   * Triggers repo indexing and updates the repositories list.
   */
  const triggerIndexing = useCallback(async (params) => {
    if (indexingRef.current) return;
    indexingRef.current = true;
    updateLoading('indexing', true);
    updateError('indexing', null);

    try {
      const res = await api.indexRepository(params);
      const newRepo = res?.data?.repository;
      
      // Auto-update repositories list locally to avoid full page reload
      if (newRepo) {
        setRepositories((prev) => {
          const index = prev.findIndex((r) => r._id === newRepo._id);
          if (index !== -1) {
            const updated = [...prev];
            updated[index] = newRepo;
            return updated;
          }
          return [newRepo, ...prev];
        });
      } else {
        // Fallback refetch
        await fetchRepositories(true);
      }
      return res;
    } catch (err) {
      updateError('indexing', err.message || 'Indexing failed.');
      throw err;
    } finally {
      updateLoading('indexing', false);
      indexingRef.current = false;
    }
  }, [fetchRepositories]);

  /**
   * Clears the active selected review (e.g. when unmounting the details page).
   */
  const clearSelectedReview = useCallback(() => {
    setSelectedReview(null);
    updateError('selectedReview', null);
  }, []);

  return (
    <AppContext.Provider
      value={{
        repositories,
        reviews,
        selectedReview,
        loading,
        error,
        fetchRepositories,
        fetchReviews,
        fetchReviewDetails,
        triggerIndexing,
        clearSelectedReview,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
export default AppContext;
