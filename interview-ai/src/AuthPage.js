import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import LoginForm from "./LoginForm";
import SignupForm from "./SignupForm";
import { useAuth } from "./AuthContext";

import "./AuthPage.css";

const AuthPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, loading } = useAuth();

  const [activeTab, setActiveTab] = useState("login");

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const tab = query.get("tab");

    if (tab === "signup") {
      setActiveTab("signup");
    } else {
      setActiveTab("login");
    }
  }, [location.search]);

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  const handleLoginSuccess = useCallback(() => {
    navigate("/dashboard", { replace: true });
  }, [navigate]);

  const handleSignupSuccess = useCallback(() => {
    setActiveTab("login");
  }, []);

  const switchToLogin = useCallback(() => {
    setActiveTab("login");
  }, []);

  const switchToSignup = useCallback(() => {
    setActiveTab("signup");
  }, []);

  const headerText = useMemo(() => {
    return activeTab === "login"
      ? "Login to continue your interview journey"
      : "Create your account to get started";
  }, [activeTab]);

  if (loading) {
    return (
      <div className="auth-container">
        <div className="auth-card text-center">
          <h3 className="mb-2">Loading...</h3>
          <p className="mb-0">Please wait while we verify your session.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header text-center mb-4">
          <h2 className="mb-2">AI Interview Coach</h2>
          <p className="mb-0">{headerText}</p>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Authentication tabs">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "login"}
            className={`tab-btn ${activeTab === "login" ? "active" : ""}`}
            onClick={switchToLogin}
          >
            Login
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "signup"}
            className={`tab-btn ${activeTab === "signup" ? "active" : ""}`}
            onClick={switchToSignup}
          >
            Sign Up
          </button>
        </div>

        <div className="auth-form-wrapper">
          {activeTab === "login" ? (
            <LoginForm onLoginSuccess={handleLoginSuccess} />
          ) : (
            <SignupForm onSignupSuccess={handleSignupSuccess} />
          )}
        </div>

        <div className="auth-footer">
          {activeTab === "login" ? (
            <p>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                className="auth-switch-btn"
                onClick={switchToSignup}
              >
                Sign up
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{" "}
              <button
                type="button"
                className="auth-switch-btn"
                onClick={switchToLogin}
              >
                Login
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthPage;