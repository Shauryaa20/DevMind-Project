import React, { useEffect, useMemo } from 'react';
import { useApp } from '../hooks/useApp';
import StatsGrid from '../components/StatsGrid';
import SeverityDistribution from '../components/SeverityDistribution';
import RecentActivity from '../components/RecentActivity';
import { RefreshCw, LayoutDashboard, Terminal, AlertCircle } from 'lucide-react';

const SystemOverview = () => {
  const {
    repositories,
    reviews,
    loading,
    error,
    fetchRepositories,
    fetchReviews
  } = useApp();

  useEffect(() => {
    fetchRepositories();
    fetchReviews();
  }, [fetchRepositories, fetchReviews]);

  const handleRefresh = async () => {
    await Promise.all([
      fetchRepositories(true),
      fetchReviews(true)
    ]);
  };

  // derived state calculations
  const stats = useMemo(() => {
    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;

    reviews.forEach((review) => {
      const counts = review.severityReport?.summary?.counts || {};
      critical += counts.critical || 0;
      high += counts.high || 0;
      medium += counts.medium || 0;
      low += counts.low || 0;
    });

    return {
      totalRepos: repositories.length,
      totalReviews: reviews.length,
      critical,
      high,
      medium,
      low
    };
  }, [repositories, reviews]);

  const recentReviews = useMemo(() => {
    return [...reviews]
      .sort((a, b) => new Date(b.reviewedAt || b.createdAt) - new Date(a.reviewedAt || a.createdAt))
      .slice(0, 5);
  }, [reviews]);

  const recentRepos = useMemo(() => {
    return [...repositories]
      .sort((a, b) => new Date(b.lastIndexedAt || 0) - new Date(a.lastIndexedAt || 0))
      .slice(0, 5);
  }, [repositories]);

  const isGlobalLoading = (loading.repos && repositories.length === 0) || (loading.reviews && reviews.length === 0);

  if (isGlobalLoading) {
    return (
      <div className="loading-state">
        <RefreshCw size={36} className="spinning" style={{ color: 'var(--accent-blue)' }} />
        <p>Loading System Dashboard Overview...</p>
      </div>
    );
  }

  return (
    <div className="page-container system-overview-page">
      {/* Overview Header */}
      <div className="overview-header-row">
        <div className="title-area">
          <LayoutDashboard size={20} className="title-icon" style={{ color: 'var(--accent-purple)' }} />
          <div>
            <h2>System Overview</h2>
            <p className="subtitle">Real-time status of code review queues and security audit metrics</p>
          </div>
        </div>
        <button 
          onClick={handleRefresh}
          className="refresh-list-btn"
          disabled={loading.repos || loading.reviews}
          title="Refresh Dashboard"
        >
          <RefreshCw size={13} className={loading.repos || loading.reviews ? 'spinning' : ''} />
          <span>Sync Dashboard</span>
        </button>
      </div>

      {/* Error alert banner */}
      {(error.repos || error.reviews) && (
        <div className="form-alert error">
          <AlertCircle size={16} />
          <span>{error.repos || error.reviews}</span>
        </div>
      )}

      {/* KPI Stats Grid */}
      <StatsGrid 
        totalRepos={stats.totalRepos}
        totalReviews={stats.totalReviews}
        criticalCount={stats.critical}
        highCount={stats.high}
        mediumCount={stats.medium}
        lowCount={stats.low}
      />

      {/* Severity distribution section & Quick Info card */}
      <div className="dashboard-middle-section">
        <div className="middle-col-left">
          <SeverityDistribution 
            critical={stats.critical}
            high={stats.high}
            medium={stats.medium}
            low={stats.low}
          />
        </div>
        
        <div className="middle-col-right card info-intro-card">
          <div className="intro-card-header">
            <Terminal size={18} className="intro-icon" />
            <h3>DevMind Audit Platform</h3>
          </div>
          <div className="intro-body">
            <p>
              Welcome to the DevMind Control Panel. Our multi-agent LLM analysis runs static code inspections covering:
            </p>
            <ul className="intro-list">
              <li>
                <span className="dot sec"></span>
                <strong>Security Agent:</strong> Explores OWASP Top 10 vulnerabilities, API token exposure, and dependency bugs.
              </li>
              <li>
                <span className="dot perf"></span>
                <strong>Performance Agent:</strong> Targets memory leaks, unoptimized database calls, and computational overhead.
              </li>
              <li>
                <span className="dot qual"></span>
                <strong>Code Quality Agent:</strong> Evaluates structure linting, modular design, clean naming, and testing coverage.
              </li>
            </ul>
            <p className="intro-footer-text">
              Active reviews run dynamically from GitHub Webhook actions. To register and trigger manual indexes, navigate to the Repositories tab.
            </p>
          </div>
        </div>
      </div>

      {/* Recent activities section */}
      <RecentActivity 
        recentReviews={recentReviews}
        recentRepos={recentRepos}
      />
    </div>
  );
};

export default SystemOverview;
