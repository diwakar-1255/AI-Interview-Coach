import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  PDFDownloadLink,
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import { useAuth } from "./AuthContext";
import "./InterviewComplete.css";

const SESSION_KEY = "live_interview_session";
const LOCAL_INTERVIEW_KEY = "current_interview_data";

Font.register({
  family: "Open Sans",
  fonts: [
    {
      src: "https://fonts.gstatic.com/s/opensans/v17/mem8YaGs126MiZpBA-UFVZ0e.ttf",
    },
    {
      src: "https://fonts.gstatic.com/s/opensans/v17/mem5YaGs126MiZpBA-UNirkOUuhs.ttf",
      fontWeight: 600,
    },
  ],
});

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontFamily: "Open Sans",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 5,
    textAlign: "center",
    color: "#2c3e50",
  },
  subtitle: {
    fontSize: 13,
    color: "#7f8c8d",
    textAlign: "center",
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#2c3e50",
  },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  scoreCard: {
    width: "30%",
    padding: 12,
    backgroundColor: "#f0f4f8",
    borderRadius: 6,
    textAlign: "center",
  },
  scoreValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#3498db",
  },
  scoreLabel: {
    fontSize: 11,
    color: "#7f8c8d",
    marginTop: 4,
  },
  questionItem: {
    marginBottom: 16,
    padding: 12,
    border: "1px solid #e0e0e0",
    borderRadius: 6,
  },
  questionText: {
    fontWeight: "bold",
    fontSize: 13,
    marginBottom: 8,
  },
  answerText: {
    fontSize: 12,
    color: "#333",
    lineHeight: 1.5,
    marginBottom: 8,
  },
  feedbackText: {
    fontSize: 12,
    color: "#333",
    lineHeight: 1.5,
    marginBottom: 6,
  },
  suggestionBox: {
    backgroundColor: "#f5fff5",
    padding: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  pageNumber: {
    position: "absolute",
    bottom: 20,
    right: 30,
    fontSize: 10,
    color: "#aaa",
  },
});

