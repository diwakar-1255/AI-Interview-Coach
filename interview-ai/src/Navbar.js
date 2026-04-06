import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import "./Navbar.css";

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { isAuthenticated, user, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(null);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    closeMobileMenu();
  }, [location.pathname, closeMobileMenu]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!mobileMenuOpen) return;
      if (navRef.current && !navRef.current.contains(event.target)) {
        setMobileMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  const handleLogout = useCallback(() => {
    closeMobileMenu();
    logout();
    navigate("/", { replace: true });
  }, [closeMobileMenu, logout, navigate]);

  const isActivePath = useCallback(
    (path, exact = true) => {
      if (exact) {
        return location.pathname === path;
      }
      return location.pathname === path || location.pathname.startsWith(`${path}/`);
    },
    [location.pathname]
  );

  const showInterviewLinks = useMemo(() => {
    return !!isAuthenticated;
  }, [isAuthenticated]);

  const displayName = useMemo(() => {
    if (!user?.name) return "My Profile";
    const trimmed = user.name.trim();
    if (!trimmed) return "My Profile";
    return trimmed.length > 24 ? `${trimmed.slice(0, 24)}...` : `Welcome, ${trimmed}`;
  }, [user]);

  return (
    <nav
      ref={navRef}
      className={`navbar navbar-expand-lg navbar-dark fixed-top ${
        scrolled ? "navbar-scrolled" : ""
      }`}
    >
      <div className="container">
        <Link
          className="navbar-brand d-flex align-items-center"
          to={isAuthenticated ? "/dashboard" : "/"}
          onClick={closeMobileMenu}
        >
          <div className="logo-container">
            <i className="fas fa-robot logo-icon"></i>
            <span className="logo-text">AI Interview Coach</span>
          </div>
        </Link>

        <button
          className={`navbar-toggler ${mobileMenuOpen ? "" : "collapsed"}`}
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-label="Toggle navigation"
          aria-expanded={mobileMenuOpen}
          aria-controls="main-navbar"
        >
          <div className={`animated-hamburger ${mobileMenuOpen ? "open" : ""}`}>
            <span></span>
            <span></span>
            <span></span>
          </div>
        </button>

        <div
          id="main-navbar"
          className={`collapse navbar-collapse ${mobileMenuOpen ? "show" : ""}`}
        >
          <ul className="navbar-nav ms-auto align-items-lg-center">
            <li className="nav-item">
              <Link
                className={`nav-link ${isActivePath("/") ? "active" : ""}`}
                to="/"
                onClick={closeMobileMenu}
              >
                <i className="fas fa-home nav-icon"></i>
                <span className="nav-text">Home</span>
              </Link>
            </li>

            {showInterviewLinks && (
              <>
                <li className="nav-item">
                  <Link
                    className={`nav-link ${
                      isActivePath("/dashboard") ? "active" : ""
                    }`}
                    to="/dashboard"
                    onClick={closeMobileMenu}
                  >
                    <i className="fas fa-chart-line nav-icon"></i>
                    <span className="nav-text">Dashboard</span>
                  </Link>
                </li>

                <li className="nav-item">
                  <Link
                    className={`nav-link ${
                      isActivePath("/interview-question") ||
                      isActivePath("/interview", false) ||
                      isActivePath("/interview-complete")
                        ? "active"
                        : ""
                    }`}
                    to="/interview-question"
                    onClick={closeMobileMenu}
                  >
                    <i className="fas fa-microphone-alt nav-icon"></i>
                    <span className="nav-text">Practice Interview</span>
                  </Link>
                </li>

                <li className="nav-item">
                  <Link
                    className={`nav-link ${
                      isActivePath("/jobs") ? "active" : ""
                    }`}
                    to="/jobs"
                    onClick={closeMobileMenu}
                  >
                    <i className="fas fa-briefcase nav-icon"></i>
                    <span className="nav-text">Jobs</span>
                  </Link>
                </li>
              </>
            )}

            {!loading && isAuthenticated ? (
              <>
                <li className="nav-item user-greeting">
                  <Link
                    to="/profile"
                    className={`nav-link user-profile ${
                      isActivePath("/profile") ? "active" : ""
                    }`}
                    onClick={closeMobileMenu}
                  >
                    <i className="fas fa-user-circle user-icon"></i>
                    <span className="user-name">{displayName}</span>
                  </Link>
                </li>

                <li className="nav-item">
                  <button
                    type="button"
                    className="btn btn-outline-light ms-lg-2 mt-2 mt-lg-0 logout-btn"
                    onClick={handleLogout}
                  >
                    <i className="fas fa-sign-out-alt"></i> Logout
                  </button>
                </li>
              </>
            ) : !loading ? (
              <>
                <li className="nav-item">
                  <Link
                    className={`nav-link ${isActivePath("/auth") ? "active" : ""}`}
                    to="/auth"
                    onClick={closeMobileMenu}
                  >
                    <i className="fas fa-sign-in-alt nav-icon"></i>
                    <span className="nav-text">Login</span>
                  </Link>
                </li>

                <li className="nav-item">
                  <Link
                    className="btn btn-primary ms-lg-2 mt-2 mt-lg-0 signup-btn"
                    to="/auth"
                    onClick={closeMobileMenu}
                  >
                    <i className="fas fa-user-plus"></i> Sign Up
                  </Link>
                </li>
              </>
            ) : (
              <li className="nav-item">
                <span className="nav-link">Loading...</span>
              </li>
            )}
          </ul>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;