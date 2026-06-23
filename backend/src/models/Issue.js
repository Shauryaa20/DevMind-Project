const mongoose = require('mongoose');

const { Schema } = mongoose;

const IssueSchema = new Schema(
  {
    review: { type: Schema.Types.ObjectId, ref: 'Review', default: null, index: true },
    repository: {
      owner: { type: String, required: true, trim: true },
      repo: { type: String, required: true, trim: true },
      fullName: { type: String, required: true, trim: true, index: true },
    },
    sourceAgent: {
      type: String,
      required: true,
      trim: true,
      enum: ['security', 'performance', 'quality', 'aggregator'],
    },
    category: { type: String, required: true, trim: true, index: true },
    severity: {
      type: String,
      required: true,
      trim: true,
      enum: ['critical', 'high', 'medium', 'low', 'info'],
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null, trim: true },
    evidence: { type: String, default: null },
    filePath: { type: String, default: null, trim: true, index: true },
    lineStart: { type: Number, default: null },
    lineEnd: { type: Number, default: null },
    confidence: { type: Number, default: null, min: 0, max: 1 },
    recommendation: { type: String, default: null },
    status: {
      type: String,
      default: 'open',
      enum: ['open', 'acknowledged', 'resolved', 'ignored'],
      index: true,
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

IssueSchema.index({ review: 1, severity: 1 });
IssueSchema.index({ review: 1, category: 1 });

module.exports = mongoose.models.Issue || mongoose.model('Issue', IssueSchema);