import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import axios from "axios";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import "./InterviewForm.css";

const REQUEST_TIMEOUT = 180000;
const PROFILE_REQUEST_TIMEOUT = 12000;
const INTERVIEW_LOOKUP_TIMEOUT = 15000;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function InterviewForm({ setInterviewData, interviewData }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { API_URL, getToken } = useAuth();

  const fileInputRef = useRef(null);
  const formRef = useRef(null);
  const hasInitializedRef = useRef(false);
  const progressIntervalRef = useRef(null);
  const isMountedRef = useRef(false);

  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileError, setFileError] = useState("");
  const [hasExistingInterview, setHasExistingInterview] = useState(false);
  const [existingInterviewId, setExistingInterviewId] = useState(null);
  const [checkingInterviewState, setCheckingInterviewState] = useState(true);
  const [resumeStatusLoading, setResumeStatusLoading] = useState(true);

  const [formData, setFormData] = useState({
    jobRole: "",
    company: "",
    jobDescription: "",
    companyWebsite: "",
    questionType: "Technical",
    experienceLevel: "Mid",
    resume: null,
    existingResume: false,
    existingResumeName: "",
  });

  const [errors, setErrors] = useState({
    jobRole: "",
    jobDescription: "",
    resume: "",
    general: "",
  });

  const forceResumeUpload = !!location.state?.forceResumeUpload;

  const safeSetState = useCallback((setter, value) => {
    if (!isMountedRef.current) return;

    if (typeof value === "function") {
      setter(value);
    } else {
      setter(value);
    }
  }, []);

  const clearProgressInterval = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
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

  const isFormValid = useMemo(() => {
    const hasResume =
      !!formData.resume || (!!formData.existingResume && !forceResumeUpload);

    return Boolean(
      formData.jobRole.trim() &&
        formData.jobDescription.trim() &&
        hasResume &&
        !fileError
    );
  }, [formData, forceResumeUpload, fileError]);

  const clearGeneralError = useCallback(() => {
    setErrors((prev) => ({ ...prev, general: "" }));
  }, []);

  const clearFieldError = useCallback((fieldName) => {
    setErrors((prev) => ({ ...prev, [fieldName]: "" }));
  }, []);

  const saveAndOpenInterview = useCallback(
    (preparedInterviewData) => {
      const payload = {
        ...preparedInterviewData,
        currentQuestionIndex:
          preparedInterviewData?.currentQuestionIndex ??
          preparedInterviewData?.current_question_index ??
          0,
        current_question_index:
          preparedInterviewData?.current_question_index ??
          preparedInterviewData?.currentQuestionIndex ??
          0,
      };

      localStorage.setItem("current_interview_data", JSON.stringify(payload));
      sessionStorage.setItem("liveInterviewData", JSON.stringify(payload));

      if (typeof setInterviewData === "function") {
        setInterviewData(payload);
      }

      navigate("/interview", {
        state: { interviewData: payload },
      });
    },
    [navigate, setInterviewData]
  );

  const fetchResumeStatus = useCallback(async () => {
    const token = getToken();

    if (!token) {
      safeSetState(setResumeStatusLoading, false);
      return;
    }

    try {
      safeSetState(setResumeStatusLoading, true);

      const response = await fetchWithTimeout(
        `${API_URL}/api/profile`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        PROFILE_REQUEST_TIMEOUT
      );

      const data = await parseJsonSafely(response);

      if (response.ok && data) {
        const hasResume = Boolean(
          data.active_resume || data.resume_uploaded || data.has_resume
        );

        const resumeName =
          data.resume_name ||
          data.active_resume_name ||
          data.latest_resume_name ||
          "Previously uploaded resume";

        if (hasResume && !forceResumeUpload) {
          safeSetState(setFormData, (prev) => ({
            ...prev,
            existingResume: true,
            existingResumeName: resumeName,
          }));
        }
      }
    } catch (error) {
      console.error("Failed to fetch resume status:", error);
    } finally {
      safeSetState(setResumeStatusLoading, false);
    }
  }, [
    API_URL,
    fetchWithTimeout,
    forceResumeUpload,
    getToken,
    parseJsonSafely,
    safeSetState,
  ]);

  const checkExistingInterview = useCallback(async () => {
    const token = getToken();

    if (!token) {
      safeSetState(setCheckingInterviewState, false);
      return;
    }

    try {
      safeSetState(setCheckingInterviewState, true);

      const response = await fetchWithTimeout(
        `${API_URL}/api/interviews`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        PROFILE_REQUEST_TIMEOUT
      );

      const data = await parseJsonSafely(response);

      if (!response.ok) {
        safeSetState(setHasExistingInterview, false);
        safeSetState(setExistingInterviewId, null);
        return;
      }

      const interviews = Array.isArray(data.interviews) ? data.interviews : [];
      const unfinishedInterview = interviews.find(
        (item) => !item.completed && !item.completed_at
      );

      if (unfinishedInterview) {
        safeSetState(setHasExistingInterview, true);
        safeSetState(setExistingInterviewId, unfinishedInterview.id);
      } else {
        safeSetState(setHasExistingInterview, false);
        safeSetState(setExistingInterviewId, null);
      }
    } catch (error) {
      console.error("Failed to check existing interview:", error);
      safeSetState(setHasExistingInterview, false);
      safeSetState(setExistingInterviewId, null);
    } finally {
      safeSetState(setCheckingInterviewState, false);
    }
  }, [API_URL, fetchWithTimeout, getToken, parseJsonSafely, safeSetState]);

  useEffect(() => {
    isMountedRef.current = true;

    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      fetchResumeStatus();
      checkExistingInterview();
    }

    return () => {
      isMountedRef.current = false;
      clearProgressInterval();
    };
  }, [fetchResumeStatus, checkExistingInterview, clearProgressInterval]);

  useEffect(() => {
    if (!interviewData) return;

    safeSetState(setFormData, (prev) => ({
      ...prev,
      jobRole: interviewData.jobRole || prev.jobRole,
      company: interviewData.company || prev.company,
      jobDescription: interviewData.jobDescription || prev.jobDescription,
      companyWebsite: interviewData.companyWebsite || prev.companyWebsite,
      questionType: interviewData.questionType || prev.questionType,
      experienceLevel: interviewData.experienceLevel || prev.experienceLevel,
    }));
  }, [interviewData, safeSetState]);

  const handleChange = useCallback(
    (e) => {
      const { name, value } = e.target;

      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));

      if (errors[name]) {
        clearFieldError(name);
      }

      if (errors.general) {
        clearGeneralError();
      }
    },
    [clearFieldError, clearGeneralError, errors]
  );

  const resetFileInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleFileChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];

      setFileError("");
      setErrors((prev) => ({ ...prev, resume: "", general: "" }));

      if (!file) return;

      const lowerName = file.name.toLowerCase();

      if (!lowerName.endsWith(".pdf")) {
        setFileError("Only PDF resumes are supported");
        setFormData((prev) => ({
          ...prev,
          resume: null,
        }));
        resetFileInput();
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setFileError("File size should be less than 5MB");
        setFormData((prev) => ({
          ...prev,
          resume: null,
        }));
        resetFileInput();
        return;
      }

      setFormData((prev) => ({
        ...prev,
        resume: file,
        existingResume: false,
        existingResumeName: prev.existingResumeName || "",
      }));
    },
    [resetFileInput]
  );

  const handleUseExistingResume = useCallback(() => {
    setFileError("");
    setErrors((prev) => ({ ...prev, resume: "", general: "" }));
    resetFileInput();

    setFormData((prev) => ({
      ...prev,
      resume: null,
      existingResume: true,
    }));
  }, [resetFileInput]);

  const handleRemoveResume = useCallback(() => {
    setFileError("");
    clearFieldError("resume");
    resetFileInput();

    setFormData((prev) => ({
      ...prev,
      resume: null,
      existingResume: false,
      existingResumeName: forceResumeUpload ? "" : prev.existingResumeName,
    }));
  }, [clearFieldError, forceResumeUpload, resetFileInput]);

  const validateForm = useCallback(() => {
    const hasResume =
      !!formData.resume || (!!formData.existingResume && !forceResumeUpload);

    const newErrors = {
      jobRole: !formData.jobRole.trim() ? "Job role is required" : "",
      jobDescription: !formData.jobDescription.trim()
        ? "Job description is required"
        : "",
      resume: !hasResume ? "Resume is required" : "",
      general: "",
    };

    setErrors(newErrors);
    return !Object.values(newErrors).some(Boolean);
  }, [formData, forceResumeUpload]);

  const buildInterviewPayload = useCallback(() => {
    return {
      jobRole: formData.jobRole.trim(),
      company: formData.company.trim(),
      jobDescription: formData.jobDescription.trim(),
      companyWebsite: formData.companyWebsite.trim(),
      questionType: formData.questionType,
      experienceLevel: formData.experienceLevel,
    };
  }, [formData]);

  const handleContinueExistingInterview = useCallback(async () => {
    const token = getToken();

    if (!token || !existingInterviewId) {
      setErrors((prev) => ({
        ...prev,
        general: "Unable to continue interview right now.",
      }));
      return;
    }

    try {
      safeSetState(setIsLoading, true);
      safeSetState(setProgress, 25);
      clearGeneralError();

      const [detailRes, stateRes] = await Promise.all([
        fetchWithTimeout(
          `${API_URL}/api/interviews/${existingInterviewId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          INTERVIEW_LOOKUP_TIMEOUT
        ),
        fetchWithTimeout(
          `${API_URL}/api/interview/${existingInterviewId}/state`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
          INTERVIEW_LOOKUP_TIMEOUT
        ),
      ]);

      const detailData = await parseJsonSafely(detailRes);
      const stateData = await parseJsonSafely(stateRes);

      if (!detailRes.ok) {
        throw new Error(detailData.error || "Failed to continue interview.");
      }

      if (!stateRes.ok) {
        throw new Error(stateData.error || "Failed to restore interview state.");
      }

      const restoredInterviewData = {
        ...(detailData.interviewData || detailData),
        ...(stateData || {}),
      };

      if (
        !restoredInterviewData ||
        !Array.isArray(restoredInterviewData.questions)
      ) {
        throw new Error("Interview data could not be restored.");
      }

      safeSetState(setProgress, 100);
      saveAndOpenInterview(restoredInterviewData);
    } catch (error) {
      console.error("Continue interview error:", error);
      setErrors((prev) => ({
        ...prev,
        general: error.message || "Failed to continue interview.",
      }));
    } finally {
      safeSetState(setIsLoading, false);
      safeSetState(setProgress, 0);
    }
  }, [
    API_URL,
    clearGeneralError,
    existingInterviewId,
    fetchWithTimeout,
    getToken,
    parseJsonSafely,
    safeSetState,
    saveAndOpenInterview,
  ]);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();

      if (isLoading) return;
      if (!validateForm()) return;

      const token = getToken();

      if (!token) {
        setErrors((prev) => ({
          ...prev,
          general: "You are not logged in. Please log in again.",
        }));
        return;
      }

      safeSetState(setIsLoading, true);
      safeSetState(setProgress, 10);
      clearGeneralError();
      clearProgressInterval();

      try {
        const payload = buildInterviewPayload();
        const data = new FormData();

        Object.entries(payload).forEach(([key, value]) => {
          data.append(key, value);
        });

        if (formData.resume) {
          data.append("resume", formData.resume);
        } else if (formData.existingResume && !forceResumeUpload) {
          data.append("useExistingResume", "true");
        }

        progressIntervalRef.current = setInterval(() => {
          safeSetState(setProgress, (prev) => {
            const next = prev + Math.random() * 5;
            return next > 92 ? 92 : next;
          });
        }, 500);

        const response = await axios.post(
          `${API_URL}/api/generate_questions`,
          data,
          {
            headers: {
              "Content-Type": "multipart/form-data",
              Authorization: `Bearer ${token}`,
            },
            timeout: REQUEST_TIMEOUT,
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percentCompleted = Math.round(
                  (progressEvent.loaded * 100) / progressEvent.total
                );
                safeSetState(
                  setProgress,
                  percentCompleted < 10 ? 10 : percentCompleted
                );
              }
            },
          }
        );

        clearProgressInterval();
        safeSetState(setProgress, 100);

        const responseData = response.data || {};
        const preparedInterviewData = {
          ...payload,
          ...(responseData.interview || responseData.interviewData || {}),
          interview_id:
            responseData.interview_id ||
            responseData.interview?.id ||
            responseData.interviewData?.id ||
            null,
          questions: Array.isArray(responseData.questions)
            ? responseData.questions
            : Array.isArray(responseData.interview?.questions)
            ? responseData.interview.questions
            : Array.isArray(responseData.interviewData?.questions)
            ? responseData.interviewData.questions
            : [],
          resumeInsights: responseData.resume_insights || [],
          currentQuestionIndex:
            responseData.currentQuestionIndex ??
            responseData.current_question_index ??
            responseData.interview?.currentQuestionIndex ??
            responseData.interview?.current_question_index ??
            responseData.interviewData?.currentQuestionIndex ??
            responseData.interviewData?.current_question_index ??
            0,
          current_question_index:
            responseData.current_question_index ??
            responseData.currentQuestionIndex ??
            responseData.interview?.current_question_index ??
            responseData.interview?.currentQuestionIndex ??
            responseData.interviewData?.current_question_index ??
            responseData.interviewData?.currentQuestionIndex ??
            0,
          answers:
            responseData.answers ||
            responseData.interview?.answers ||
            responseData.interviewData?.answers ||
            [],
          feedback:
            responseData.feedback ||
            responseData.interview?.feedback ||
            responseData.interviewData?.feedback ||
            null,
          overallScore:
            responseData.overall_score ??
            responseData.interview?.overall_score ??
            responseData.interviewData?.overall_score ??
            null,
          resumeName:
            formData.resume?.name ||
            formData.existingResumeName ||
            "Previously uploaded resume",
          usingExistingResume: !!(formData.existingResume && !formData.resume),
        };

        if (!preparedInterviewData.questions.length) {
          throw new Error("No interview questions were returned by the server.");
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
        saveAndOpenInterview(preparedInterviewData);
      } catch (err) {
        console.error("Error generating questions:", err);

        let errorMessage = "Failed to generate questions. Please try again.";

        if (err.code === "ECONNABORTED") {
          errorMessage =
            "Taking longer than expected. Please try again or remove the company website field.";
        } else if (err.response?.data?.error) {
          errorMessage = err.response.data.error;
        } else if (err.response?.data?.message) {
          errorMessage = err.response.data.message;
        } else if (err.response?.data?.details) {
          errorMessage = err.response.data.details;
        } else if (err.message) {
          errorMessage = err.message;
        }

        setErrors((prev) => ({ ...prev, general: errorMessage }));
      } finally {
        clearProgressInterval();
        safeSetState(setIsLoading, false);
        safeSetState(setProgress, 0);
      }
    },
    [
      API_URL,
      buildInterviewPayload,
      clearGeneralError,
      clearProgressInterval,
      forceResumeUpload,
      formData.existingResume,
      formData.existingResumeName,
      formData.resume,
      getToken,
      isLoading,
      safeSetState,
      saveAndOpenInterview,
      validateForm,
    ]
  );

  return (
    <div className="interview-form-container">
      <div className="interview-form-card">
        <div className="form-header">
          <h2>Configure Your Mock Interview</h2>
          <p className="subtitle">
            Get personalized questions based on your resume and target position
          </p>
        </div>

        {checkingInterviewState && (
          <div className="info-message" style={{ marginBottom: "16px" }}>
            Checking for unfinished interview sessions...
          </div>
        )}

        {!checkingInterviewState && hasExistingInterview && (
          <div
            className="info-message"
            style={{
              marginBottom: "16px",
              padding: "14px 16px",
              borderRadius: "10px",
              background: "#e8f4fd",
              border: "1px solid #b6e0fe",
              color: "#0c5460",
            }}
          >
            <strong>Unfinished interview found.</strong>
            <p style={{ margin: "8px 0 12px" }}>
              You have an interview in progress. You can continue it or start a
              new one.
            </p>
            <button
              type="button"
              className="submit-button"
              onClick={handleContinueExistingInterview}
              disabled={isLoading}
              style={{ maxWidth: "220px" }}
            >
              {isLoading ? "Opening..." : "▶ Continue Interview"}
            </button>
          </div>
        )}

        {errors.general && (
          <div className="error-message">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {errors.general}
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} className="interview-form">
          <div className="row">
            <div className="form-group">
              <label htmlFor="jobRole">Target Job Role *</label>
              <input
                type="text"
                id="jobRole"
                name="jobRole"
                value={formData.jobRole}
                onChange={handleChange}
                className={`form-control ${errors.jobRole ? "error" : ""}`}
                placeholder="e.g. Software Engineer, Data Scientist"
              />
              {errors.jobRole && (
                <div className="error-message">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {errors.jobRole}
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="company">Company Name</label>
              <input
                type="text"
                id="company"
                name="company"
                value={formData.company}
                onChange={handleChange}
                className="form-control"
                placeholder="e.g. Google, Amazon"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="jobDescription">Job Description *</label>
            <textarea
              id="jobDescription"
              name="jobDescription"
              value={formData.jobDescription}
              onChange={handleChange}
              className={`form-control ${errors.jobDescription ? "error" : ""}`}
              rows="5"
              placeholder="Paste the job description or key requirements..."
            ></textarea>
            {errors.jobDescription && (
              <div className="error-message">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {errors.jobDescription}
              </div>
            )}
          </div>

          <div className="row">
            <div className="form-group">
              <label htmlFor="companyWebsite">Company Website</label>
              <input
                type="url"
                id="companyWebsite"
                name="companyWebsite"
                value={formData.companyWebsite}
                onChange={handleChange}
                className="form-control"
                placeholder="https://company.com/careers"
              />
              <small className="form-hint">
                We&apos;ll analyze the company culture and values
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="experienceLevel">Experience Level</label>
              <select
                id="experienceLevel"
                name="experienceLevel"
                value={formData.experienceLevel}
                onChange={handleChange}
                className="form-select"
              >
                <option value="Entry">Entry Level</option>
                <option value="Mid">Mid Level</option>
                <option value="Senior">Senior Level</option>
              </select>
            </div>
          </div>

          <div className="row">
            <div className="form-group">
              <label htmlFor="questionType">Question Type</label>
              <select
                id="questionType"
                name="questionType"
                value={formData.questionType}
                onChange={handleChange}
                className="form-select"
              >
                <option value="Technical">Technical</option>
                <option value="Behavioral">Behavioral</option>
                <option value="Mixed">Mixed (Technical + Behavioral)</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="resume">Upload Resume (PDF only) *</label>

              {resumeStatusLoading ? (
                <div className="form-hint">Checking existing resume status...</div>
              ) : (
                <>
                  {formData.existingResume &&
                    !forceResumeUpload &&
                    !formData.resume && (
                      <div
                        className="file-selected"
                        style={{
                          marginBottom: "10px",
                          background: "#eefaf0",
                          border: "1px solid #b7e4c7",
                          color: "#1b5e20",
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        Using saved resume:{" "}
                        {formData.existingResumeName ||
                          "Previously uploaded resume"}
                      </div>
                    )}

                  <div className="file-input-container">
                    <input
                      type="file"
                      id="resume"
                      name="resume"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className={`form-control ${
                        errors.resume || fileError ? "error" : ""
                      }`}
                      accept=".pdf"
                    />

                    {formData.resume && (
                      <div className="file-selected">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        {formData.resume.name}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      flexWrap: "wrap",
                      marginTop: "10px",
                    }}
                  >
                    {formData.existingResumeName && !forceResumeUpload && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={handleUseExistingResume}
                        disabled={isLoading}
                      >
                        Use Saved Resume
                      </button>
                    )}

                    {(formData.resume || formData.existingResume) && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={handleRemoveResume}
                        disabled={isLoading}
                      >
                        Remove Resume
                      </button>
                    )}
                  </div>
                </>
              )}

              {(errors.resume || fileError) && (
                <div className="error-message">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {errors.resume || fileError}
                </div>
              )}

              <small className="form-hint">
                PDF only (max 5MB)
                {forceResumeUpload ? " — please upload a new resume now" : ""}
              </small>
            </div>
          </div>

          <div className="form-footer">
            <button
              type="submit"
              className="submit-button"
              disabled={isLoading || !isFormValid}
            >
              {isLoading ? (
                <>
                  <span className="spinner"></span>
                  Generating AI Questions... ({Math.round(progress)}%)
                </>
              ) : (
                <>
                  <span className="icon">🚀</span>
                  Generate Questions
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default InterviewForm;