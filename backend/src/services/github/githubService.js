const path = require('path');

const DEFAULT_API_BASE_URL = 'https://api.github.com';
const DEFAULT_API_VERSION = '2022-11-28';
const DEFAULT_USER_AGENT = 'DevMind-GitHubService';
const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024;

class GitHubServiceError extends Error {
  constructor(message, statusCode = 500, details) {
    super(message);
    this.name = 'GitHubServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const getEnv = (name, fallback = undefined) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};

const normalizeBaseUrl = (baseUrl) => baseUrl.replace(/\/$/, '');

const normalizeRepoInput = (input, repoName) => {
  if (typeof input === 'object' && input !== null) {
    const owner = input.owner || input.organization || input.user;
    const repo = input.repo || input.repository || input.name;
    const ref = input.ref || input.branch || input.sha;

    if (typeof owner === 'string' && typeof repo === 'string' && owner.trim() && repo.trim()) {
      return {
        owner: owner.trim(),
        repo: repo.trim(),
        ref: typeof ref === 'string' && ref.trim() ? ref.trim() : undefined,
      };
    }

    if (typeof input.fullName === 'string' && input.fullName.includes('/')) {
      const [parsedOwner, parsedRepo] = input.fullName.split('/');

      return {
        owner: parsedOwner.trim(),
        repo: parsedRepo.trim(),
        ref: typeof ref === 'string' && ref.trim() ? ref.trim() : undefined,
      };
    }
  }

  if (typeof input === 'string' && typeof repoName === 'string') {
    if (!input.trim() || !repoName.trim()) {
      throw new GitHubServiceError('owner and repo must not be empty.', 400);
    }

    return {
      owner: input.trim(),
      repo: repoName.trim(),
      ref: undefined,
    };
  }

  if (typeof input === 'string' && input.includes('/')) {
    const [owner, repo] = input.split('/');

    if (!owner?.trim() || !repo?.trim()) {
      throw new GitHubServiceError('fullName must be in the form owner/repo.', 400);
    }

    return {
      owner: owner.trim(),
      repo: repo.trim(),
      ref: undefined,
    };
  }

  throw new GitHubServiceError('Repository input must include owner and repo.', 400);
};

const normalizePath = (value) => String(value || '').replace(/^\/+/, '').trim();

const encodePathSegments = (value) => {
  return normalizePath(value)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
};

const buildUrl = (baseUrl, pathname) => {
  return `${normalizeBaseUrl(baseUrl)}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
};

const createRateLimitError = (response, details) => {
  const retryAfter = response.headers.get('retry-after');
  return new GitHubServiceError(
    'GitHub API rate limit exceeded.',
    response.status,
    {
      retryAfter: retryAfter ? Number(retryAfter) || retryAfter : undefined,
      ...details,
    },
  );
};

const createGitHubService = (options = {}) => {
  const apiBaseUrl = normalizeBaseUrl(
    options.baseUrl || getEnv('GITHUB_API_BASE_URL', DEFAULT_API_BASE_URL),
  );
  const apiVersion = options.apiVersion || getEnv('GITHUB_API_VERSION', DEFAULT_API_VERSION);
  const token = options.token || getEnv('GITHUB_TOKEN') || getEnv('GITHUB_ACCESS_TOKEN');
  const userAgent = options.userAgent || getEnv('GITHUB_USER_AGENT', DEFAULT_USER_AGENT);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new GitHubServiceError('A fetch implementation is required.', 500);
  }

  const request = async ({ pathname, method = 'GET', accept = 'application/vnd.github+json', body, responseType = 'json' }) => {
    const url = buildUrl(apiBaseUrl, pathname);
    let owner = undefined;
    let repo = undefined;
    let ref = undefined;

    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'repos' && parts[1] && parts[2]) {
      owner = parts[1];
      repo = parts[2];
    }
    try {
      const urlObj = new URL(url);
      ref = urlObj.searchParams.get('ref') || urlObj.searchParams.get('sha');
    } catch (e) {}
    if (!ref) {
      if (parts[3] === 'branches' && parts[4]) {
        ref = decodeURIComponent(parts[4]);
      } else if (parts[3] === 'git' && parts[4] === 'commits' && parts[5]) {
        ref = parts[5];
      } else if (parts[3] === 'git' && parts[4] === 'trees' && parts[5]) {
        ref = decodeURIComponent(parts[5]);
      }
    }

    console.log("OWNER:", owner);
    console.log("REPO:", repo);
    console.log("REF:", ref);
    console.log("REQUEST URL:", url);

    console.log(`[INDEX] START GitHub API call: ${method} ${url}`);
    const start = Date.now();

    const headers = {
      Accept: accept,
      'X-GitHub-Api-Version': apiVersion,
      'User-Agent': userAgent,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const requestOptions = {
      method,
      headers,
    };

    if (typeof body !== 'undefined') {
      headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(body);
    }

    let response;

    try {
      response = await fetchImpl(buildUrl(apiBaseUrl, pathname), requestOptions);
      console.log("REQUEST URL:", url);
      console.log("STATUS:", response.status);
    } catch (error) {
      console.error("[INDEX] FAILED during GitHub API calls", error);
      throw new GitHubServiceError(
        'Unable to reach the GitHub API.',
        500,
        error?.message || error,
      );
    }

    try {
      if (!response.ok) {
        let details = undefined;

        try {
          if (responseType === 'text') {
            details = await response.text();
          } else {
            details = await response.json();
          }
        } catch {
          details = undefined;
        }

        console.log("ERROR RESPONSE:", details);

        if (response.status === 403 && String(details?.message || details || '').toLowerCase().includes('rate limit')) {
          throw createRateLimitError(response, details);
        }

        const message =
          details?.message || details?.error || details || `GitHub API request failed with status ${response.status}.`;

        throw new GitHubServiceError(message, response.status, details);
      }

      let result;
      if (responseType === 'text') {
        result = await response.text();
      } else {
        result = await response.json();
      }

      console.log(`[INDEX] SUCCESS GitHub API call: ${method} ${url} in ${Date.now() - start} ms`);
      return result;
    } catch (error) {
      console.error("[INDEX] FAILED during GitHub API calls", error);
      throw error;
    }
  };

  const getRepositoryDetails = async (repositoryInput, repoName) => {
    const { owner, repo } = normalizeRepoInput(repositoryInput, repoName);

    return request({ pathname: `/repos/${owner}/${repo}` });
  };

  const resolveCommitSha = async ({ owner, repo, ref }) => {
    const normalizedRef = typeof ref === 'string' && ref.trim() ? ref.trim() : undefined;
    console.log("resolveCommitSha INPUT:", { owner, repo, ref });
    console.log("normalizedRef:", normalizedRef);

    if (!normalizedRef) {
      const repository = await getRepositoryDetails({ owner, repo });
      const value = repository.default_branch || 'main';
      console.log("resolveCommitSha RETURN:", value);
      return value;
    }

    if (/^[a-f0-9]{40}$/i.test(normalizedRef)) {
      console.log("resolveCommitSha RETURN:", normalizedRef);
      return normalizedRef;
    }

    try {
      const branch = await request({ pathname: `/repos/${owner}/${repo}/branches/${encodeURIComponent(normalizedRef)}` });
      const value = branch?.commit?.sha || normalizedRef;
      console.log("resolveCommitSha RETURN:", value);
      return value;
    } catch (error) {
      if (error && error.statusCode === 404) {
        console.log("resolveCommitSha RETURN:", normalizedRef);
        return normalizedRef;
      }

      throw error;
    }
  };

  const resolveTreeSha = async ({ owner, repo, ref }) => {
    const resolvedRef = await resolveCommitSha({ owner, repo, ref });
    console.log("resolveTreeSha INPUT:", { owner, repo, ref });
    console.log("resolvedRef:", resolvedRef);
    console.log("isCommitSha:", /^[a-f0-9]{40}$/i.test(resolvedRef));

    if (/^[a-f0-9]{40}$/i.test(resolvedRef)) {
      const commit = await request({ pathname: `/repos/${owner}/${repo}/git/commits/${resolvedRef}` });
      return commit?.tree?.sha || resolvedRef;
    }

    const repository = await getRepositoryDetails({ owner, repo });
    const branchName = resolvedRef || repository.default_branch || 'main';
    const branch = await request({ pathname: `/repos/${owner}/${repo}/branches/${encodeURIComponent(branchName)}` });
    return branch?.commit?.commit?.tree?.sha || branch?.commit?.sha || branchName;
  };

  const fetchRepositoryTree = async ({ owner, repo, ref, recursive = true }) => {
    const treeSha = await resolveTreeSha({ owner, repo, ref });
    return request({
      pathname: `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeSha)}${recursive ? '?recursive=1' : ''}`,
    });
  };

  const fetchFileContent = async ({ owner, repo, filePath, ref }) => {
    const normalizedPath = normalizePath(filePath);
    const encodedPath = encodePathSegments(normalizedPath);

    const content = await request({
      pathname: `/repos/${owner}/${repo}/contents/${encodedPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
    });

    if (Array.isArray(content)) {
      throw new GitHubServiceError('Requested path is a directory, not a file.', 400);
    }

    if (content?.encoding === 'base64' && typeof content.content === 'string') {
      return {
        fileName: content.name,
        filePath: content.path,
        sha: content.sha,
        size: content.size,
        type: content.type,
        content: Buffer.from(content.content.replace(/\n/g, ''), 'base64').toString('utf8'),
        raw: content,
      };
    }

    return {
      fileName: content?.name || path.basename(normalizedPath),
      filePath: content?.path || normalizedPath,
      sha: content?.sha || null,
      size: content?.size ?? null,
      type: content?.type || 'file',
      content: content?.content || '',
      raw: content,
    };
  };

  const fetchRepositoryFiles = async ({
    repository,
    owner,
    repo,
    ref,
    includeContent = true,
    maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES,
  } = {}) => {
    const normalized = normalizeRepoInput(repository || owner, repo);
    const resolvedRef = ref || normalized.ref;

    console.log(`[INDEX] Fetching repository: ${normalized.owner}/${normalized.repo}...`);
    const start = Date.now();

    try {
      const tree = await fetchRepositoryTree({ owner: normalized.owner, repo: normalized.repo, ref: resolvedRef });
      const blobs = Array.isArray(tree?.tree) ? tree.tree.filter((entry) => entry?.type === 'blob') : [];

      const files = [];

      for (const entry of blobs) {
        if (typeof entry.path !== 'string' || !entry.path.trim()) {
          continue;
        }

        const filePath = entry.path.trim();
        const size = Number(entry.size || 0);

        if (Number.isFinite(maxFileSizeBytes) && maxFileSizeBytes > 0 && size > maxFileSizeBytes) {
          continue;
        }

        if (!includeContent) {
          files.push({
            fileName: path.basename(filePath),
            filePath,
            sha: entry.sha || null,
            size,
            type: entry.type || 'blob',
            url: entry.url || null,
          });
          continue;
        }

        const content = await fetchFileContent({
          owner: normalized.owner,
          repo: normalized.repo,
          filePath,
          ref: resolvedRef,
        });

        files.push({
          fileName: content.fileName,
          filePath: content.filePath,
          sha: content.sha,
          size: content.size,
          type: content.type,
          content: content.content,
          raw: content.raw,
        });
      }

      console.log(`[INDEX] Repository fetched successfully in ${Date.now() - start} ms`);

      return {
        repository: {
          owner: normalized.owner,
          repo: normalized.repo,
          ref: resolvedRef || tree?.sha || undefined,
        },
        treeSha: tree?.sha || null,
        files,
        raw: tree,
      };
    } catch (error) {
      console.error("[INDEX] FAILED during Repository download", error);
      throw error;
    }
  };

  const fetchPullRequestDetails = async ({ repository, owner, repo, pullNumber }) => {
    if (!pullNumber) {
      throw new GitHubServiceError('pullNumber is required.', 400);
    }

    const normalized = normalizeRepoInput(repository || owner, repo);

    return request({ pathname: `/repos/${normalized.owner}/${normalized.repo}/pulls/${pullNumber}` });
  };

  const fetchPullRequestChangedFiles = async ({
    repository,
    owner,
    repo,
    pullNumber,
    perPage = DEFAULT_PER_PAGE,
  }) => {
    if (!pullNumber) {
      throw new GitHubServiceError('pullNumber is required.', 400);
    }

    const normalized = normalizeRepoInput(repository || owner, repo);
    const changedFiles = [];

    for (let page = 1; ; page += 1) {
      const response = await request({
        pathname: `/repos/${normalized.owner}/${normalized.repo}/pulls/${pullNumber}/files?per_page=${perPage}&page=${page}`,
      });

      const files = Array.isArray(response) ? response : [];
      changedFiles.push(...files);

      if (files.length < perPage) {
        break;
      }
    }

    return changedFiles.map((file) => ({
      fileName: path.basename(file.filename || ''),
      filePath: file.filename || '',
      status: file.status || '',
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      changes: file.changes ?? 0,
      patch: file.patch || '',
      sha: file.sha || null,
      previousFilename: file.previous_filename || null,
      raw: file,
    }));
  };

  const fetchPullRequestDiff = async ({ repository, owner, repo, pullNumber }) => {
    if (!pullNumber) {
      throw new GitHubServiceError('pullNumber is required.', 400);
    }

    const normalized = normalizeRepoInput(repository || owner, repo);

    return request({
      pathname: `/repos/${normalized.owner}/${normalized.repo}/pulls/${pullNumber}`,
      accept: 'application/vnd.github.v3.diff',
      responseType: 'text',
    });
  };

  return {
    apiBaseUrl,
    apiVersion,
    getRepositoryDetails,
    fetchRepositoryFiles,
    fetchPullRequestDetails,
    fetchPullRequestChangedFiles,
    fetchPullRequestDiff,
  };
};

let cachedGitHubService = null;

const getGitHubService = () => {
  if (!cachedGitHubService) {
    cachedGitHubService = createGitHubService();
  }

  return cachedGitHubService;
};

module.exports = {
  GitHubServiceError,
  createGitHubService,
  getGitHubService,
  normalizeRepoInput,
  normalizePath,
};