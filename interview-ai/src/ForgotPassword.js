import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Formik, Form, Field, ErrorMessage } from "formik";
import * as Yup from "yup";
import "./AuthForms.css";

const API_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:5000";
const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

const EmailSchema = Yup.object().shape({
  email: Yup.string()
    .trim()
    .email("Invalid email address")
    .required("Email is required"),
});

const OtpSchema = Yup.object().shape({
  otp: Yup.string()
    .trim()
    .matches(/^\d{6}$/, `OTP must be ${OTP_LENGTH} digits`)
    .required("OTP is required"),
});

const ResetSchema = Yup.object().shape({
  newPassword: Yup.string()
    .min(6, "New password must be at least 6 characters")
    .required("New password is required"),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref("newPassword")], "Passwords must match")
    .required("Confirm password is required"),
});

const ForgotPassword = () => {
  const navigate = useNavigate();
  const redirectTimerRef = useRef(null);
  const otpInputRefs = useRef([]);

  const [step, setStep] = useState(1); // 1=email, 2=otp, 3=reset
  const [email, setEmail] = useState("");
  const [otpDigits, setOtpDigits] = useState(Array(OTP_LENGTH).fill(""));
  const [otpValue, setOtpValue] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [serverError, setServerError] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    let intervalId;

    if (resendCooldown > 0) {
      intervalId = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(intervalId);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [resendCooldown]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const clearMessages = () => {
    setSuccessMessage("");
    setServerError("");
  };

  const resetOtpState = () => {
    setOtpDigits(Array(OTP_LENGTH).fill(""));
    setOtpValue("");
    otpInputRefs.current = [];
  };

  const parseResponse = async (response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const handleApiError = (response, data, fallbackMessage) => {
    if (response.status === 400) {
      throw new Error(data.error || data.message || fallbackMessage);
    }
    if (response.status === 404) {
      throw new Error(data.error || data.message || "User account not found.");
    }
    if (response.status === 429) {
      throw new Error(
        data.error || data.message || "Too many attempts. Please wait and try again."
      );
    }
    if (response.status === 500) {
      throw new Error(data.error || data.message || "Server error. Please try again.");
    }

    throw new Error(data.error || data.message || fallbackMessage);
  };

  const handleOtpDigitChange = (index, value, setFieldValue) => {
    if (!/^\d?$/.test(value)) return;

    const updated = [...otpDigits];
    updated[index] = value;
    const joined = updated.join("");

    setOtpDigits(updated);
    setOtpValue(joined);
    setFieldValue("otp", joined);

    if (value && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, event, setFieldValue) => {
    if (event.key === "Backspace") {
      if (otpDigits[index]) {
        const updated = [...otpDigits];
        updated[index] = "";
        const joined = updated.join("");

        setOtpDigits(updated);
        setOtpValue(joined);
        setFieldValue("otp", joined);
        return;
      }

      if (index > 0) {
        const updated = [...otpDigits];
        updated[index - 1] = "";
        const joined = updated.join("");

        setOtpDigits(updated);
        setOtpValue(joined);
        setFieldValue("otp", joined);
        otpInputRefs.current[index - 1]?.focus();
      }
    }

    if (event.key === "ArrowLeft" && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }

    if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (event, setFieldValue) => {
    event.preventDefault();

    const pasted = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, OTP_LENGTH);

    if (!pasted) return;

    const updated = Array(OTP_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i += 1) {
      updated[i] = pasted[i];
    }

    const joined = updated.join("");

    setOtpDigits(updated);
    setOtpValue(joined);
    setFieldValue("otp", joined);

    const nextIndex =
      pasted.length >= OTP_LENGTH ? OTP_LENGTH - 1 : pasted.length;
    otpInputRefs.current[nextIndex]?.focus();
  };

  const handleSendOtp = async (values, { setSubmitting, resetForm }) => {
    clearMessages();

    try {
      const trimmedEmail = values.email.trim().toLowerCase();

      let response;
      try {
        response = await fetch(`${API_URL}/api/forgot-password`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: trimmedEmail,
          }),
        });
      } catch {
        throw new Error(
          "Unable to connect to server. Please check if backend is running."
        );
      }

      const data = await parseResponse(response);

      if (!response.ok) {
        handleApiError(response, data, "Failed to send OTP.");
      }

      resetForm();
      setEmail(trimmedEmail);
      resetOtpState();
      setStep(2);
      setResendCooldown(RESEND_SECONDS);
      setSuccessMessage(data.message || "OTP sent to your email successfully.");
    } catch (error) {
      setServerError(error.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinueWithOtp = async (values, { setSubmitting }) => {
    clearMessages();

    try {
      const normalizedOtp = (values.otp || "").trim();

      if (!/^\d{6}$/.test(normalizedOtp)) {
        throw new Error(`OTP must be ${OTP_LENGTH} digits.`);
      }

      setOtpValue(normalizedOtp);
      setStep(3);
      setSuccessMessage("OTP entered successfully. Now set your new password.");
    } catch (error) {
      setServerError(error.message || "Failed to continue.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (values, { setSubmitting, resetForm }) => {
    clearMessages();

    try {
      if (!email.trim()) {
        throw new Error("Email is missing. Please start again.");
      }

      if (!/^\d{6}$/.test(otpValue)) {
        throw new Error("OTP is missing or invalid. Please enter OTP again.");
      }

      let response;
      try {
        response = await fetch(`${API_URL}/api/reset-password`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            otp: otpValue,
            new_password: values.newPassword,
          }),
        });
      } catch {
        throw new Error(
          "Unable to connect to server. Please check if backend is running."
        );
      }

      const data = await parseResponse(response);

      if (!response.ok) {
        handleApiError(response, data, "Failed to reset password.");
      }

      resetForm();
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setSuccessMessage(
        data.message || "Password reset successful. Redirecting to login..."
      );

      redirectTimerRef.current = setTimeout(() => {
        navigate("/auth", { replace: true });
      }, 1800);
    } catch (error) {
      setServerError(error.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (!email || isResending || resendCooldown > 0) return;

    clearMessages();
    setIsResending(true);

    try {
      let response;
      try {
        response = await fetch(`${API_URL}/api/forgot-password`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
          }),
        });
      } catch {
        throw new Error(
          "Unable to connect to server. Please check if backend is running."
        );
      }

      const data = await parseResponse(response);

      if (!response.ok) {
        handleApiError(response, data, "Failed to resend OTP.");
      }

      resetOtpState();
      setStep(2);
      setResendCooldown(RESEND_SECONDS);
      setSuccessMessage(data.message || "OTP resent successfully.");
    } catch (error) {
      setServerError(error.message || "Failed to resend OTP.");
    } finally {
      setIsResending(false);
    }
  };

  const handleChangeEmail = () => {
    clearMessages();
    setStep(1);
    setEmail("");
    setResendCooldown(0);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    resetOtpState();
  };

  const handleBackToOtp = () => {
    clearMessages();
    setStep(2);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };

  return (
    <div className="auth-container">
      <h2>Forgot Password</h2>

      {step === 1 ? (
        <>
          <p className="auth-subtext">
            Enter your registered email address to receive a password reset OTP.
          </p>

          <Formik
            initialValues={{ email: "" }}
            validationSchema={EmailSchema}
            onSubmit={handleSendOtp}
          >
            {({ isSubmitting }) => (
              <Form className="auth-form">
                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <Field
                    id="email"
                    name="email"
                    type="email"
                    className="form-control"
                    placeholder="Enter your registered email"
                    autoComplete="email"
                  />
                  <ErrorMessage
                    name="email"
                    component="div"
                    className="error-message"
                  />
                </div>

                <button
                  type="submit"
                  className="auth-button"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Sending OTP..." : "Send OTP"}
                </button>

                {serverError && (
                  <div className="error-message general-error">
                    {serverError}
                  </div>
                )}

                {successMessage && (
                  <div className="success-message general-success">
                    {successMessage}
                  </div>
                )}

                <div className="auth-footer">
                  <span>Remember your password? </span>
                  <Link to="/auth">Back to Login</Link>
                </div>
              </Form>
            )}
          </Formik>
        </>
      ) : step === 2 ? (
        <>
          <p className="auth-subtext">
            Enter the OTP sent to <strong>{email}</strong>.
          </p>

          <Formik
            initialValues={{ otp: otpValue }}
            enableReinitialize
            validationSchema={OtpSchema}
            onSubmit={handleContinueWithOtp}
          >
            {({ isSubmitting, setFieldValue }) => (
              <Form className="auth-form">
                <div className="form-group">
                  <label htmlFor="otp-0">OTP</label>

                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      justifyContent: "center",
                      flexWrap: "wrap",
                      marginTop: "8px",
                    }}
                  >
                    {otpDigits.map((digit, index) => (
                      <input
                        key={index}
                        id={`otp-${index}`}
                        ref={(el) => {
                          otpInputRefs.current[index] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength="1"
                        value={digit}
                        className="form-control"
                        onChange={(e) =>
                          handleOtpDigitChange(index, e.target.value, setFieldValue)
                        }
                        onKeyDown={(e) =>
                          handleOtpKeyDown(index, e, setFieldValue)
                        }
                        onPaste={(e) => handleOtpPaste(e, setFieldValue)}
                        autoComplete="one-time-code"
                        style={{
                          width: "52px",
                          height: "52px",
                          textAlign: "center",
                          fontSize: "20px",
                          fontWeight: "700",
                        }}
                      />
                    ))}
                  </div>

                  <Field name="otp" type="hidden" />
                  <ErrorMessage
                    name="otp"
                    component="div"
                    className="error-message"
                  />
                </div>

                <button
                  type="submit"
                  className="auth-button"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Continuing..." : "Continue"}
                </button>

                {serverError && (
                  <div className="error-message general-error">
                    {serverError}
                  </div>
                )}

                {successMessage && (
                  <div className="success-message general-success">
                    {successMessage}
                  </div>
                )}

                <div className="resend-text">
                  Didn&apos;t receive OTP?{" "}
                  <span
                    className={`resend-active ${
                      isResending || resendCooldown > 0 ? "disabled-link" : ""
                    }`}
                    onClick={
                      !isResending && resendCooldown === 0
                        ? handleResendOtp
                        : undefined
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (
                        (e.key === "Enter" || e.key === " ") &&
                        !isResending &&
                        resendCooldown === 0
                      ) {
                        handleResendOtp();
                      }
                    }}
                  >
                    {isResending
                      ? "Resending..."
                      : resendCooldown > 0
                      ? `Resend OTP in ${resendCooldown}s`
                      : "Resend OTP"}
                  </span>
                </div>

                <div className="auth-footer">
                  <span>Wrong email? </span>
                  <button
                    type="button"
                    className="forgot-password-link"
                    onClick={handleChangeEmail}
                  >
                    Change Email
                  </button>
                </div>

                <div className="auth-footer">
                  <span>Back to login? </span>
                  <Link to="/auth">Login</Link>
                </div>
              </Form>
            )}
          </Formik>
        </>
      ) : (
        <>
          <p className="auth-subtext">
            Enter your new password for <strong>{email}</strong>.
          </p>

          <Formik
            initialValues={{
              newPassword: "",
              confirmPassword: "",
            }}
            validationSchema={ResetSchema}
            onSubmit={handleResetPassword}
          >
            {({ isSubmitting }) => (
              <Form className="auth-form">
                <div className="form-group">
                  <label htmlFor="savedOtp">OTP</label>
                  <input
                    id="savedOtp"
                    type="text"
                    className="form-control"
                    value={otpValue}
                    readOnly
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="newPassword">New Password</label>
                  <div className="password-input-wrapper">
                    <Field
                      id="newPassword"
                      name="newPassword"
                      type={showNewPassword ? "text" : "password"}
                      className="form-control"
                      placeholder="Enter new password"
                      autoComplete="new-password"
                    />
                  </div>
                  <button
                    type="button"
                    className="forgot-password-link password-toggle-btn"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                  >
                    {showNewPassword ? "Hide" : "Show"}
                  </button>
                  <ErrorMessage
                    name="newPassword"
                    component="div"
                    className="error-message"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm New Password</label>
                  <div className="password-input-wrapper">
                    <Field
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      className="form-control"
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                    />
                  </div>
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
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Resetting..." : "Reset Password"}
                </button>

                {serverError && (
                  <div className="error-message general-error">
                    {serverError}
                  </div>
                )}

                {successMessage && (
                  <div className="success-message general-success">
                    {successMessage}
                  </div>
                )}

                <div className="auth-footer">
                  <span>Wrong OTP? </span>
                  <button
                    type="button"
                    className="forgot-password-link"
                    onClick={handleBackToOtp}
                  >
                    Go Back
                  </button>
                </div>

                <div className="auth-footer">
                  <span>Wrong email? </span>
                  <button
                    type="button"
                    className="forgot-password-link"
                    onClick={handleChangeEmail}
                  >
                    Change Email
                  </button>
                </div>

                <div className="auth-footer">
                  <span>Back to login? </span>
                  <Link to="/auth">Login</Link>
                </div>
              </Form>
            )}
          </Formik>
        </>
      )}
    </div>
  );
};

export default ForgotPassword;