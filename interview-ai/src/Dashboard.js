import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import "./Dashboard.css";

const REQUEST_TIMEOUT = 12000;

const Dashboard = () => {
  const {
    user,
    isAuthenticated,
    getToken,
    API_URL,
    logout,
    updateUser,
    loading: authLoading,
  } = useAuth();

  const navigate = useNavigate();

  const apiUrlRef = useRef(API_URL);
  const userRef = useRef(user);
  const activeAbortControllerRef = useRef(null);
  const isMountedRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);

  const [profile, setProfile] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restartingInterviewId, setRestartingInterviewId] = useState(null);
  const [continuingInterviewId, setContinuingInterviewId] = useState(null);
  const [reviewingInterviewId, setReviewingInterviewId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiUrlRef.current = API_URL;
  }, [API_URL]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const safeSetState = useCallback((setter, value) => {
    if (isMountedRef.current) {
      setter(value);
    }
  }, []);

  const abortActiveRequest = useCallback(() => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
  }, []);

  const fetchWithTimeout = useCallback(
    async (url, options = {}, timeout = REQUEST_TIMEOUT) => {
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
    },
    []
  );

  const parseJsonSafely = useCallback(async (response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }, []);

  const handleUnauthorized = useCallback(() => {
    safeSetState(setError, "Your session expired. Please log in again.");
    if (typeof logout === "function") {
      logout();
    }
    navigate("/auth", { replace: true });
  }, [logout, navigate, safeSetState]);

  const normalizeInterview = useCallback((item) => {
    if (!item || typeof item !== "object") return null;

    const questions = Array.isArray(item.questions) ? item.questions : [];
    const answers = Array.isArray(item.answers) ? item.answers : [];
    const feedback = Array.isArray(item.feedback) ? item.feedback : [];

    const completed =
      !!item.completed ||
      !!item.completed_at ||
      item.status === "completed";

    const finalScore =
      item.final_score ??
      item.overall_score ??
      item.score ??
      null;

    return {
      ...item,
      questions,
      answers,
      feedback,
      completed,
      completed_at: item.completed_at || null,
      current_question_index:
        typeof item.current_question_index === "number"
          ? item.current_question_index
          : typeof item.currentQuestionIndex === "number"
          ? item.currentQuestionIndex
          : 0,
      final_score:
        finalScore !== null &&
        finalScore !== undefined &&
        !Number.isNaN(Number(finalScore))
          ? Number(finalScore)
          : null,
    };
  }, []);

  const normalizeProfile = useCallback((data) => {
    if (!data || typeof data !== "object") return null;

    const totalInterviews = data.totalInterviews ?? data.total_interviews ?? 0;
    const completed = data.completed ?? data.completed_interviews ?? 0;
    const inProgress = data.inProgress ?? data.in_progress_interviews ?? 0;
    const avgScore = data.avgScore ?? data.average_score ?? 0;
    const hasResume =
      data.has_resume ?? data.resume_uploaded ?? data.active_resume ?? false;
    const resumeName = data.resume_name ?? data.active_resume_name ?? "";

    return {
      ...data,
      totalInterviews: Number(totalInterviews) || 0,
      total_interviews: Number(totalInterviews) || 0,
      completed: Number(completed) || 0,
      completed_interviews: Number(completed) || 0,
      inProgress: Number(inProgress) || 0,
      in_progress_interviews: Number(inProgress) || 0,
      avgScore:
        avgScore !== null &&
        avgScore !== undefined &&
        !Number.isNaN(Number(avgScore))
          ? Number(avgScore)
          : 0,
      average_score:
        avgScore !== null &&
        avgScore !== undefined &&
        !Number.isNaN(Number(avgScore))
          ? Number(avgScore)
          : 0,
      has_resume: !!hasResume,
      resume_uploaded: !!hasResume,
      active_resume: !!hasResume,
      resume_name: resumeName,
      active_resume_name: resumeName,
    };
  }, []);

  const fetchDashboardData = useCallback(
    async (showRefreshState = false) => {
      const token = getToken();

      if (!token) {
        safeSetState(setProfile, null);
        safeSetState(setInterviews, []);
        safeSetState(setLoading, false);
        return false;
      }

      if (showRefreshState) {
        safeSetState(setRefreshing, true);
      } else {
        safeSetState(setLoading, true);
      }

      safeSetState(setError, "");
      abortActiveRequest();

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;

      try {
        const headers = {
          Authorization: `Bearer ${token}`,
        };

        const [profileRes, interviewsRes] = await Promise.all([
          fetchWithTimeout(
            `${apiUrlRef.current}/api/profile`,
            {
              method: "GET",
              headers,
              signal: controller.signal,
            },
            REQUEST_TIMEOUT
          ),
          fetchWithTimeout(
            `${apiUrlRef.current}/api/interviews`,
            {
              method: "GET",
              headers,
              signal: controller.signal,
            },
            REQUEST_TIMEOUT
          ),
        ]);

        if (profileRes.status === 401 || interviewsRes.status === 401) {
          handleUnauthorized();
          return false;
        }

        if (!profileRes.ok) {
          const profileError = await parseJsonSafely(profileRes);
          throw new Error(
            profileError.error || `Profile request failed (${profileRes.status})`
          );
        }

        if (!interviewsRes.ok) {
          const interviewsError = await parseJsonSafely(interviewsRes);
          throw new Error(
            interviewsError.error ||
              `Interviews request failed (${interviewsRes.status})`
          );
        }

        const profileData = normalizeProfile(await parseJsonSafely(profileRes));
        const interviewsData = await parseJsonSafely(interviewsRes);

        const rawInterviews = Array.isArray(interviewsData?.interviews)
          ? interviewsData.interviews
          : Array.isArray(interviewsData)
          ? interviewsData
          : [];

        const normalizedInterviews = rawInterviews
          .map(normalizeInterview)
          .filter(Boolean);

        safeSetState(setProfile, profileData);
        safeSetState(setInterviews, normalizedInterviews);

        if (profileData && typeof updateUser === "function") {
          const currentUser = userRef.current || {};
          const nextId = profileData.id || profileData.user_id || currentUser.id;
          const nextName = profileData.name || currentUser.name || "User";
          const nextEmail = profileData.email || currentUser.email || "";

          const changed =
            currentUser.id !== nextId ||
            currentUser.name !== nextName ||
            currentUser.email !== nextEmail;

          if (changed) {
            updateUser({
              id: nextId,
              name: nextName,
              email: nextEmail,
            });
          }
        }

        hasLoadedOnceRef.current = true;
        return true;
      } catch (err) {
        if (err?.name === "AbortError") {
          return false;
        }

        console.error("Failed to load dashboard:", err);
        safeSetState(
          setError,
          err.message || "Failed to load dashboard data."
        );
        return false;
      } finally {
        if (activeAbortControllerRef.current === controller) {
          activeAbortControllerRef.current = null;
        }
        safeSetState(setLoading, false);
        safeSetState(setRefreshing, false);
      }
    },
    [
      abortActiveRequest,
      fetchWithTimeout,
      getToken,
      handleUnauthorized,
      normalizeInterview,
      normalizeProfile,
      parseJsonSafely,
      safeSetState,
      updateUser,
    ]
  );

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      abortActiveRequest();
    };
  }, [abortActiveRequest]);

  useEffect(() => {
    if (authLoading) {
      safeSetState(setLoading, true);
      return;
    }

    const token = getToken();

    if (!isAuthenticated || !token) {
      hasLoadedOnceRef.current = false;
      safeSetState(setProfile, null);
      safeSetState(setInterviews, []);
      safeSetState(setLoading, false);
      return;
    }

    fetchDashboardData(false);
  }, [
    authLoading,
    isAuthenticated,
    user?.id,
    fetchDashboardData,
    getToken,
    safeSetState,
  ]);

  const handleStartNewInterview = useCallback(() => {
    navigate("/interview-question");
  }, [navigate]);

  const handleUploadResume = useCallback(() => {
    navigate("/interview-question", {
      state: {
        forceResumeUpload: true,
      },
    });
  }, [navigate]);

  const saveInterviewAndNavigate = useCallback(
    (interviewData, extraState = {}) => {
      const payload = {
        ...interviewData,
        ...extraState,
      };

      sessionStorage.setItem("liveInterviewData", JSON.stringify(payload));
      localStorage.setItem("current_interview_data", JSON.stringify(payload));

      navigate("/interview", {
        state: payload,
      });
    },
    [navigate]
  );

  const handleStartAgain = useCallback(
    async (interview) => {
      try {
        safeSetState(setRestartingInterviewId, interview.id);
        safeSetState(setError, "");

        const token = getToken();
        if (!token) {
          handleUnauthorized();
          return;
        }

        const response = await fetchWithTimeout(
          `${apiUrlRef.current}/api/interviews/${interview.id}/restart`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          },
          25000
        );

        const data = await parseJsonSafely(response);

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        if (!response.ok) {
          throw new Error(data.error || "Failed to start interview again");
        }

        const interviewData = normalizeInterview(data.interviewData || data);

        if (
          !interviewData ||
          !Array.isArray(interviewData.questions) ||
          interviewData.questions.length === 0
        ) {
          throw new Error("New interview questions were not returned by the server.");
        }

        saveInterviewAndNavigate(interviewData, {
          readOnly: false,
          reviewMode: false,
        });
      } catch (err) {
        console.error("Failed to restart interview:", err);
        safeSetState(
          setError,
          err.name === "AbortError"
            ? "Restart request timed out. Please try again."
            : err.message || "Could not start the interview again."
        );
      } finally {
        safeSetState(setRestartingInterviewId, null);
      }
    },
    [
      fetchWithTimeout,
      getToken,
      handleUnauthorized,
      normalizeInterview,
      parseJsonSafely,
      saveInterviewAndNavigate,
      safeSetState,
    ]
  );

  const handleContinueInterview = useCallback(
    async (interview) => {
      try {
        safeSetState(setContinuingInterviewId, interview.id);
        safeSetState(setError, "");

        const token = getToken();
        if (!token) {
          handleUnauthorized();
          return;
        }

        const [stateRes, detailRes] = await Promise.all([
          fetchWithTimeout(
            `${apiUrlRef.current}/api/interview/${interview.id}/state`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
            15000
          ),
          fetchWithTimeout(
            `${apiUrlRef.current}/api/interviews/${interview.id}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
            15000
          ),
        ]);

        if (stateRes.status === 401 || detailRes.status === 401) {
          handleUnauthorized();
          return;
        }

        const stateData = await parseJsonSafely(stateRes);
        const detailData = await parseJsonSafely(detailRes);

        if (!stateRes.ok) {
          throw new Error(stateData.error || "Failed to load interview state");
        }

        if (!detailRes.ok) {
          throw new Error(detailData.error || "Failed to load interview details");
        }

        const interviewData = normalizeInterview({
          ...(detailData.interviewData || detailData.interview || detailData),
          ...(stateData || {}),
        });

        if (!interviewData || !Array.isArray(interviewData.questions)) {
          throw new Error("Interview data not found for continuation.");
        }

        if (interviewData.completed || interviewData.completed_at) {
          throw new Error("This interview is already completed. Please review it instead.");
        }

        saveInterviewAndNavigate(interviewData, {
          readOnly: false,
          reviewMode: false,
        });
      } catch (err) {
        console.error("Failed to continue interview:", err);
        safeSetState(
          setError,
          err.name === "AbortError"
            ? "Continue request timed out. Please try again."
            : err.message || "Could not continue the interview."
        );
      } finally {
        safeSetState(setContinuingInterviewId, null);
      }
    },
    [
      fetchWithTimeout,
      getToken,
      handleUnauthorized,
      normalizeInterview,
      parseJsonSafely,
      saveInterviewAndNavigate,
      safeSetState,
    ]
  );

  const handleReviewInterview = useCallback(
    async (interview) => {
      try {
        safeSetState(setReviewingInterviewId, interview.id);
        safeSetState(setError, "");

        const token = getToken();
        if (!token) {
          handleUnauthorized();
          return;
        }

        const [stateRes, detailRes] = await Promise.all([
          fetchWithTimeout(
            `${apiUrlRef.current}/api/interview/${interview.id}/state`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
            15000
          ),
          fetchWithTimeout(
            `${apiUrlRef.current}/api/interviews/${interview.id}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
            15000
          ),
        ]);

        if (stateRes.status === 401 || detailRes.status === 401) {
          handleUnauthorized();
          return;
        }

        const stateData = await parseJsonSafely(stateRes);
        const detailData = await parseJsonSafely(detailRes);

        if (!stateRes.ok) {
          throw new Error(stateData.error || "Failed to load interview review data");
        }

        if (!detailRes.ok) {
          throw new Error(detailData.error || "Failed to load interview review details");
        }

        const interviewData = normalizeInterview({
          ...(detailData.interviewData || detailData.interview || detailData),
          ...(stateData || {}),
        });

        if (!interviewData || !Array.isArray(interviewData.questions)) {
          throw new Error("Completed interview data is not available.");
        }

        saveInterviewAndNavigate(interviewData, {
          readOnly: true,
          reviewMode: true,
          completed: true,
        });
      } catch (err) {
        console.error("Failed to review interview:", err);
        safeSetState(
          setError,
          err.name === "AbortError"
            ? "Review request timed out. Please try again."
            : err.message || "Could not open interview review."
        );
      } finally {
        safeSetState(setReviewingInterviewId, null);
      }
    },
    [
      fetchWithTimeout,
      getToken,
      handleUnauthorized,
      normalizeInterview,
      parseJsonSafely,
      saveInterviewAndNavigate,
      safeSetState,
    ]
  );

  const formatDate = useCallback((dateValue) => {
    if (!dateValue) return "Unknown date";
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "Unknown date";

    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, []);

  const sortedInterviews = useMemo(() => {
    return [...interviews].sort((a, b) => {
      const aTime = new Date(a?.started_at || 0).getTime();
      const bTime = new Date(b?.started_at || 0).getTime();
      return bTime - aTime;
    });
  }, [interviews]);

  const completedInterviewsCount = useMemo(() => {
    return sortedInterviews.filter((item) => item.completed).length;
  }, [sortedInterviews]);

  const inProgressCount = useMemo(() => {
    return sortedInterviews.filter((item) => !item.completed).length;
  }, [sortedInterviews]);

  const averageScore = useMemo(() => {
    if (
      profile?.avgScore !== null &&
      profile?.avgScore !== undefined &&
      !Number.isNaN(Number(profile.avgScore))
    ) {
      return Number(profile.avgScore);
    }

    if (
      profile?.average_score !== null &&
      profile?.average_score !== undefined &&
      !Number.isNaN(Number(profile.average_score))
    ) {
      return Number(profile.average_score);
    }

    const completedScores = sortedInterviews
      .filter((item) => item.completed && item.final_score !== null)
      .map((item) => Number(item.final_score))
      .filter((score) => !Number.isNaN(score));

    if (!completedScores.length) return 0;

    const total = completedScores.reduce((sum, score) => sum + score, 0);
    return Math.round((total / completedScores.length) * 10) / 10;
  }, [profile, sortedInterviews]);

  const getInterviewStatusMeta = useCallback((interview) => {
    if (interview.completed) {
      return {
        label: "✅ Completed",
        color: "#155724",
        background: "#d4edda",
      };
    }

    const questionNumber = Number(interview.current_question_index || 0) + 1;
    return {
      label: `⏳ In Progress${questionNumber > 0 ? ` · Question ${questionNumber}` : ""}`,
      color: "#0c5460",
      background: "#d1ecf1",
    };
  }, []);

  const handleManualRefresh = useCallback(() => {
    fetchDashboardData(true);
  }, [fetchDashboardData]);

  if (authLoading || loading) {
    return (
      <div className="dashboard-container">
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <p style={{ fontSize: "18px", fontWeight: "600" }}>
            Loading dashboard...
          </p>
          <p style={{ color: "#666", marginTop: "8px" }}>
            Fetching your profile and interview history
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <h1>Welcome, {profile?.name || user?.name || "User"}! 👋</h1>
          <p>Ready to improve your interview skills?</p>
        </div>

        <button
          onClick={handleManualRefresh}
          disabled={refreshing}
          style={{
            padding: "10px 16px",
            borderRadius: "8px",
            border: "none",
            background: refreshing ? "#9bbcf3" : "#007BFF",
            color: "#fff",
            cursor: refreshing ? "not-allowed" : "pointer",
            fontWeight: "bold",
          }}
        >
          {refreshing ? "Refreshing..." : "🔄 Refresh"}
        </button>
      </div>

      {error && (
        <div
          style={{
            background: "#fdecea",
            color: "#b71c1c",
            border: "1px solid #f5c6cb",
            borderRadius: "8px",
            padding: "14px 16px",
            marginBottom: "20px",
          }}
        >
          <strong>Dashboard Error:</strong>
          <p style={{ margin: "8px 0 0" }}>{error}</p>
        </div>
      )}

      <div className="quick-stats">
        <div className="stat-item">
          <h3>{profile?.totalInterviews ?? profile?.total_interviews ?? sortedInterviews.length ?? 0}</h3>
          <p>Total Interviews</p>
        </div>

        <div className="stat-item">
          <h3>{averageScore}</h3>
          <p>Avg Score</p>
        </div>

        <div className="stat-item">
          <h3>{profile?.completed ?? profile?.completed_interviews ?? completedInterviewsCount}</h3>
          <p>Completed</p>
        </div>

        <div className="stat-item">
          <h3>{profile?.inProgress ?? profile?.in_progress_interviews ?? inProgressCount}</h3>
          <p>In Progress</p>
        </div>

        <div className="stat-item">
          <h3>{profile?.active_resume || profile?.has_resume ? "✅" : "❌"}</h3>
          <p>Resume {profile?.active_resume || profile?.has_resume ? "Uploaded" : "Not Uploaded"}</p>
        </div>
      </div>

      {!(profile?.active_resume || profile?.has_resume) && (
        <div
          style={{
            background: "#fff3cd",
            border: "1px solid #ffc107",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "20px",
          }}
        >
          <strong>⚠️ No resume uploaded yet!</strong>
          <p style={{ margin: "8px 0 0" }}>
            Upload your resume so the AI can generate personalized interview
            questions.
          </p>
          <button
            onClick={handleUploadResume}
            style={{
              marginTop: "10px",
              padding: "8px 16px",
              background: "#ffc107",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Upload Resume &amp; Start Interview
          </button>
        </div>
      )}

      <div className="action-cards">
        <div
          className="action-card primary"
          onClick={handleStartNewInterview}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              handleStartNewInterview();
            }
          }}
        >
          <h2>🚀 Start New Interview</h2>
          <p>Full mock interview with AI feedback</p>
          <button type="button">Begin</button>
        </div>

        <div
          className="action-card"
          onClick={handleUploadResume}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              handleUploadResume();
            }
          }}
        >
          <h2>📄 Upload Resume</h2>
          <p>Keep your resume up to date</p>
          <button type="button">Upload</button>
        </div>
      </div>

      <div style={{ marginTop: "30px" }}>
        <h2>📋 Past Interviews</h2>

        {sortedInterviews.length === 0 ? (
          <div
            style={{
              marginTop: "12px",
              background: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: "8px",
              padding: "18px",
            }}
          >
            <p style={{ margin: 0, color: "#666" }}>
              No past interviews found yet. Start one to see it here.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              marginTop: "12px",
            }}
          >
            {sortedInterviews.map((interview) => {
              const isRestarting = restartingInterviewId === interview.id;
              const isContinuing = continuingInterviewId === interview.id;
              const isReviewing = reviewingInterviewId === interview.id;
              const statusMeta = getInterviewStatusMeta(interview);
              const hasFinalScore =
                interview.final_score !== null &&
                interview.final_score !== undefined &&
                !Number.isNaN(Number(interview.final_score));

              return (
                <div
                  key={interview.id}
                  style={{
                    background: "#fff",
                    border: "1px solid #e0e0e0",
                    borderRadius: "8px",
                    padding: "16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "16px",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: "240px" }}>
                    <strong>{interview.job_role || "Untitled Role"}</strong> at{" "}
                    {interview.company || "Unknown Company"}

                    <p
                      style={{
                        margin: "4px 0 0",
                        color: "#666",
                        fontSize: "13px",
                      }}
                    >
                      {interview.question_type || "Unknown Type"} ·{" "}
                      {interview.experience_level || "Unknown Level"} ·{" "}
                      {formatDate(interview.started_at)}
                    </p>

                    {!interview.completed && (
                      <p
                        style={{
                          margin: "6px 0 0",
                          color: "#007BFF",
                          fontSize: "13px",
                          fontWeight: "600",
                        }}
                      >
                        Progress: Question {(interview.current_question_index || 0) + 1}
                      </p>
                    )}

                    {interview.completed && (
                      <div
                        style={{
                          marginTop: "8px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <span
                          style={{
                            color: "#155724",
                            fontWeight: "700",
                            fontSize: "14px",
                          }}
                        >
                          ✅ Completed
                        </span>

                        <span
                          style={{
                            color: "#0b5ed7",
                            fontWeight: "700",
                            fontSize: "14px",
                          }}
                        >
                          Final Score: {hasFinalScore ? interview.final_score : 0}
                        </span>

                        {interview.completed_at && (
                          <span
                            style={{
                              color: "#666",
                              fontSize: "12px",
                            }}
                          >
                            Completed on {formatDate(interview.completed_at)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      textAlign: "right",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: "8px",
                    }}
                  >
                    {!interview.completed && (
                      <span
                        style={{
                          background: statusMeta.background,
                          color: statusMeta.color,
                          padding: "4px 12px",
                          borderRadius: "20px",
                          fontWeight: "bold",
                          fontSize: "13px",
                        }}
                      >
                        {statusMeta.label}
                      </span>
                    )}

                    {interview.completed && (
                      <span
                        style={{
                          background:
                            hasFinalScore && Number(interview.final_score) >= 70
                              ? "#d4edda"
                              : "#fff3cd",
                          color:
                            hasFinalScore && Number(interview.final_score) >= 70
                              ? "#155724"
                              : "#856404",
                          padding: "4px 12px",
                          borderRadius: "20px",
                          fontWeight: "bold",
                          fontSize: "13px",
                        }}
                      >
                        {hasFinalScore
                          ? `${Math.round(Number(interview.final_score))}/100`
                          : "0/100"}
                      </span>
                    )}

                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      }}
                    >
                      {!interview.completed && (
                        <button
                          onClick={() => handleContinueInterview(interview)}
                          disabled={isContinuing}
                          type="button"
                          style={{
                            padding: "8px 14px",
                            background: isContinuing ? "#9fcfcf" : "#17a2b8",
                            color: "#fff",
                            border: "none",
                            borderRadius: "6px",
                            cursor: isContinuing ? "not-allowed" : "pointer",
                            fontSize: "13px",
                            fontWeight: "bold",
                            minWidth: "130px",
                          }}
                        >
                          {isContinuing ? "Continuing..." : "▶ Continue"}
                        </button>
                      )}

                      {interview.completed && (
                        <button
                          onClick={() => handleReviewInterview(interview)}
                          disabled={isReviewing}
                          type="button"
                          style={{
                            padding: "8px 14px",
                            background: isReviewing ? "#b8d1a8" : "#28a745",
                            color: "#fff",
                            border: "none",
                            borderRadius: "6px",
                            cursor: isReviewing ? "not-allowed" : "pointer",
                            fontSize: "13px",
                            fontWeight: "bold",
                            minWidth: "130px",
                          }}
                        >
                          {isReviewing ? "Opening..." : "📝 Review"}
                        </button>
                      )}

                      <button
                        onClick={() => handleStartAgain(interview)}
                        disabled={isRestarting}
                        type="button"
                        style={{
                          padding: "8px 14px",
                          background: isRestarting ? "#9bbcf3" : "#007BFF",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          cursor: isRestarting ? "not-allowed" : "pointer",
                          fontSize: "13px",
                          fontWeight: "bold",
                          minWidth: "130px",
                        }}
                      >
                        {isRestarting ? "Starting..." : "🔁 Start Again"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;