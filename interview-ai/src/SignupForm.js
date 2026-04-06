import React, { useEffect, useRef, useState } from "react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import * as Yup from "yup";
import "./AuthForms.css";

const API_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:5000";
const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

const RegisterSchema = Yup.object().shape({
  name: Yup.string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters")
    .required("Name is required"),
  email: Yup.string()
    .trim()
    .email("Invalid email address")
    .required("Email is required"),
  password: Yup.string()
    .min(6, "Password must be at least 6 characters")
    .max(50, "Password must be at most 50 characters")
    .required("Password is required"),
});

const VerifySchema = Yup.object().shape({
  otp: Yup.string()
    .trim()
    .length(OTP_LENGTH, `OTP must be ${OTP_LENGTH} digits`)
    .required("OTP is required"),
});

const SignupForm = ({ onSignupSuccess }) => {
  const otpInputRefs = useRef([]);
  const redirectTimerRef = useRef(null);

  const [step, setStep] = useState(1); // 1 = signup, 2 = verify otp
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [otpDigits, setOtpDigits] = useState(Array(OTP_LENGTH).fill(""));
  const [serverError, setServerError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
    setServerError("");
    setSuccessMessage("");
  };

  const parseResponse = async (response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const resetOtpState = () => {
    setOtpDigits(Array(OTP_LENGTH).fill(""));
  };

  const handleOtpDigitChange = (index, value, setFieldValue) => {
    if (!/^\d?$/.test(value)) return;

    const updated = [...otpDigits];
    updated[index] = value;
    setOtpDigits(updated);
    setFieldValue("otp", updated.join(""));

    if (value && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, event, setFieldValue) => {
    if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
      const updated = [...otpDigits];
      updated[index - 1] = "";
      setOtpDigits(updated);
      setFieldValue("otp", updated.join(""));
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

    setOtpDigits(updated);
    setFieldValue("otp", updated.join(""));

    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    otpInputRefs.current[focusIndex]?.focus();
  };

  const handleRegister = async (values, { setSubmitting, resetForm }) => {
    clearMessages();

    try {
      const payload = {
        name: values.name.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
      };

      let response;
      try {
        response = await fetch(`${API_URL}/api/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch {
        throw new Error(
          "Unable to connect to server. Please check if backend is running."
        );
      }

      const data = await parseResponse(response);

      if (!response.ok) {
        if (response.status === 400) {
          throw new Error(data.error || "Registration failed.");
        }
        if (response.status === 500) {
          throw new Error(data.error || "Server error during registration.");
        }
        throw new Error(data.error || data.message || "Failed to register.");
      }

      setRegisteredEmail(payload.email);
      setStep(2);
      setResendCooldown(RESEND_SECONDS);
      resetOtpState();
      resetForm();

      setSuccessMessage(
        data.message || "Registered successfully. OTP sent to your email."
      );
    } catch (error) {
      setServerError(error.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (values, { setSubmitting, resetForm }) => {
    clearMessages();

    try {
      let response;
      try {
        response = await fetch(`${API_URL}/api/verify-otp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: registeredEmail.trim().toLowerCase(),
            otp: values.otp.trim(),
          }),
        });
      } catch {
        throw new Error(
          "Unable to connect to server. Please check if backend is running."
        );
      }

      const data = await parseResponse(response);

      if (!response.ok) {
        if (response.status === 400) {
          throw new Error(data.error || "Invalid or expired OTP.");
        }
        if (response.status === 404) {
          throw new Error(data.error || "User not found.");
        }
        if (response.status === 500) {
          throw new Error(data.error || "Server error while verifying OTP.");
        }
        throw new Error(data.error || data.message || "Failed to verify OTP.");
      }

      resetForm();
      resetOtpState();
      setSuccessMessage(
        data.message || "Email verified successfully. You can now log in."
      );

      if (typeof onSignupSuccess === "function") {
        redirectTimerRef.current = setTimeout(() => {
          onSignupSuccess();
        }, 1500);
      }
    } catch (error) {
      setServerError(error.message || "OTP verification failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (!registeredEmail || isResending || resendCooldown > 0) return;

    clearMessages();
    setIsResending(true);

    try {
      let response;
      try {
        response = await fetch(`${API_URL}/api/resend-otp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: registeredEmail.trim().toLowerCase(),
          }),
        });
      } catch {
        throw new Error(
          "Unable to connect to server. Please check if backend is running."
        );
      }

      const data = await parseResponse(response);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(data.error || "User not found.");
        }
        if (response.status === 500) {
          throw new Error(data.error || "Failed to resend OTP.");
        }
        throw new Error(data.error || data.message || "Failed to resend OTP.");
      }

      resetOtpState();
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
    setRegisteredEmail("");
    setResendCooldown(0);
    resetOtpState();
  };

  return (
    <div>
      {step === 1 ? (
        <>
          <p className="auth-subtext">
            Create your account to get started with AI-powered mock interviews.
          </p>

          <Formik
            initialValues={{
              name: "",
              email: "",
              password: "",
            }}
            validationSchema={RegisterSchema}
            onSubmit={handleRegister}
          >
            {({ isSubmitting }) => (
              <Form className="auth-form">
                <div className="form-group">
                  <label htmlFor="signup-name">Full Name</label>
                  <Field
                    id="signup-name"
                    name="name"
                    type="text"
                    className="form-control"
                    placeholder="Enter your full name"
                    autoComplete="name"
                  />
                  <ErrorMessage
                    name="name"
                    component="div"
                    className="error-message"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="signup-email">Email</label>
                  <Field
                    id="signup-email"
                    name="email"
                    type="email"
                    className="form-control"
                    placeholder="Enter your email"
                    autoComplete="email"
                  />
                  <ErrorMessage
                    name="email"
                    component="div"
                    className="error-message"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="signup-password">Password</label>
                  <Field
                    id="signup-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    className="form-control"
                    placeholder="Create a password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="forgot-password-link password-toggle-btn"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                  <ErrorMessage
                    name="password"
                    component="div"
                    className="error-message"
                  />
                </div>

                <button
                  type="submit"
                  className="auth-button"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Creating Account..." : "Create Account"}
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
              </Form>
            )}
          </Formik>
        </>
      ) : (
        <>
          <p className="auth-subtext">
            Enter the OTP sent to <strong>{registeredEmail}</strong> to verify
            your account.
          </p>

          <Formik
            initialValues={{ otp: "" }}
            validationSchema={VerifySchema}
            onSubmit={handleVerifyOtp}
          >
            {({ isSubmitting, setFieldValue }) => (
              <Form className="auth-form">
                <div className="form-group">
                  <label htmlFor="otp-0">OTP Verification</label>

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
                  {isSubmitting ? "Verifying..." : "Verify OTP"}
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
                    className="auth-switch-btn"
                    onClick={handleChangeEmail}
                  >
                    Change Email
                  </button>
                </div>
              </Form>
            )}
          </Formik>
        </>
      )}
    </div>
  );
};

export default SignupForm;