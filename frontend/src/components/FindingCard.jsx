import React, { useState } from 'react';
import SeverityBadge from './SeverityBadge';
import { 
  ChevronDown, 
  ChevronUp, 
  Lightbulb, 
  FileCode,
  Gauge
} from 'lucide-react';

const FindingCard = ({ finding }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { 
    title, 
    severity, 
    category, 
    description, 
    evidence, 
    filePath, 
    confidence, 
    recommendation,
    lineStart,
    lineEnd
  } = finding;

  const toggleOpen = () => setIsOpen(!isOpen);

  const renderEvidence = (diffText) => {
    if (!diffText) return null;
    const lines = diffText.split('\n');
    return (
      <pre className="diff-pre">
        <code>
          {lines.map((line, idx) => {
            let lineClass = '';
            if (line.startsWith('+')) lineClass = 'line-added';
            else if (line.startsWith('-')) lineClass = 'line-removed';
            else if (line.startsWith('@@')) lineClass = 'line-hunk';
            return (
              <div key={idx} className={`diff-line ${lineClass}`}>
                <span className="line-text">{line}</span>
              </div>
            );
          })}
        </code>
      </pre>
    );
  };

  const getConfidencePercentage = (val) => {
    if (!val) return '70%';
    const pct = val <= 1 ? val * 100 : val;
    return `${Math.round(pct)}%`;
  };

  return (
    <div className={`finding-card card ${isOpen ? 'open' : ''}`}>
      <div className="finding-header" onClick={toggleOpen}>
        <div className="finding-title-section">
          <SeverityBadge severity={severity} />
          <div className="title-texts">
            <h4 className="finding-title">{title}</h4>
            <span className="finding-meta">
              <FileCode size={12} /> {filePath || 'Unknown File'} 
              {lineStart && ` : L${lineStart}${lineEnd ? `-L${lineEnd}` : ''}`}
            </span>
          </div>
        </div>

        <div className="finding-header-right">
          <span className="category-tag">{category}</span>
          <button className="toggle-btn">
            {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="finding-body">
          <div className="description-section">
            <h5>Issue Description</h5>
            <p>{description}</p>
          </div>

          {evidence && (
            <div className="evidence-section">
              <h5>Code Evidence (Git Diff)</h5>
              <div className="evidence-container">
                {renderEvidence(evidence)}
              </div>
            </div>
          )}

          {recommendation && (
            <div className="recommendation-box">
              <div className="box-title">
                <Lightbulb size={16} className="bulb-icon" />
                <span>Fix Recommendation</span>
              </div>
              <p>{recommendation}</p>
            </div>
          )}

          <div className="finding-footer">
            <div className="confidence-metric">
              <Gauge size={14} className="metric-icon" />
              <span>Confidence: <strong>{getConfidencePercentage(confidence)}</strong></span>
              <div className="confidence-track">
                <div 
                  className="confidence-bar" 
                  style={{ width: getConfidencePercentage(confidence) }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FindingCard;
