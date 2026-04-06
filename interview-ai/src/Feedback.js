import React, { useMemo } from "react";
import "./Feedback.css";

const toArray = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "string" ? item.trim() : String(item || "").trim()
      )
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getOverallBand = (score) => {
  if (score >= 80) {
    return {
      label: "Excellent",
      emoji: "🌟",
      className: "excellent",
    };
  }

  if (score >= 70) {
    return {
      label: "Strong",
      emoji: "✅",
      className: "strong",
    };
  }

  if (score >= 55) {
    return {
      label: "Good",
      emoji: "👍",
      className: "good",
    };
  }

  if (score >= 40) {
    return {
      label: "Developing",
      emoji: "🛠️",
      className: "developing",
    };
  }

  return {
    label: "Needs Improvement",
    emoji: "📘",
    className: "improvement",
  };
};

const getScorePercent = (value, maxValue) => {
  if (!maxValue) return 0;
  return clamp((Number(value) / Number(maxValue)) * 100, 0, 100);
};

const Feedback = ({ feedback }) => {
  const feedbackData = feedback?.feedback || feedback || {};

  const conciseFeedback =
    typeof feedbackData.concise_feedback === "string"
      ? feedbackData.concise_feedback.trim()
      : "";

  const technicalScore = clamp(toNumber(feedbackData.technical_score, 0), 0, 5);
  const communicationScore = clamp(
    toNumber(feedbackData.communication_score, 0),
    0,
    5
  );
  const overallScore = clamp(toNumber(feedbackData.overall_score, 0), 0, 100);

  const strengths = toArray(feedbackData.strengths);
  const improvements = toArray(feedbackData.improvements);

  const suggestedAnswer =
    typeof feedbackData.suggested_answer === "string"
      ? feedbackData.suggested_answer.trim()
      : "";

  const overallBand = useMemo(() => getOverallBand(overallScore), [overallScore]);

  const technicalPercent = useMemo(
    () => getScorePercent(technicalScore, 5),
    [technicalScore]
  );

  const communicationPercent = useMemo(
    () => getScorePercent(communicationScore, 5),
    [communicationScore]
  );

  const overallPercent = useMemo(
    () => getScorePercent(overallScore, 100),
    [overallScore]
  );

  const hasAnyContent =
    conciseFeedback ||
    strengths.length > 0 ||
    improvements.length > 0 ||
    suggestedAnswer ||
    technicalScore > 0 ||
    communicationScore > 0 ||
    overallScore > 0;

  if (!feedback || !hasAnyContent) {
    return (
      <div className="feedback-container">
        <h2 className="feedback-header">AI Feedback Analysis</h2>
        <div className="feedback-summary">
          <p>No feedback is available for this answer yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`feedback-container feedback-band-${overallBand.className}`}>
      <div className="feedback-topbar">
        <h2 className="feedback-header">AI Feedback Analysis</h2>
        <div className={`feedback-badge ${overallBand.className}`}>
          <span className="feedback-badge-emoji">{overallBand.emoji}</span>
          <span className="feedback-badge-text">{overallBand.label}</span>
        </div>
      </div>

      {conciseFeedback && (
        <div className="feedback-summary">
          <h3>Summary</h3>
          <p>{conciseFeedback}</p>
        </div>
      )}

      <div className="feedback-scores">
        <div className="score-card">
          <div className="score-card-top">
            <span className="score-label">Technical</span>
            <span className="score-value">{technicalScore}/5</span>
          </div>
          <div className="score-progress">
            <div
              className="score-progress-fill"
              style={{ width: `${technicalPercent}%` }}
            />
          </div>
        </div>

        <div className="score-card">
          <div className="score-card-top">
            <span className="score-label">Communication</span>
            <span className="score-value">{communicationScore}/5</span>
          </div>
          <div className="score-progress">
            <div
              className="score-progress-fill"
              style={{ width: `${communicationPercent}%` }}
            />
          </div>
        </div>

        <div className="score-card overall">
          <div className="score-card-top">
            <span className="score-label">Overall</span>
            <span className="score-value">{overallScore}/100</span>
          </div>
          <div className="score-progress">
            <div
              className="score-progress-fill"
              style={{ width: `${overallPercent}%` }}
            />
          </div>
        </div>
      </div>

      {strengths.length > 0 && (
        <div className="feedback-section strengths">
          <h3>Strengths</h3>
          <ul>
            {strengths.map((item, index) => (
              <li key={`strength-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {improvements.length > 0 && (
        <div className="feedback-section improvements">
          <h3>Areas for Improvement</h3>
          <ul>
            {improvements.map((item, index) => (
              <li key={`improvement-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {suggestedAnswer && (
        <div className="feedback-section suggested-answer">
          <h3>Suggested Answer</h3>
          <p>{suggestedAnswer}</p>
        </div>
      )}
    </div>
  );
};

export default Feedback;