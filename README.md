# DevMind

Initial project skeleton for DevMind, an AI-powered GitHub code review agent.

## Tech Stack
- Backend: Node.js + Express.js
- Frontend: React + Vite
- Database: MongoDB
- Vector DB: ChromaDB

## Project Structure

```
DevMind Project/
  backend/
    src/
      config/
        chroma.js
        db.js
      routes/
        index.js
      server.js
    .env.example
    package.json
  frontend/
    src/
      App.jsx
      App.css
      index.css
      main.jsx
    .env.example
    package.json
  .gitignore
  README.md
```

## Setup

1. Backend
- cd backend
- npm install
- copy .env.example to .env
- npm run dev

2. Frontend
- cd frontend
- npm install
- copy .env.example to .env
- npm run dev

This skeleton intentionally contains no feature implementation yet.


C:\Users\sjraj\AppData\Local\Packages\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\LocalCache\local-packages\Python312\Scripts\chroma.exe run --host localhost --port 8000