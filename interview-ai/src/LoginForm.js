import React, { useMemo, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Formik, Form, Field, ErrorMessage } from "formik";
import * as Yup from "yup";
import { useAuth } from "./AuthContext";
import "./AuthForms.css";

const LoginSchema = Yup.object().shape({
  email: Yup.string()
    .trim()
    .email("Invalid email address")
    .required("Email is required"),
  password: Yup.string().required("Password is required"),
});

const LoginForm = ({ onLoginSuccess, onVerificationRequired }) => {
  const { loginWithCredentials } = useAuth();
  const navigate = useNavigate();

  const [serverMessage, setServerMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const initialValues = useMemo(
    () => ({
      email: "",
      password: "",
    }),
    []
  );

  const clearServerState = useCallback((setErrors) => {
    setServerMessage("");
    setErrors({});
  }, []);

  const getReadableError = useCallback((result, fallbackEmail) => {
    const data = result?.data || {};
    const status = result?.status || 0;

    if (status === 403 && data?.requires_verification) {
      return (
        data?.error ||
        data?.message ||
        "Your account is not verified yet. Please verify your OTP first."
      );
    }

    if (status === 401) {
      return data?.error || "Invalid email or password.";
    }

    if (status === 400) {
      return data?.error || data?.message || "Invalid login request.";
    }

    if (status === 404) {
      return data?.error || "Login service not found on the server.";
    }

    if (status === 429) {
      const retrySeconds = data?.retry_after_seconds;
      if (retrySeconds) {
        return `Too many login attempts. Please try again in ${retrySeconds} seconds.`;
      }
      return data?.error || "Too many requests. Please try again later.";
    }

    if (status >= 500) {
      return data?.error || "Server error occurred during login.";
    }

    if (!status) {
      return result?.error || "Unable to connect to server. Please check if the backend is running.";
    }

    return (
      data?.error ||
      data?.message ||
      result?.error ||
      `Login failed for ${fallbackEmail || "this account"}. Please try again.`
    );
  }, []);

  const handleSubmit = async (values, formikHelpers) => {
    const { setSubmitting, setErrors, resetForm } = formikHelpers;

    clearServerState(setErrors);

    try {
      const email = values.email.trim().toLowerCase();
      const password = values.password;

      const result = await loginWithCredentials({ email, password });

      if (!result?.ok) {
        const data = result?.data || {};

        if (result?.status === 403 && data?.requires_verification) {
          const verificationMessage = getReadableError(result, email);

          setErrors({ general: verificationMessage });

          if (typeof onVerificationRequired === "function") {
            onVerificationRequired({
              email: data?.email || email,
              message: verificationMessage,
            });
          }

          return;
        }

        setErrors({
          general: getReadableError(result, email),
        });
        return;
      }

      const data = result.data || {};
      setServerMessage(data?.message || "Login successful.");
      resetForm();

      if (typeof onLoginSuccess === "function") {
        onLoginSuccess(data);
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch (error) {
      setErrors({
        general: error?.message || "Something went wrong during login.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2>Login to Your Account</h2>

      <Formik
        initialValues={initialValues}
        validationSchema={LoginSchema}
        onSubmit={handleSubmit}
      >
        {({ isSubmitting, errors, setErrors }) => (
          <Form className="auth-form" noValidate>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <Field
                id="email"
                name="email"
                type="email"
                className="form-control"
                placeholder="Enter your email"
                autoComplete="email"
                onFocus={() => clearServerState(setErrors)}
              />
              <ErrorMessage
                name="email"
                component="div"
                className="error-message"
              />
            </div>

            <div className="form-group" style={{ position: "relative" }}>
              <label htmlFor="password">Password</label>
              <Field
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                className="form-control"
                placeholder="Enter your password"
                autoComplete="current-password"
                onFocus={() => clearServerState(setErrors)}
              />
              <button
                type="button"
                className="forgot-password-link password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
              <ErrorMessage
                name="password"
                component="div"
                className="error-message"
              />
            </div>

            <div className="forgot-password-wrapper">
              <Link to="/forgot-password" className="forgot-password-link">
                Forgot Password?
              </Link>
            </div>

            <button
              type="submit"
              className="auth-button"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Logging in..." : "Login"}
            </button>

            {errors.general && (
              <div className="error-message general-error">
                {errors.general}
              </div>
            )}

            {serverMessage && !errors.general && (
              <div className="success-message general-success">
                {serverMessage}
              </div>
            )}
          </Form>
        )}
      </Formik>
    </div>
  );
};

export default LoginForm;