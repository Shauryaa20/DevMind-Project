const mongoose = require('mongoose');

const { Schema } = mongoose;

const RepositorySchema = new Schema(
  {
    owner: { type: String, required: true, trim: true },
    repo: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true, unique: true, index: true },
    defaultBranch: { type: String, default: 'main', trim: true },
    cloneUrl: { type: String, default: null, trim: true },
    htmlUrl: { type: String, default: null, trim: true },
    description: { type: String, default: null, trim: true },
    language: { type: String, default: null, trim: true },
    private: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    lastIndexedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

RepositorySchema.index({ owner: 1, repo: 1 }, { unique: true });

module.exports = mongoose.models.Repository || mongoose.model('Repository', RepositorySchema);