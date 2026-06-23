const mongoose = require('mongoose');

const { Schema } = mongoose;

const ReviewSchema = new Schema(
  {
    repository: {
      owner: { type: String, required: true },
      repo: { type: String, required: true },
      fullName: { type: String, required: true },
      ref: { type: String, default: null },
    },
    pullRequest: {
      number: { type: Number, required: true },
      diff: { type: String, required: true },
      collectionName: { type: String, default: null },
      topK: { type: Number, default: null },
    },
    repositoryContext: { type: Schema.Types.Mixed, default: null },
    securityReport: { type: Schema.Types.Mixed, default: null },
    performanceReport: { type: Schema.Types.Mixed, default: null },
    qualityReport: { type: Schema.Types.Mixed, default: null },
    aggregatedReport: { type: Schema.Types.Mixed, default: null },
    severityReport: { type: Schema.Types.Mixed, default: null },
    findings: { type: [Schema.Types.Mixed], default: [] },
    summary: { type: Schema.Types.Mixed, default: null },
    status: { type: String, default: 'completed' },
    error: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    minimize: false,
    strict: false,
  },
);

module.exports = mongoose.models.Review || mongoose.model('Review', ReviewSchema);