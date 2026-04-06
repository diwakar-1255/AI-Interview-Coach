import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";

import { AuthProvider, useAuth } from "./AuthContext";
import Navbar from "./Navbar";
import InterviewForm from "./InterviewForm";
import LiveInterview from "./LiveInterview";
import LandingPage from "./LandingPage";
import Dashboard from "./Dashboard";
import AuthPage from "./AuthPage";
import InterviewComplete from "./InterviewComplete";
import ForgotPassword from "./ForgotPassword";
import Profile from "./Profile";
import Jobs from "./Jobs";

const parseStoredInterviewData = () => {
  try {
    const saved = localStorage.getItem("current_interview_data");
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    console.error("Failed to parse current_interview_data:", error);
    localStorage.removeItem("current_interview_data");
    return null;
  }
};

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="container mt-5">
        <div className="alert alert-light text-center shadow-sm rounded-4 p-4">
          <h4 className="mb-2">Checking authentication...</h4>
          <p className="mb-0">Please wait.</p>
        </div>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/auth" replace />;
};

const PublicOnlyRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="container mt-5">
        <div className="alert alert-light text-center shadow-sm rounded-4 p-4">
          <h4 className="mb-2">Loading...</h4>
          <p className="mb-0">Please wait.</p>
        </div>
      </div>
    );
  }

  return isAuthenticated ? <Navigate to="/dashboard" replace /> : children;
};

const InterviewRoute = ({ interviewData, setInterviewData }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="container mt-5">
        <div className="alert alert-light text-center shadow-sm rounded-4 p-4">
          <h4 className="mb-2">Preparing interview...</h4>
          <p className="mb-0">Please wait.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  const storedInterviewData = interviewData || parseStoredInterviewData();

  if (!storedInterviewData) {
    return <Navigate to="/interview-question" replace />;
  }

  return (
    <LiveInterview
      interviewData={storedInterviewData}
      setInterviewData={setInterviewData}
    />
  );
};

const AppRoutes = () => {
  const [interviewData, setInterviewDataState] = useState(() =>
    parseStoredInterviewData()
  );

  const setInterviewData = useCallback((data) => {
    setInterviewDataState(data);

    if (data) {
      localStorage.setItem("current_interview_data", JSON.stringify(data));
      sessionStorage.setItem("liveInterviewData", JSON.stringify(data));
    } else {
      localStorage.removeItem("current_interview_data");
      sessionStorage.removeItem("liveInterviewData");
    }
  }, []);

  const clearInterviewData = useCallback(() => {
    setInterviewDataState(null);
    localStorage.removeItem("current_interview_data");
    sessionStorage.removeItem("liveInterviewData");
    sessionStorage.removeItem("live_interview_session");
    sessionStorage.removeItem("interviewData");
  }, []);

  useEffect(() => {
    const syncInterviewData = () => {
      const stored = parseStoredInterviewData();
      setInterviewDataState(stored);
    };

    window.addEventListener("storage", syncInterviewData);
    return () => window.removeEventListener("storage", syncInterviewData);
  }, []);

  const appContextValue = useMemo(
    () => ({
      interviewData,
      setInterviewData,
      clearInterviewData,
    }),
    [interviewData, setInterviewData, clearInterviewData]
  );

  return (
    <>
      <Navbar />

      <Routes>
        <Route path="/" element={<LandingPage />} />

        <Route
          path="/auth"
          element={
            <PublicOnlyRoute>
              <AuthPage />
            </PublicOnlyRoute>
          }
        />

        <Route
          path="/forgot-password"
          element={
            <PublicOnlyRoute>
              <ForgotPassword />
            </PublicOnlyRoute>
          }
        />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />

        <Route
          path="/jobs"
          element={
            <ProtectedRoute>
              <Jobs />
            </ProtectedRoute>
          }
        />

        <Route
          path="/interview-question"
          element={
            <ProtectedRoute>
              <InterviewForm
                setInterviewData={appContextValue.setInterviewData}
                interviewData={appContextValue.interviewData}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="/interview"
          element={
            <InterviewRoute
              interviewData={appContextValue.interviewData}
              setInterviewData={appContextValue.setInterviewData}
            />
          }
        />

        <Route
          path="/interview-complete"
          element={
            <ProtectedRoute>
              <InterviewComplete
                clearInterviewData={appContextValue.clearInterviewData}
              />
            </ProtectedRoute>
          }
        />

        <Route
          path="/exit"
          element={
            <ProtectedRoute>
              <div className="container mt-5">
                <div className="alert alert-info text-center shadow-sm rounded-4 p-4">
                  <h2 className="mb-3">Thank you for participating!</h2>
                  <p className="mb-0">
                    Your interview session has been ended safely.
                  </p>
                </div>
              </div>
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;