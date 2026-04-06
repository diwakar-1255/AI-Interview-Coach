import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import "./LandingPage.css";

const LandingPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard");
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="landing-container">
      {/* Hero Section */}
      <header className="hero-section">
        <div className="hero-content">
          <h1>Crack Your Dream Interview with AI</h1>
          <p className="hero-subtitle">
            Experience realistic mock interviews powered by AI, receive instant
            personalized feedback, and improve your confidence before the real
            interview.
          </p>

          <div className="cta-container">
            <button
              className="cta-button primary"
              onClick={() =>
                navigate(isAuthenticated ? "/interview" : "/auth")
              }
            >
              {isAuthenticated ? "Start Mock Interview" : "Get Started Free"}
            </button>

            {!isAuthenticated && (
              <button
                className="cta-button secondary"
                onClick={() => navigate("/auth")}
              >
                Already have an account?
              </button>
            )}
          </div>
        </div>

        <div className="hero-image">
          <div className="mock-interview"></div>
        </div>
      </header>

      {/* Features Section */}
      <section className="features-section">
        <h2 className="section-title">Why Choose AI Interview Coach</h2>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🎤</div>
            <h3>Real-Time Mock Interviews</h3>
            <p>
              Practice with AI-generated interview questions tailored to your
              resume and job role.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">📈</div>
            <h3>Instant Smart Feedback</h3>
            <p>
              Get detailed evaluation on your answers, communication, confidence,
              and technical response quality.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">🚀</div>
            <h3>Career Growth Focused</h3>
            <p>
              Improve your interview performance and increase your chances of
              getting placed in top companies.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="how-it-works">
        <div className="steps-container">
          <h2 className="section-title">How It Works</h2>

          <div className="steps">
            <div className="step">
              <div className="step-number">1</div>
              <h3>Upload Resume</h3>
              <p>
                Upload your resume and target job details for personalized
                interview preparation.
              </p>
            </div>

            <div className="step">
              <div className="step-number">2</div>
              <h3>Attend Mock Interview</h3>
              <p>
                Answer AI-generated technical and behavioral interview questions.
              </p>
            </div>

            <div className="step">
              <div className="step-number">3</div>
              <h3>Analyze & Improve</h3>
              <p>
                Review instant feedback, scores, and suggestions to improve.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Developers */}
      <section className="testimonials">
        <h2 className="section-title">Developed By</h2>

        <div className="testimonial-cards">
          <div className="testimonial">
            <div className="user">M USHA RANI</div>
          </div>

          <div className="testimonial">
            <div className="user">YASASWINI</div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="final-cta">
        <h2>Start Your Interview Preparation Journey Today</h2>

        <button
          className="cta-button primary large"
          onClick={() =>
            navigate(isAuthenticated ? "/interview" : "/auth")
          }
        >
          {isAuthenticated ? "Practice Now" : "Join Free Today"}
        </button>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-logo">AI Interview Coach</div>

          <div className="footer-links">
            <a href="/about">About</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/contact">Contact</a>
          </div>

          <p className="copyright">
            © {new Date().getFullYear()} AI Interview Coach. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;