const InterviewReport = ({
  interviewData,
  feedbackData,
  answersMap,
  avgTechnical,
  avgCommunication,
  avgOverall,
  topStrengths,
  topImprovements,
}) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <Text style={styles.title}>Interview Report</Text>
      <Text style={styles.subtitle}>
        {interviewData?.jobRole || interviewData?.job_role || "Mock"} Interview —{" "}
        {new Date().toLocaleDateString()}
      </Text>

      <Text style={styles.sectionTitle}>Performance Summary</Text>
      <View style={styles.scoreRow}>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreValue}>{avgOverall}/100</Text>
          <Text style={styles.scoreLabel}>Overall Score</Text>
        </View>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreValue}>{avgTechnical}/5</Text>
          <Text style={styles.scoreLabel}>Technical</Text>
        </View>
        <View style={styles.scoreCard}>
          <Text style={styles.scoreValue}>{avgCommunication}/5</Text>
          <Text style={styles.scoreLabel}>Communication</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Key Strengths</Text>
      {topStrengths.length > 0 ? (
        topStrengths.map((s, i) => (
          <Text key={i} style={styles.feedbackText}>
            ✓ {s}
          </Text>
        ))
      ) : (
        <Text style={styles.feedbackText}>Keep practicing to build strengths.</Text>
      )}

      <Text style={[styles.sectionTitle, { marginTop: 12 }]}>
        Areas for Improvement
      </Text>
      {topImprovements.length > 0 ? (
        topImprovements.map((s, i) => (
          <Text key={i} style={styles.feedbackText}>
            • {s}
          </Text>
        ))
      ) : (
        <Text style={styles.feedbackText}>Great job overall.</Text>
      )}
    </Page>

    {interviewData?.questions?.map((question, index) => {
      const fb = feedbackData?.[index];
      const answer =
        answersMap?.[index] ||
        interviewData?.answers?.[index] ||
        "";

      if (!fb && !answer) return null;

      return (
        <Page key={index} size="A4" style={styles.page}>
          <View style={styles.questionItem}>
            <Text style={styles.questionText}>
              Q{index + 1}: {question?.question || question?.text || `Question ${index + 1}`}
            </Text>

            {answer ? (
              <Text style={styles.answerText}>Your Answer: {answer}</Text>
            ) : null}

            {fb?.concise_feedback ? (
              <Text style={styles.feedbackText}>📝 {fb.concise_feedback}</Text>
            ) : (
              <Text style={styles.feedbackText}>📝 No feedback available.</Text>
            )}

            {fb?.suggested_answer ? (
              <View style={styles.suggestionBox}>
                <Text style={styles.feedbackText}>
                  💡 Suggested: {fb.suggested_answer}
                </Text>
              </View>
            ) : null}
          </View>

          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`}
            fixed
          />
        </Page>
      );
    })}
  </Document>
);

const InterviewComplete = ({ clearInterviewData }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { getToken, API_URL } = useAuth();

  const hasSavedRef = useRef(false);

  const safeJsonParse = useCallback((raw, fallback = null) => {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }, []);

  const sessionBackup = useMemo(() => {
    return safeJsonParse(sessionStorage.getItem(SESSION_KEY), null);
  }, [safeJsonParse]);

  const localBackup = useMemo(() => {
    return safeJsonParse(localStorage.getItem(LOCAL_INTERVIEW_KEY), null);
  }, [safeJsonParse]);

  const stateInterviewData =
    location.state?.interviewData ||
    sessionBackup?.interviewData ||
    localBackup ||
    {};

  const stateFeedbackData =
    location.state?.feedbackData ||
    sessionBackup?.allFeedback ||
    localBackup?.feedback ||
    [];

  const stateAnswers =
    location.state?.answers ||
    sessionBackup?.allAnswers ||
    {};

  const stateFinalScore =
    location.state?.finalScore ??
    stateInterviewData?.overall_score ??
    stateInterviewData?.final_score ??
    0;

  const [expandedItems, setExpandedItems] = useState({});
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const interviewData = useMemo(() => {
    const questions = Array.isArray(stateInterviewData?.questions)
      ? stateInterviewData.questions
      : [];

    const feedback = Array.isArray(stateFeedbackData) ? stateFeedbackData : [];

    const answersArray = Array.isArray(stateInterviewData?.answers)
      ? stateInterviewData.answers
      : [];

    return {
      ...stateInterviewData,
      questions,
      feedback,
      answers: answersArray,
      completed: true,
      readOnly: true,
      reviewMode: true,
      overall_score: Number(stateFinalScore) || 0,
    };
  }, [stateFeedbackData, stateFinalScore, stateInterviewData]);

  const feedbackData = useMemo(
    () => (Array.isArray(stateFeedbackData) ? stateFeedbackData : []),
    [stateFeedbackData]
  );

  const answersMap = useMemo(() => {
    if (stateAnswers && typeof stateAnswers === "object" && !Array.isArray(stateAnswers)) {
      return stateAnswers;
    }

    if (Array.isArray(interviewData?.answers)) {
      return interviewData.answers.reduce((acc, item, index) => {
        acc[index] = item || "";
        return acc;
      }, {});
    }

    return {};
  }, [interviewData?.answers, stateAnswers]);

  const clearOnlySessionStorage = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("liveInterviewData");
    sessionStorage.removeItem("interviewData");
    if (typeof clearInterviewData === "function") {
      clearInterviewData();
    }
  }, [clearInterviewData]);

  const scores = useMemo(() => {
    return feedbackData.reduce(
      (acc, f) => {
        if (f) {
          acc.technical += Number(f.technical_score) || 0;
          acc.communication += Number(f.communication_score) || 0;
          acc.overall += Number(f.overall_score) || 0;
          acc.count += 1;
        }
        return acc;
      },
      { technical: 0, communication: 0, overall: 0, count: 0 }
    );
  }, [feedbackData]);

  const n = scores.count || 1;
  const avgTechnical = (scores.technical / n).toFixed(1);
  const avgCommunication = (scores.communication / n).toFixed(1);
  const calculatedAvgOverall = (scores.overall / n).toFixed(1);
  const finalOverallScore = useMemo(() => {
    return Number(interviewData?.overall_score ?? calculatedAvgOverall ?? 0).toFixed(1);
  }, [calculatedAvgOverall, interviewData?.overall_score]);

  const freq = useCallback((items) => {
    return items.reduce((acc, item) => {
      if (item) acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {});
  }, []);

  const top3 = useCallback((obj) => {
    return Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([item]) => item);
  }, []);

  const topStrengths = useMemo(() => {
    return top3(freq(feedbackData.flatMap((f) => f?.strengths || [])));
  }, [feedbackData, freq, top3]);

  const topImprovements = useMemo(() => {
    return top3(freq(feedbackData.flatMap((f) => f?.improvements || [])));
  }, [feedbackData, freq, top3]);

  useEffect(() => {
    const saveInterview = async () => {
      if (
        hasSavedRef.current ||
        !interviewData?.interview_id ||
        feedbackData.length === 0
      ) {
        return;
      }

      if (interviewData?.completed_at || interviewData?.completed) {
        setSaved(true);
        clearOnlySessionStorage();

        const reviewPayload = {
          ...interviewData,
          completed: true,
          readOnly: true,
          reviewMode: true,
          feedback: feedbackData,
          answers: Array.isArray(interviewData.answers)
            ? interviewData.answers
            : Object.keys(answersMap)
                .map(Number)
                .sort((a, b) => a - b)
                .map((key) => answersMap[key] || ""),
        };

        localStorage.setItem(LOCAL_INTERVIEW_KEY, JSON.stringify(reviewPayload));
        return;
      }

      try {
        hasSavedRef.current = true;
        setSaving(true);
        setSaveError("");

        const token = getToken();

        const normalizedAnswers = Array.isArray(interviewData.answers) && interviewData.answers.length
          ? interviewData.answers
          : Object.keys(answersMap)
              .map(Number)
              .sort((a, b) => a - b)
              .map((key) => answersMap[key] || "");

        const response = await fetch(
          `${API_URL}/api/interview/${interviewData.interview_id}/complete`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              feedback: feedbackData,
              answers: normalizedAnswers,
            }),
          }
        );

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || `Save failed with status ${response.status}`);
        }

        const reviewPayload = {
          ...interviewData,
          completed: true,
          completed_at: payload.completed_at || new Date().toISOString(),
          overall_score:
            payload.final_score ??
            payload.overall_score ??
            Number(finalOverallScore),
          feedback: Array.isArray(payload.feedback) ? payload.feedback : feedbackData,
          answers: Array.isArray(payload.answers) ? payload.answers : normalizedAnswers,
          readOnly: true,
          reviewMode: true,
        };

        localStorage.setItem(LOCAL_INTERVIEW_KEY, JSON.stringify(reviewPayload));

        setSaved(true);
        clearOnlySessionStorage();
      } catch (err) {
        console.error("Could not save interview results:", err);
        setSaveError("Could not save results to profile, but your report is still available.");
        hasSavedRef.current = false;
      } finally {
        setSaving(false);
      }
    };

    saveInterview();
  }, [
    API_URL,
    answersMap,
    clearOnlySessionStorage,
    feedbackData,
    finalOverallScore,
    getToken,
    interviewData,
  ]);

  const toggleExpanded = useCallback((index) => {
    setExpandedItems((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  }, []);

  const handleStartNewInterview = useCallback(() => {
    clearOnlySessionStorage();
    navigate("/interview-question");
  }, [clearOnlySessionStorage, navigate]);

  const handleGoDashboard = useCallback(() => {
    clearOnlySessionStorage();
    navigate("/dashboard");
  }, [clearOnlySessionStorage, navigate]);

  const handleReviewInterview = useCallback(() => {
    const reviewPayload = {
      ...interviewData,
      completed: true,
      readOnly: true,
      reviewMode: true,
      overall_score: Number(finalOverallScore),
      feedback: feedbackData,
      answers: Array.isArray(interviewData.answers) && interviewData.answers.length
        ? interviewData.answers
        : Object.keys(answersMap)
            .map(Number)
            .sort((a, b) => a - b)
            .map((key) => answersMap[key] || ""),
    };

    localStorage.setItem(LOCAL_INTERVIEW_KEY, JSON.stringify(reviewPayload));

    navigate("/interview", {
      state: {
        interviewData: reviewPayload,
        readOnly: true,
        reviewMode: true,
      },
    });
  }, [answersMap, feedbackData, finalOverallScore, interviewData, navigate]);

  const hasQuestions =
    Array.isArray(interviewData?.questions) && interviewData.questions.length > 0;
  const hasResults = feedbackData.length > 0 || hasQuestions;

  if (!hasResults) {
    return (
      <div className="interview-complete-container">
        <div className="header-section">
          <h1>Interview Results</h1>
          <p className="subtitle">No interview results were found.</p>
        </div>

        <div className="action-buttons">
          <button className="btn-restart" onClick={() => navigate("/interview-question")}>
            Start New Interview
          </button>
          <button className="btn-home" onClick={() => navigate("/dashboard")}>
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="interview-complete-container">
      <div className="header-section">
        <h1>🎉 Interview Complete!</h1>
        <p className="subtitle">
          You&apos;ve finished your{" "}
          {interviewData?.jobRole || interviewData?.job_role || "mock"} interview
        </p>

        {saving && (
          <p style={{ color: "#666", fontSize: "13px" }}>
            Saving results...
          </p>
        )}

        {saved && (
          <p style={{ color: "#4caf50", fontSize: "13px" }}>
            ✅ Results saved to your profile
          </p>
        )}

        {saveError && (
          <p style={{ color: "#d32f2f", fontSize: "13px" }}>
            {saveError}
          </p>
        )}
      </div>

      <div className="performance-summary">
        <h2>Performance Summary</h2>
        <div className="score-cards">
          <div className="score-card">
            <div className="score-value">{finalOverallScore}</div>
            <div className="score-label">Overall Score</div>
            <div className="score-progress">
              <div
                className="progress-bar"
                style={{ width: `${Math.min(Number(finalOverallScore), 100)}%` }}
              ></div>
            </div>
          </div>

          <div className="score-card">
            <div className="score-value">{avgTechnical}/5</div>
            <div className="score-label">Technical Skills</div>
            <div className="score-progress">
              <div
                className="progress-bar"
                style={{ width: `${(Number(avgTechnical) / 5) * 100}%` }}
              ></div>
            </div>
          </div>

          <div className="score-card">
            <div className="score-value">{avgCommunication}/5</div>
            <div className="score-label">Communication</div>
            <div className="score-progress">
              <div
                className="progress-bar"
                style={{ width: `${(Number(avgCommunication) / 5) * 100}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div className="feedback-section">
        <div className="strengths-card">
          <h3>✅ Your Key Strengths</h3>
          <ul>
            {topStrengths.length > 0 ? (
              topStrengths.map((s, i) => <li key={i}>{s}</li>)
            ) : (
              <li>Keep practising!</li>
            )}
          </ul>
        </div>

        <div className="improvements-card">
          <h3>📈 Areas for Improvement</h3>
          <ul>
            {topImprovements.length > 0 ? (
              topImprovements.map((s, i) => <li key={i}>{s}</li>)
            ) : (
              <li>Great job!</li>
            )}
          </ul>
        </div>
      </div>

      {hasQuestions && (
        <div className="question-review">
          <h2>Question Review</h2>
          <div className="questions-list">
            {interviewData.questions.map((question, index) => (
              <div key={index} className="question-item">
                <div
                  className="question-header"
                  onClick={() => toggleExpanded(index)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      toggleExpanded(index);
                    }
                  }}
                >
                  <span className="question-number">Q{index + 1}</span>
                  <h3 className="question-text">
                    {question?.question || question?.text || `Question ${index + 1}`}
                  </h3>
                  <span className="dropdown-icon">
                    {expandedItems[index] ? "▲" : "▼"}
                  </span>
                </div>

                {expandedItems[index] && (
                  <div className="collapsible-content">
                    <div className="feedback-section">
                      <h4>🗣 Your Answer</h4>
                      <div className="feedback-content">
                        {answersMap[index] ||
                          interviewData?.answers?.[index] ||
                          "No saved answer available."}
                      </div>
                    </div>

                    <div className="feedback-section">
                      <h4>📝 Feedback</h4>
                      <div className="feedback-content">
                        {feedbackData[index]?.concise_feedback ||
                          "No feedback available."}
                      </div>
                    </div>

                    <div className="suggestion-section">
                      <h4>💡 Suggested Answer</h4>
                      <div className="suggestion-content">
                        {feedbackData[index]?.suggested_answer ||
                          "No suggested answer available."}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="action-buttons">
        <PDFDownloadLink
          document={
            <InterviewReport
              interviewData={interviewData}
              feedbackData={feedbackData}
              answersMap={answersMap}
              avgTechnical={avgTechnical}
              avgCommunication={avgCommunication}
              avgOverall={finalOverallScore}
              topStrengths={topStrengths}
              topImprovements={topImprovements}
            />
          }
          fileName="interview-report.pdf"
          className="btn-download"
        >
          {({ loading }) => (loading ? "Preparing..." : "📥 Download Report")}
        </PDFDownloadLink>

        <button className="btn-restart" onClick={handleReviewInterview}>
          Review Interview
        </button>

        <button className="btn-restart" onClick={handleStartNewInterview}>
          Start New Interview
        </button>

        <button className="btn-home" onClick={handleGoDashboard}>
          Go to Dashboard
        </button>
      </div>
    </div>
  );
};

export default InterviewComplete;