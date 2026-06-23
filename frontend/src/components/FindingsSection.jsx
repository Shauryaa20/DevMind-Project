import React, { useState } from 'react';
import FindingCard from './FindingCard';
import { 
  ShieldAlert, 
  Cpu, 
  Sparkles, 
  CheckCircle2 
} from 'lucide-react';

const FindingsSection = ({ findings }) => {
  const [activeCategory, setActiveCategory] = useState('security');

  // Categorize findings
  const securityFindings = findings.filter((f) => {
    const isSecCat = ['authentication', 'authorization', 'sql-injection', 'xss', 'secrets'].includes((f.category || '').toLowerCase());
    const isSecSrc = f.sources?.includes('security') || f.reports?.includes('security') || f.agent === 'security';
    return isSecCat || isSecSrc;
  });

  const performanceFindings = findings.filter((f) => {
    const isPerfCat = ['expensive-loops', 'inefficient-operations', 'repeated-queries'].includes((f.category || '').toLowerCase());
    const isPerfSrc = f.sources?.includes('performance') || f.reports?.includes('performance') || f.agent === 'performance';
    return isPerfCat || isPerfSrc;
  });

  const qualityFindings = findings.filter((f) => {
    const isQualCat = ['naming', 'readability', 'maintainability', 'error-handling'].includes((f.category || '').toLowerCase());
    const isQualSrc = f.sources?.includes('quality') || f.reports?.includes('quality') || f.agent === 'quality';
    return isQualCat || isQualSrc;
  });

  const getActiveList = () => {
    switch (activeCategory) {
      case 'security':
        return securityFindings;
      case 'performance':
        return performanceFindings;
      case 'quality':
        return qualityFindings;
      default:
        return [];
    }
  };

  const currentFindings = getActiveList();

  const getTabLabel = (category) => {
    switch (category) {
      case 'security':
        return (
          <>
            <ShieldAlert size={14} />
            <span>Security</span>
            <span className="count-tag">{securityFindings.length}</span>
          </>
        );
      case 'performance':
        return (
          <>
            <Cpu size={14} />
            <span>Performance</span>
            <span className="count-tag">{performanceFindings.length}</span>
          </>
        );
      case 'quality':
        return (
          <>
            <Sparkles size={14} />
            <span>Code Quality</span>
            <span className="count-tag">{qualityFindings.length}</span>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="findings-section">
      <div className="findings-tabs-card card">
        <div className="tabs-list">
          <button
            onClick={() => setActiveCategory('security')}
            className={`tab-link ${activeCategory === 'security' ? 'active' : ''}`}
          >
            {getTabLabel('security')}
          </button>
          <button
            onClick={() => setActiveCategory('performance')}
            className={`tab-link ${activeCategory === 'performance' ? 'active' : ''}`}
          >
            {getTabLabel('performance')}
          </button>
          <button
            onClick={() => setActiveCategory('quality')}
            className={`tab-link ${activeCategory === 'quality' ? 'active' : ''}`}
          >
            {getTabLabel('quality')}
          </button>
        </div>
      </div>

      <div className="findings-list">
        {currentFindings.length === 0 ? (
          <div className="findings-success card">
            <div className="success-icon-wrapper">
              <CheckCircle2 size={40} />
            </div>
            <h4>No Issues Found</h4>
            <p>
              The code audit returned zero concerns for this category. Core patterns look secure and optimized!
            </p>
          </div>
        ) : (
          <div className="findings-grid">
            {currentFindings.map((finding, index) => (
              <FindingCard key={index} finding={finding} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FindingsSection;
