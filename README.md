# DevMind - AI-Powered GitHub Pull Request Review Agent

DevMind is an AI-powered code review platform that automatically analyzes GitHub Pull Requests using Retrieval-Augmented Generation (RAG), Large Language Models (LLMs), and specialized review agents.

The system reviews code changes for security vulnerabilities, performance bottlenecks, and code quality issues, then generates structured findings with severity ratings and actionable recommendations.

---

## Features

### Automated Pull Request Analysis

* GitHub webhook integration
* Automatic PR detection and processing
* Real-time review generation

### Multi-Agent Review System

* Security Review Agent
* Performance Review Agent
* Code Quality Review Agent
* Aggregated review results

### Retrieval-Augmented Generation (RAG)

* Repository indexing
* ChromaDB vector storage
* Context-aware code analysis
* Semantic code retrieval

### AI-Powered Reviews

* Google Gemini 2.5 Flash integration
* Severity classification
* Evidence extraction
* Actionable recommendations

### Review Dashboard

* Repository management
* Review history
* Severity analytics
* Finding categorization
* Detailed issue inspection

---

## Architecture

```text
GitHub Pull Request
        │
        ▼
 GitHub Webhook
        │
        ▼
 Repository Indexer
        │
        ▼
     ChromaDB
        │
        ▼
 Context Retrieval
        │
        ▼
 ┌─────────────────┐
 │ Security Agent  │
 ├─────────────────┤
 │PerformanceAgent │
 ├─────────────────┤
 │ Quality Agent   │
 └─────────────────┘
        │
        ▼
 Review Aggregator
        │
        ▼
    MongoDB
        │
        ▼
 React Dashboard
```

---

## Tech Stack

### Frontend

* React.js
* React Router
* Axios
* CSS

### Backend

* Node.js
* Express.js

### Database

* MongoDB
* ChromaDB (Vector Database)

### AI & RAG

* Google Gemini 2.5 Flash
* Embedding-based retrieval
* Repository indexing

### Integrations

* GitHub REST API
* GitHub Webhooks

---

## Project Structure

```text
portfolio-analyzer
│
├── frontend
│   ├── src
│   │   ├── components
│   │   ├── pages
│   │   ├── services
│   │   └── utils
│
├── backend
│   ├── middleware
│   ├── models
│   ├── routes
│   ├── services
│   │   ├── agents
│   │   ├── rag
│   │   ├── geminiService.js
│   │   └── reviewService.js
│   └── server.js
```

---

## Setup Instructions

### Clone Repository

```bash
git clone <repository-url>
cd portfolio-analyzer
```

### Backend Setup

```bash
cd backend
npm install
```

Create `.env`

```env
PORT=5000

MONGODB_URI=your_mongodb_connection

CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=devmind-pr-reviews

GITHUB_TOKEN=your_github_token
GITHUB_ACCESS_TOKEN=your_github_token
GITHUB_WEBHOOK_SECRET=your_webhook_secret

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Start backend:

```bash
npm start
```

---

### Frontend Setup

```bash
cd frontend
npm install
npm start
```

---

## Workflow

1. User creates a Pull Request on GitHub.
2. GitHub webhook notifies DevMind.
3. Repository files are indexed and stored in ChromaDB.
4. Relevant code context is retrieved using semantic search.
5. Security, Performance, and Quality agents analyze the PR.
6. Findings are aggregated and stored in MongoDB.
7. Results are displayed in the dashboard.

---

## Sample Review Output

```text
Severity: High

Title:
Blocking loop with console.log in App.js

Category:
Performance

File:
frontend/src/App.js

Recommendation:
Move expensive operations outside render paths and avoid
long-running synchronous loops in the UI thread.
```

---

## Future Enhancements

* GitHub OAuth Authentication
* Multi-user support
* PR comments directly on GitHub
* Team workspaces
* Advanced repository analytics
* Support for multiple LLM providers
* CI/CD integration
* Slack and Discord notifications

---

## Author

Shaurya Rajput

B.Tech Information Technology
VJTI Mumbai

---

## License

This project is intended for educational and portfolio purposes.
