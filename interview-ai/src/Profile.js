import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Formik, Form, Field, ErrorMessage } from "formik";
import * as Yup from "yup";
import { useAuth } from "./AuthContext";
import "./AuthForms.css";

const REQUEST_TIMEOUT = 10000;

const ProfileSchema = Yup.object().shape({
  name: Yup.string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters")
    .required("Name is required"),
  email: Yup.string()
    .trim()
    .email("Invalid email address")
    .required("Email is required"),
});

const PasswordSchema = Yup.object().shape({
  currentPassword: Yup.string().required("Current password is required"),
  newPassword: Yup.string()
    .min(6, "New password must be at least 6 characters")
    .max(50, "New password must be at most 50 characters")
    .required("New password is required"),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref("newPassword")], "Passwords must match")
    .required("Confirm password is required"),
});

function Profile() {
  const navigate = useNavigate();
  const { API_URL, getToken, logout, updateUser, user } = useAuth();

  const [initialValues, setInitialValues] = useState({
    name: "",
    email: "",
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const didInitialFetchRef = useRef(false);
  const isMountedRef = useRef(false);
  const requestInFlightRef = useRef(false);

  const clearProfileMessages = useCallback(() => {
    setProfileMessage("");
    setProfileError("");
  }, []);

  const clearPasswordMessages = useCallback(() => {
    setPasswordMessage("");
    setPasswordError("");
  }, []);

  const parseJsonSafely = useCallback(async (response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }, []);

  const fetchWithTimeout = useCallback(async (url, options = {}, timeout = REQUEST_TIMEOUT) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const handleUnauthorized = useCallback(() => {
    logout();
    navigate("/auth", { replace: true });
  }, [logout, navigate]);

  const fetchProfile = useCallback(
    async (showRefresh = false) => {
      if (requestInFlightRef.current) return;

      const token = getToken();
      if (!token) {
        handleUnauthorized();
        return;
      }

      requestInFlightRef.current = true;
      clearProfileMessages();

      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await fetchWithTimeout(`${API_URL}/api/profile`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await parseJsonSafely(response);

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || "Failed to load profile");
        }

        const fetchedName = data.name || "";
        const fetchedEmail = data.email || "";

        if (!isMountedRef.current) return;

        setInitialValues({
          name: fetchedName,
          email: fetchedEmail,
        });

        updateUser({
          id: data.id || data.user_id,
          name: fetchedName || "User",
          email: fetchedEmail || "",
        });
      } catch (error) {
        if (!isMountedRef.current) return;
        setProfileError(error.message || "Failed to fetch profile");
      } finally {
        requestInFlightRef.current = false;
        if (isMountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [API_URL, clearProfileMessages, fetchWithTimeout, getToken, handleUnauthorized, parseJsonSafely, updateUser]
  );

  useEffect(() => {
    isMountedRef.current = true;

    if (!didInitialFetchRef.current) {
      didInitialFetchRef.current = true;
      fetchProfile(false);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchProfile]);

  const handleProfileUpdate = useCallback(
    async (values, { setSubmitting, resetForm }) => {
      const token = getToken();
      clearProfileMessages();

      if (!token) {
        setSubmitting(false);
        handleUnauthorized();
        return;
      }

      try {
        const payload = {
          name: values.name.trim(),
          email: values.email.trim().toLowerCase(),
        };

        const response = await fetchWithTimeout(`${API_URL}/api/profile`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await parseJsonSafely(response);

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || "Failed to update profile");
        }

        const updatedName = data.name || payload.name;
        const updatedEmail = data.email || payload.email;

        const nextValues = {
          name: updatedName,
          email: updatedEmail,
        };

        setInitialValues(nextValues);
        resetForm({ values: nextValues });

        updateUser({
          id: data.id || data.user_id || user?.id,
          name: updatedName,
          email: updatedEmail,
        });

        setProfileMessage(data.message || "Profile updated successfully.");
      } catch (error) {
        setProfileError(error.message || "Failed to update profile");
      } finally {
        setSubmitting(false);
      }
    },
    [
      API_URL,
      clearProfileMessages,
      fetchWithTimeout,
      getToken,
      handleUnauthorized,
      parseJsonSafely,
      updateUser,
      user?.id,
    ]
  );

  const handlePasswordChange = useCallback(
    async (values, { setSubmitting, resetForm }) => {
      const token = getToken();
      clearPasswordMessages();

      if (!token) {
        setSubmitting(false);
        handleUnauthorized();
        return;
      }

      try {
        const response = await fetchWithTimeout(`${API_URL}/api/change-password`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            current_password: values.currentPassword,
            new_password: values.newPassword,
          }),
        });

        const data = await parseJsonSafely(response);

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || "Failed to change password");
        }

        setPasswordMessage(data.message || "Password changed successfully.");
        resetForm();
        setShowCurrentPassword(false);
        setShowNewPassword(false);
        setShowConfirmPassword(false);
      } catch (error) {
        setPasswordError(error.message || "Failed to change password");
      } finally {
        setSubmitting(false);
      }
    },
    [
      API_URL,
      clearPasswordMessages,
      fetchWithTimeout,
      getToken,
      handleUnauthorized,
      parseJsonSafely,
    ]
  );

  const accountInitial = useMemo(() => {
    const source = initialValues.name || user?.name || "U";
    return source.trim().charAt(0).toUpperCase();
  }, [initialValues.name, user?.name]);

  if (loading) {
    return (
      <div className="auth-container">
        <h2>User Profile</h2>
        <p className="otp-info">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "16px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ marginBottom: "6px" }}>User Profile</h2>
          <p className="info-text" style={{ marginBottom: 0 }}>
            Manage your account details and password here.
          </p>
        </div>

        <button
          type="button"
          className="auth-button"
          onClick={() => fetchProfile(true)}
          disabled={refreshing}
          style={{ width: "auto", minWidth: "120px", padding: "10px 16px" }}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          marginBottom: "24px",
          padding: "14px 16px",
          borderRadius: "12px",
          background: "#f8f9fa",
          border: "1px solid #e9ecef",
        }}
      >
        <div
          style={{
            width: "54px",
            height: "54px",
            borderRadius: "50%",
            background: "#007bff",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "700",
            fontSize: "20px",
            flexShrink: 0,
          }}
        >
          {accountInitial}
        </div>

        <div>
          <div style={{ fontWeight: "700", fontSize: "16px", color: "#2c3e50" }}>
            {initialValues.name || user?.name || "User"}
          </div>
          <div style={{ color: "#666", fontSize: "14px" }}>
            {initialValues.email || user?.email || "No email available"}
          </div>
        </div>
      </div>

      <Formik
        enableReinitialize
        initialValues={initialValues}
        validationSchema={ProfileSchema}
        onSubmit={handleProfileUpdate}
      >
        {({ isSubmitting, dirty, isValid }) => (
          <Form className="auth-form">
            <div className="form-group">
              <label htmlFor="name">Name</label>
              <Field
                id="name"
                name="name"
                type="text"
                className="form-control"
                placeholder="Enter your name"
                autoComplete="name"
              />
              <ErrorMessage name="name" component="div" className="error-message" />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <Field
                id="email"
                name="email"
                type="email"
                className="form-control"
                placeholder="Enter your email"
                autoComplete="email"
              />
              <ErrorMessage name="email" component="div" className="error-message" />
            </div>

            <button
              type="submit"
              className="auth-button"
              disabled={isSubmitting || !dirty || !isValid}
            >
              {isSubmitting ? "Updating..." : "Update Profile"}
            </button>

            {profileError && (
              <div className="error-message general-error">{profileError}</div>
            )}

            {profileMessage && (
              <div className="success-message general-success">
                {profileMessage}
              </div>
            )}
          </Form>
        )}
      </Formik>

      <hr className="profile-divider" />

      <h2 className="section-title">Change Password</h2>

      <Formik
        initialValues={{
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        }}
        validationSchema={PasswordSchema}
        onSubmit={handlePasswordChange}
      >
        {({ isSubmitting, isValid, dirty }) => (
          <Form className="auth-form">
            <div className="form-group" style={{ position: "relative" }}>
              <label htmlFor="currentPassword">Current Password</label>
              <Field
                id="currentPassword"
                name="currentPassword"
                type={showCurrentPassword ? "text" : "password"}
                className="form-control"
                placeholder="Enter current password"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="forgot-password-link password-toggle-btn"
                onClick={() => setShowCurrentPassword((prev) => !prev)}
              >
                {showCurrentPassword ? "Hide" : "Show"}
              </button>
              <ErrorMessage
                name="currentPassword"
                component="div"
                className="error-message"
              />
            </div>

            <div className="form-group" style={{ position: "relative" }}>
              <label htmlFor="newPassword">New Password</label>
              <Field
                id="newPassword"
                name="newPassword"
                type={showNewPassword ? "text" : "password"}
                className="form-control"
                placeholder="Enter new password"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="forgot-password-link password-toggle-btn"
                onClick={() => setShowNewPassword((prev) => !prev)}
              >
                {showNewPassword ? "Hide" : "Show"}
              </button>
              <ErrorMessage name="newPassword" component="div" className="error-message" />
            </div>

            <div className="form-group" style={{ position: "relative" }}>
              <label htmlFor="confirmPassword">Confirm New Password</label>
              <Field
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                className="form-control"
                placeholder="Confirm new password"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="forgot-password-link password-toggle-btn"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
              >
                {showConfirmPassword ? "Hide" : "Show"}
              </button>
              <ErrorMessage
                name="confirmPassword"
                component="div"
                className="error-message"
              />
            </div>

            <button
              type="submit"
              className="auth-button"
              disabled={isSubmitting || !dirty || !isValid}
            >
              {isSubmitting ? "Changing..." : "Change Password"}
            </button>

            {passwordError && (
              <div className="error-message general-error">{passwordError}</div>
            )}

            {passwordMessage && (
              <div className="success-message general-success">
                {passwordMessage}
              </div>
            )}
          </Form>
        )}
      </Formik>
    </div>
  );
}

export default Profile;