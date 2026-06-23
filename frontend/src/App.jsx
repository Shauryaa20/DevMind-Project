import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import SystemOverview from './pages/SystemOverview';
import Repositories from './pages/Repositories';
import Reviews from './pages/Reviews';
import ReviewDetails from './pages/ReviewDetails';
import './App.css';

function App() {
  return (
    <AppProvider>
      <Router>
        <div className="dashboard-layout">
          <Sidebar />
          <div className="main-content">
            <Header />
            <main className="content-pane">
              <Routes>
                <Route path="/" element={<SystemOverview />} />
                <Route path="/repositories" element={<Repositories />} />
                <Route path="/reviews" element={<Reviews />} />
                <Route path="/reviews/:id" element={<ReviewDetails />} />
              </Routes>
            </main>
          </div>
        </div>
      </Router>
    </AppProvider>
  );
}

export default App;
