import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import Webcam from "react-webcam";
import Feedback from "./Feedback";
import { useNavigate, useLocation } from "react-router-dom";
import "./LiveInterview.css";

const API_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:5000";
const SESSION_KEY = "live_interview_session";
const LOCAL_INTERVIEW_KEY = "current_interview_data";
const REQUEST_TIMEOUT = 30000;

function LiveInterview(props) {
  const navigate = useNavigate();
  const location = useLocation();

  const webcamRef = useRef(null);
  const socketRef = useRef(null);
  const videoIntervalRef = useRef(null);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const mountedRef = useRef(false);
  const initializedRef = useRef(false);
  const restoringRef = useRef(false);
  const recordingRef = useRef(false);
  const speakingRef = useRef(false);

  const tips = useMemo(
    () => ({
      low: [
        "Maintain eye contact with the camera",
        "Speak with more energy",
        "Smile to appear approachable",
      ],
      medium: [
        "Vary your tone of voice",
        "Structure answers with clear points",
        "Include examples from experience",
      ],
      high: [
        "Great energy — keep it up!",
        "Add more technical details",
        "Relate answers to company values",
      ],
    }),
    []
  );

  const getToken = useCallback(() => localStorage.getItem("token"), []);

  const getAuthHeaders = useCallback(() => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  const safeJsonParse = useCallback((raw, fallback = null) => {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }, []);

  const loadSessionStorage = useCallback(() => {
    return safeJsonParse(sessionStorage.getItem(SESSION_KEY), null);
  }, [safeJsonParse]);

  const loadLocalInterviewData = useCallback(() => {
    return safeJsonParse(localStorage.getItem(LOCAL_INTERVIEW_KEY), null);
  }, [safeJsonParse]);

  const normalizeInterviewData = useCallback((data) => {
    if (!data || typeof data !== "object") return null;

    const questions = Array.isArray(data.questions) ? data.questions : [];
    const answersArray = Array.isArray(data.answers) ? data.answers : [];
    const feedbackArray = Array.isArray(data.feedback) ? data.feedback : [];

    return {
      ...data,
      interview_id: data.interview_id || data.id || null,
      questions,
      answers: answersArray,
      feedback: feedbackArray,
      currentQuestionIndex:
        typeof data.currentQuestionIndex === "number"
          ? data.currentQuestionIndex
          : typeof data.current_question_index === "number"
          ? data.current_question_index
          : 0,
      completed: !!data.completed || !!data.completed_at,
      readOnly: !!data.readOnly,
      reviewMode: !!data.reviewMode,
      overall_score:
        data.overall_score !== undefined && data.overall_score !== null
          ? Number(data.overall_score)
          : data.final_score !== undefined && data.final_score !== null
          ? Number(data.final_score)
          : null,
    };
  }, []);

  const incomingInterviewData = useMemo(() => {
    const savedSession = loadSessionStorage();
    const savedLocalInterview = loadLocalInterviewData();

    return normalizeInterviewData(
      props.interviewData ||
        location.state?.interviewData ||
        location.state ||
        savedSession?.interviewData ||
        savedLocalInterview ||
        null
    );
  }, [
    props.interviewData,
    location.state,
    loadSessionStorage,
    loadLocalInterviewData,
    normalizeInterviewData,
  ]);

  const savedSession = useMemo(() => loadSessionStorage(), [loadSessionStorage]);

  const [interviewData, setInterviewData] = useState(incomingInterviewData);
  const [transcript, setTranscript] = useState("");
  const [positivityScore, setPositivityScore] = useState(0);
  const [engagementScore, setEngagementScore] = useState(0);
  const [confidenceScore, setConfidenceScore] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(
    incomingInterviewData?.currentQuestionIndex || 0
  );
  const [feedback, setFeedback] = useState(null);
  const [recording, setRecording] = useState(false);
  const [hasStartedSpeaking, setHasStartedSpeaking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [error, setError] = useState({ message: null, type: null });
  const [loading, setLoading] = useState(true);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(savedSession?.sidebarOpen ?? true);
  const [answeredQuestions, setAnsweredQuestions] = useState(
    Array.isArray(savedSession?.answeredQuestions) ? savedSession.answeredQuestions : []
  );
  const [allFeedback, setAllFeedback] = useState(
    Array.isArray(savedSession?.allFeedback)
      ? savedSession.allFeedback
      : Array.isArray(incomingInterviewData?.feedback)
      ? incomingInterviewData.feedback
      : []
  );
  const [allAnswers, setAllAnswers] = useState(
    savedSession?.allAnswers && typeof savedSession.allAnswers === "object"
      ? savedSession.allAnswers
      : {}
  );
  const [lastUpdate, setLastUpdate] = useState(null);
  const [videoProcessing, setVideoProcessing] = useState(false);
  const [engagementTips, setEngagementTips] = useState([]);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(true);

  const isCompleted = useMemo(() => {
    return !!interviewData?.completed || !!interviewData?.completed_at;
  }, [interviewData]);

  const isReviewMode = useMemo(() => {
    return !!interviewData?.readOnly || !!interviewData?.reviewMode || isCompleted;
  }, [interviewData, isCompleted]);

  const currentQuestion = useMemo(() => {
    if (!interviewData?.questions?.length) return "Loading questions...";
    const q = interviewData.questions[currentQuestionIndex];
    return q?.question || q?.text || "Could not display question";
  }, [interviewData, currentQuestionIndex]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, []);

  const stopVideoCapture = useCallback(() => {
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (mountedRef.current) {
      setVideoProcessing(false);
    }
  }, []);

  const stopAnalysis = useCallback(async () => {
    try {
      const token = getToken();
      if (!token || isReviewMode) return;

      await axios.post(
        `${API_URL}/api/stop_analysis`,
        {},
        {
          headers: {
            ...getAuthHeaders(),
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
    } catch {
      // ignore
    }
  }, [API_URL, getAuthHeaders, getToken, isReviewMode]);

  const resetLiveMetrics = useCallback(() => {
    setPositivityScore(0);
    setEngagementScore(0);
    setConfidenceScore(0);
    setHasStartedSpeaking(false);
    setLastUpdate(null);
  }, []);

  const clearInterviewStorage = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOCAL_INTERVIEW_KEY);
  }, []);

  const persistQuestionIndex = useCallback(
    async (index) => {
      try {
        if (!interviewData?.interview_id || isReviewMode) return;

        await axios.post(
          `${API_URL}/api/interview/${interviewData.interview_id}/question-index`,
          {
            currentQuestionIndex: index,
          },
          {
            headers: {
              ...getAuthHeaders(),
              "Content-Type": "application/json",
            },
            timeout: 10000,
          }
        );
      } catch {
        // ignore
      }
    },
    [API_URL, getAuthHeaders, interviewData?.interview_id, isReviewMode]
  );

  const persistWholeAnswer = useCallback(
    async (answerText, questionIndex = currentQuestionIndex) => {
      try {
        if (!interviewData?.interview_id || isReviewMode) return;

        await axios.post(
          `${API_URL}/api/interview/${interviewData.interview_id}/answer`,
          {
            answer: answerText,
            questionIndex,
          },
          {
            headers: {
              ...getAuthHeaders(),
              "Content-Type": "application/json",
            },
            timeout: 10000,
          }
        );
      } catch {
        // ignore
      }
    },
    [
      API_URL,
      currentQuestionIndex,
      getAuthHeaders,
      interviewData?.interview_id,
      isReviewMode,
    ]
  );

  const persistTranscriptPiece = useCallback(
    async (finalChunk) => {
      try {
        if (!interviewData?.interview_id || !finalChunk?.trim() || isReviewMode) return;

        await axios.post(
          `${API_URL}/api/update_transcript`,
          {
            transcript: finalChunk,
            interview_id: interviewData.interview_id,
          },
          {
            headers: {
              ...getAuthHeaders(),
              "Content-Type": "application/json",
            },
            timeout: 10000,
          }
        );
      } catch {
        // ignore
      }
    },
    [API_URL, getAuthHeaders, interviewData?.interview_id, isReviewMode]
  );

  const persistSession = useCallback(
    (overrides = {}) => {
      if (!interviewData?.questions?.length) return;

      const nextQuestionIndex = overrides.currentQuestionIndex ?? currentQuestionIndex;
      const nextAllAnswers = overrides.allAnswers ?? allAnswers;
      const nextAllFeedback = overrides.allFeedback ?? allFeedback;
      const nextTranscript =
        overrides.currentAnswer ?? transcriptRef.current ?? transcript ?? "";

      const sessionData = {
        interviewData: {
          ...interviewData,
          currentQuestionIndex: nextQuestionIndex,
          current_question_index: nextQuestionIndex,
          answers: Array.isArray(interviewData.answers) ? interviewData.answers : [],
          feedback: nextAllFeedback,
        },
        currentQuestionIndex: nextQuestionIndex,
        answeredQuestions: overrides.answeredQuestions ?? answeredQuestions,
        allFeedback: nextAllFeedback,
        allAnswers: nextAllAnswers,
        sidebarOpen: overrides.sidebarOpen ?? sidebarOpen,
        currentAnswer: nextTranscript,
        feedback: overrides.feedback ?? feedback,
      };

      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));

      const orderedAnswers = [];
      const answerKeys = Object.keys(nextAllAnswers)
        .map(Number)
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b);

      answerKeys.forEach((key) => {
        orderedAnswers[key] = nextAllAnswers[key];
      });

      const localInterviewData = {
        ...interviewData,
        currentQuestionIndex: nextQuestionIndex,
        current_question_index: nextQuestionIndex,
        answers: orderedAnswers,
        feedback: nextAllFeedback,
      };

      localStorage.setItem(LOCAL_INTERVIEW_KEY, JSON.stringify(localInterviewData));
    },
    [
      interviewData,
      currentQuestionIndex,
      answeredQuestions,
      allFeedback,
      allAnswers,
      sidebarOpen,
      transcript,
      feedback,
    ]
  );

  const calculatePositivityScore = useCallback((emotion, engScore) => {
    const weights = {
      happy: 1.0,
      surprise: 0.8,
      neutral: 0.8,
      sad: 0.3,
      angry: 0.1,
      fear: 0.2,
      disgust: 0.1,
    };

    return Math.min(
      1,
      Math.max(
        0,
        0.6 * (weights[String(emotion).toLowerCase()] || 0.5) +
          0.4 * Number(engScore || 0)
      )
    );
  }, []);

  const getCurrentAnswerText = useCallback(() => {
    return transcriptRef.current ?? transcript ?? "";
  }, [transcript]);

  const startAnalysis = useCallback(async () => {
    try {
      if (!interviewData?.interview_id || isReviewMode) return;

      await axios.post(
        `${API_URL}/api/start_analysis`,
        { interview_id: interviewData.interview_id },
        {
          headers: {
            ...getAuthHeaders(),
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
    } catch {
      // ignore
    }
  }, [API_URL, getAuthHeaders, interviewData?.interview_id, isReviewMode]);

  const startVideoCapture = useCallback(() => {
    if (videoIntervalRef.current || !interviewData?.interview_id || isReviewMode) return;

    videoIntervalRef.current = setInterval(async () => {
      if (!webcamRef.current || !recordingRef.current || !speakingRef.current) return;

      try {
        if (mountedRef.current) setVideoProcessing(true);

        const screenshot = webcamRef.current.getScreenshot();
        if (!screenshot) return;

        const res = await fetch(screenshot);
        const blob = await res.blob();
        const form = new FormData();
        form.append("video", blob, "frame.jpeg");
        form.append("interview_id", interviewData.interview_id);

        await axios.post(`${API_URL}/api/send_video`, form, {
          timeout: 5000,
          headers: {
            ...getAuthHeaders(),
          },
        });
      } catch {
        // ignore transient errors
      } finally {
        if (mountedRef.current) setVideoProcessing(false);
      }
    }, 1500);
  }, [API_URL, getAuthHeaders, interviewData?.interview_id, isReviewMode]);

  const startSpeechRecognition = useCallback(() => {
    if (isReviewMode) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalChunk = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) {
          finalChunk += `${text} `;
        } else {
          interimText += `${text} `;
        }
      }

      if (finalChunk.trim() || interimText.trim()) {
        setHasStartedSpeaking(true);
        speakingRef.current = true;
      }

      if (finalChunk.trim()) {
        setTranscript((prev) => {
          const updated = `${prev} ${finalChunk}`.trim();
          transcriptRef.current = updated;

          setAllAnswers((prevAnswers) => ({
            ...prevAnswers,
            [currentQuestionIndex]: updated,
          }));

          return updated;
        });

        persistTranscriptPiece(finalChunk.trim());
      }
    };

    recognition.onerror = (e) => {
      if (e.error !== "no-speech" && mountedRef.current) {
        setError({
          message: `Speech recognition error: ${e.error}`,
          type: "speech",
        });
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current && recordingRef.current) {
        try {
          recognition.start();
        } catch {
          // ignore restart failure
        }
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      setError({
        message: "Unable to start speech recognition.",
        type: "speech",
      });
    }
  }, [currentQuestionIndex, isReviewMode, persistTranscriptPiece]);

  const getFeedback = useCallback(
    async (answerOverride = null) => {
      try {
        if (isReviewMode) return;

        setLoadingFeedback(true);
        setError({ message: null, type: null });

        const currentTranscript = (answerOverride ?? getCurrentAnswerText()).trim();

        if (!currentTranscript) {
          setError({
            message: "No response detected. Please speak your answer.",
            type: "empty",
          });
          return;
        }

        const token = getToken();
        if (!token) {
          setError({
            message: "Token is missing. Please log in again.",
            type: "auth",
          });
          return;
        }

        const response = await axios.post(
          `${API_URL}/api/analyze_response`,
          {
            question: currentQuestion,
            response: currentTranscript,
            interview_id: interviewData?.interview_id,
            question_index: currentQuestionIndex,
          },
          {
            timeout: REQUEST_TIMEOUT,
            headers: {
              ...getAuthHeaders(),
              "Content-Type": "application/json",
            },
          }
        );

        if (response.data?.status && response.data.status !== "success") {
          throw new Error(response.data.error || "Failed to analyze response");
        }

        const newFeedback = response.data?.feedback || response.data;
        setFeedback(newFeedback);

        setAllFeedback((prev) => {
          const next = [...prev];
          next[currentQuestionIndex] = newFeedback;
          return next;
        });

        setAnsweredQuestions((prev) => {
          if (prev.includes(currentQuestionIndex)) return prev;
          return [...prev, currentQuestionIndex];
        });
      } catch (err) {
        setError({
          message:
            err.response?.data?.error ||
            err.response?.data?.message ||
            err.message ||
            "Something went wrong during analysis.",
          type: "analysis",
        });
      } finally {
        setLoadingFeedback(false);
      }
    },
    [
      API_URL,
      currentQuestion,
      currentQuestionIndex,
      getAuthHeaders,
      getCurrentAnswerText,
      getToken,
      interviewData?.interview_id,
      isReviewMode,
    ]
  );

  const resetCurrentQuestionState = useCallback(async () => {
    if (recordingRef.current || isReviewMode) return;

    setTranscript("");
    transcriptRef.current = "";
    setFeedback(allFeedback[currentQuestionIndex] || null);
    resetLiveMetrics();
    setError({ message: null, type: null });

    setAllAnswers((prev) => ({
      ...prev,
      [currentQuestionIndex]: "",
    }));

    await persistWholeAnswer("", currentQuestionIndex);
    persistSession({
      currentAnswer: "",
      allAnswers: {
        ...allAnswers,
        [currentQuestionIndex]: "",
      },
    });
  }, [
    allAnswers,
    allFeedback,
    currentQuestionIndex,
    isReviewMode,
    persistSession,
    persistWholeAnswer,
    resetLiveMetrics,
  ]);

  const restoreInterviewState = useCallback(async () => {
    if (!interviewData?.questions?.length) {
      setLoading(false);
      setError({
        message: "Interview data not found. Please start the interview again.",
        type: "missing_data",
      });
      return;
    }

    if (restoringRef.current) return;
    restoringRef.current = true;

    try {
      const token = getToken();
      const localSaved = loadLocalInterviewData();
      const sessionSaved = loadSessionStorage();

      const fallbackIndex =
        typeof sessionSaved?.currentQuestionIndex === "number"
          ? sessionSaved.currentQuestionIndex
          : typeof localSaved?.currentQuestionIndex === "number"
          ? localSaved.currentQuestionIndex
          : typeof localSaved?.current_question_index === "number"
          ? localSaved.current_question_index
          : typeof interviewData?.currentQuestionIndex === "number"
          ? interviewData.currentQuestionIndex
          : typeof interviewData?.current_question_index === "number"
          ? interviewData.current_question_index
          : 0;

      const fallbackAnswers =
        sessionSaved?.allAnswers && typeof sessionSaved.allAnswers === "object"
          ? sessionSaved.allAnswers
          : {};

      const fallbackFeedback = Array.isArray(sessionSaved?.allFeedback)
        ? sessionSaved.allFeedback
        : Array.isArray(interviewData.feedback)
        ? interviewData.feedback
        : [];

      if (!token || !interviewData?.interview_id) {
        setCurrentQuestionIndex(fallbackIndex);
        setAllAnswers(fallbackAnswers);
        setAllFeedback(fallbackFeedback);
        setTranscript(String(fallbackAnswers[fallbackIndex] || ""));
        transcriptRef.current = String(fallbackAnswers[fallbackIndex] || "");
        setFeedback(fallbackFeedback[fallbackIndex] || null);
        return;
      }

      const response = await axios.get(
        `${API_URL}/api/interview/${interviewData.interview_id}/state`,
        {
          headers: getAuthHeaders(),
          timeout: 15000,
        }
      );

      const state = response.data || {};

      const restoredIndex =
        typeof state.currentQuestionIndex === "number"
          ? state.currentQuestionIndex
          : typeof state.current_question_index === "number"
          ? state.current_question_index
          : fallbackIndex;

      const mappedAnswers = {};
      if (Array.isArray(state.answers)) {
        state.answers.forEach((ans, index) => {
          mappedAnswers[index] = ans || "";
        });
      }

      const mergedAnswers =
        Object.keys(mappedAnswers).length > 0 ? mappedAnswers : fallbackAnswers;

      const restoredFeedback = Array.isArray(state.feedback)
        ? state.feedback
        : fallbackFeedback;

      setCurrentQuestionIndex(restoredIndex);
      setAllAnswers(mergedAnswers);
      setAllFeedback(restoredFeedback);

      const answered = Object.keys(mergedAnswers)
        .filter((key) => String(mergedAnswers[key] || "").trim())
        .map((key) => Number(key));

      setAnsweredQuestions(answered);
      setFeedback(restoredFeedback[restoredIndex] || null);

      if (state.completed || interviewData.completed || isReviewMode) {
        const reviewAnswer = String(mergedAnswers[restoredIndex] || "");
        setTranscript(reviewAnswer);
        transcriptRef.current = reviewAnswer;

        persistSession({
          currentQuestionIndex: restoredIndex,
          currentAnswer: reviewAnswer,
          allAnswers: mergedAnswers,
          allFeedback: restoredFeedback,
          answeredQuestions: answered,
          feedback: restoredFeedback[restoredIndex] || null,
        });
      } else {
        /*
          Ongoing interview behavior:
          if refresh happens during question N,
          only that question restarts fresh, previous answers stay saved.
        */
        setTranscript("");
        transcriptRef.current = "";

        await persistWholeAnswer("", restoredIndex);
        await persistQuestionIndex(restoredIndex);

        persistSession({
          currentQuestionIndex: restoredIndex,
          currentAnswer: "",
          allAnswers: {
            ...mergedAnswers,
            [restoredIndex]: "",
          },
          allFeedback: restoredFeedback,
          answeredQuestions: answered,
          feedback: restoredFeedback[restoredIndex] || null,
        });
      }
    } catch {
      const localSaved = loadLocalInterviewData();
      const sessionSaved = loadSessionStorage();

      const restoredIndex =
        typeof sessionSaved?.currentQuestionIndex === "number"
          ? sessionSaved.currentQuestionIndex
          : typeof localSaved?.currentQuestionIndex === "number"
          ? localSaved.currentQuestionIndex
          : typeof localSaved?.current_question_index === "number"
          ? localSaved.current_question_index
          : 0;

      const restoredAnswers =
        sessionSaved?.allAnswers && typeof sessionSaved.allAnswers === "object"
          ? sessionSaved.allAnswers
          : {};

      const restoredFeedback = Array.isArray(sessionSaved?.allFeedback)
        ? sessionSaved.allFeedback
        : [];

      setCurrentQuestionIndex(restoredIndex);
      setAllAnswers(restoredAnswers);
      setAllFeedback(restoredFeedback);
      setFeedback(restoredFeedback[restoredIndex] || null);

      const restoredTranscript = isReviewMode
        ? String(restoredAnswers[restoredIndex] || "")
        : "";

      setTranscript(restoredTranscript);
      transcriptRef.current = restoredTranscript;
    } finally {
      restoringRef.current = false;
      setLoading(false);
    }
  }, [
    API_URL,
    getAuthHeaders,
    getToken,
    interviewData,
    isReviewMode,
    loadLocalInterviewData,
    loadSessionStorage,
    persistQuestionIndex,
    persistSession,
    persistWholeAnswer,
  ]);

  const changeQuestion = useCallback(
    async (index) => {
      stopSpeechRecognition();
      stopVideoCapture();
      await stopAnalysis();

      setRecording(false);
      recordingRef.current = false;
      speakingRef.current = false;

      setCurrentQuestionIndex(index);
      setFeedback(allFeedback[index] || null);
      resetLiveMetrics();
      setError({ message: null, type: null });

      if (isReviewMode) {
        const answerText = String(allAnswers[index] || "");
        setTranscript(answerText);
        transcriptRef.current = answerText;

        persistSession({
          currentQuestionIndex: index,
          currentAnswer: answerText,
          feedback: allFeedback[index] || null,
        });
        return;
      }

      setTranscript("");
      transcriptRef.current = "";

      setAllAnswers((prev) => ({
        ...prev,
        [index]: "",
      }));

      await persistWholeAnswer("", index);
      await persistQuestionIndex(index);

      persistSession({
        currentQuestionIndex: index,
        currentAnswer: "",
        allAnswers: {
          ...allAnswers,
          [index]: "",
        },
        feedback: allFeedback[index] || null,
      });
    },
    [
      allAnswers,
      allFeedback,
      isReviewMode,
      persistQuestionIndex,
      persistSession,
      persistWholeAnswer,
      resetLiveMetrics,
      stopAnalysis,
      stopSpeechRecognition,
      stopVideoCapture,
    ]
  );

  const startRecording = useCallback(async () => {
    if (isReviewMode) return;

    setError({ message: null, type: null });
    setFeedback(allFeedback[currentQuestionIndex] || null);
    setRecording(true);
    recordingRef.current = true;
    speakingRef.current = false;
    resetLiveMetrics();

    await startAnalysis();
    startSpeechRecognition();
    startVideoCapture();
  }, [
    allFeedback,
    currentQuestionIndex,
    isReviewMode,
    resetLiveMetrics,
    startAnalysis,
    startSpeechRecognition,
    startVideoCapture,
  ]);

  const stopRecording = useCallback(async () => {
    if (isReviewMode) return;

    setRecording(false);
    recordingRef.current = false;
    stopSpeechRecognition();
    stopVideoCapture();
    await stopAnalysis();

    const currentAnswer = getCurrentAnswerText().trim();

    setAllAnswers((prev) => ({
      ...prev,
      [currentQuestionIndex]: currentAnswer,
    }));

    await persistWholeAnswer(currentAnswer, currentQuestionIndex);
    persistSession({
      currentAnswer,
      allAnswers: {
        ...allAnswers,
        [currentQuestionIndex]: currentAnswer,
      },
    });

    await getFeedback(currentAnswer);
  }, [
    allAnswers,
    currentQuestionIndex,
    getCurrentAnswerText,
    getFeedback,
    isReviewMode,
    persistSession,
    persistWholeAnswer,
    stopAnalysis,
    stopSpeechRecognition,
    stopVideoCapture,
  ]);

  const handleQuestionSelect = useCallback(
    (index) => {
      if (index === currentQuestionIndex) return;

      if (recording && !isReviewMode) {
        if (window.confirm("You're recording. Stop and switch question?")) {
          stopRecording().then(() => changeQuestion(index));
        }
      } else {
        changeQuestion(index);
      }
    },
    [changeQuestion, currentQuestionIndex, isReviewMode, recording, stopRecording]
  );

  const moveToNextQuestion = useCallback(async () => {
    if (recording || !interviewData?.questions?.length) return;

    if (currentQuestionIndex < interviewData.questions.length - 1) {
      await changeQuestion(currentQuestionIndex + 1);
      return;
    }

    if (isReviewMode || isCompleted) {
      navigate("/dashboard");
      return;
    }

    try {
      stopSpeechRecognition();
      stopVideoCapture();
      await stopAnalysis();

      let completionResponse = null;
      if (interviewData?.interview_id) {
        completionResponse = await axios.post(
          `${API_URL}/api/interview/${interviewData.interview_id}/complete`,
          {
            feedback: allFeedback,
            answers: Object.keys(allAnswers)
              .map(Number)
              .sort((a, b) => a - b)
              .map((key) => allAnswers[key] || ""),
          },
          {
            headers: {
              ...getAuthHeaders(),
              "Content-Type": "application/json",
            },
            timeout: 15000,
          }
        );
      }

      const finalScore =
        completionResponse?.data?.final_score ??
        completionResponse?.data?.overall_score ??
        interviewData?.overall_score ??
        0;

      const completedInterviewData = {
        ...interviewData,
        completed: true,
        completed_at: new Date().toISOString(),
        overall_score: finalScore,
        feedback: allFeedback,
        answers: Object.keys(allAnswers)
          .map(Number)
          .sort((a, b) => a - b)
          .map((key) => allAnswers[key] || ""),
        readOnly: true,
        reviewMode: true,
      };

      clearInterviewStorage();

      navigate("/interview-complete", {
        state: {
          interviewData: completedInterviewData,
          feedbackData: allFeedback,
          answers: allAnswers,
          finalScore,
        },
      });
    } catch {
      clearInterviewStorage();
      navigate("/interview-complete", {
        state: {
          interviewData: {
            ...interviewData,
            completed: true,
            readOnly: true,
            reviewMode: true,
            feedback: allFeedback,
          },
          feedbackData: allFeedback,
          answers: allAnswers,
          finalScore: interviewData?.overall_score || 0,
        },
      });
    }
  }, [
    API_URL,
    allAnswers,
    allFeedback,
    changeQuestion,
    clearInterviewStorage,
    currentQuestionIndex,
    getAuthHeaders,
    interviewData,
    isCompleted,
    isReviewMode,
    navigate,
    recording,
    stopAnalysis,
    stopSpeechRecognition,
    stopVideoCapture,
  ]);

  const handleExit = useCallback(async () => {
    const shouldExit = window.confirm(
      isReviewMode
        ? "Go back to the dashboard?"
        : "Exit the interview? Your progress will stay saved, and you can continue later."
    );

    if (!shouldExit) return;

    stopSpeechRecognition();
    stopVideoCapture();
    await stopAnalysis();

    if (!isReviewMode) {
      const currentAnswer = getCurrentAnswerText().trim();

      const nextAnswers = {
        ...allAnswers,
        [currentQuestionIndex]: currentAnswer,
      };

      setAllAnswers(nextAnswers);

      await persistWholeAnswer(currentAnswer, currentQuestionIndex);
      await persistQuestionIndex(currentQuestionIndex);

      persistSession({
        currentAnswer,
        currentQuestionIndex,
        allAnswers: nextAnswers,
      });
    }

    navigate("/dashboard");
  }, [
    allAnswers,
    currentQuestionIndex,
    getCurrentAnswerText,
    isReviewMode,
    navigate,
    persistQuestionIndex,
    persistSession,
    persistWholeAnswer,
    stopAnalysis,
    stopSpeechRecognition,
    stopVideoCapture,
  ]);

  const clearCurrentTranscript = useCallback(async () => {
    if (isReviewMode) return;

    setTranscript("");
    transcriptRef.current = "";

    const nextAnswers = {
      ...allAnswers,
      [currentQuestionIndex]: "",
    };

    setAllAnswers(nextAnswers);
    await persistWholeAnswer("", currentQuestionIndex);

    persistSession({
      currentAnswer: "",
      allAnswers: nextAnswers,
    });
  }, [allAnswers, currentQuestionIndex, isReviewMode, persistSession, persistWholeAnswer]);

  const handleFullscreenStart = useCallback(async () => {
    try {
      if (document.documentElement.requestFullscreen && !isReviewMode) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // allow continue normally
    } finally {
      setShowFullscreenPrompt(false);
    }
  }, [isReviewMode]);

  const skipFullscreenStart = useCallback(() => {
    setShowFullscreenPrompt(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    transcriptRef.current = transcript || "";
  }, [transcript]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    speakingRef.current = hasStartedSpeaking;
  }, [hasStartedSpeaking]);

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setSpeechSupported(false);
    }
  }, []);

  useEffect(() => {
    if (engagementScore < 40) setEngagementTips(tips.low);
    else if (engagementScore < 70) setEngagementTips(tips.medium);
    else setEngagementTips(tips.high);
  }, [engagementScore, tips]);

  useEffect(() => {
    if (!interviewData?.questions?.length) return;
    persistSession();
  }, [
    interviewData,
    currentQuestionIndex,
    answeredQuestions,
    allFeedback,
    allAnswers,
    sidebarOpen,
    transcript,
    feedback,
    persistSession,
  ]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const latestInterviewData = normalizeInterviewData(
      props.interviewData ||
        location.state?.interviewData ||
        location.state ||
        loadSessionStorage()?.interviewData ||
        loadLocalInterviewData() ||
        null
    );

    if (latestInterviewData?.questions?.length) {
      setInterviewData(latestInterviewData);
      setShowFullscreenPrompt(!latestInterviewData.readOnly && !latestInterviewData.reviewMode);
      restoreInterviewState();
    } else {
      setLoading(false);
      setError({
        message: "Interview data not found. Please start the interview again.",
        type: "missing_data",
      });
    }
  }, [
    props.interviewData,
    location.state,
    loadSessionStorage,
    loadLocalInterviewData,
    normalizeInterviewData,
    restoreInterviewState,
  ]);

  useEffect(() => {
    if (isReviewMode) {
      setConnectionStatus("connected");
      return undefined;
    }

    socketRef.current = io(API_URL, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      transports: ["websocket", "polling"],
    });

    socketRef.current.on("connect", () => setConnectionStatus("connected"));
    socketRef.current.on("disconnect", () => setConnectionStatus("disconnected"));
    socketRef.current.on("connect_error", () => setConnectionStatus("error"));

    socketRef.current.on("update", (data) => {
      if (!recordingRef.current || !speakingRef.current) return;

      const hasMetrics =
        data.engagement_score !== undefined ||
        data.positivity_score !== undefined ||
        data.confidence_score !== undefined ||
        data.emotion;

      if (!hasMetrics) return;

      if (data.positivity_score !== undefined) {
        setPositivityScore(Math.round(Number(data.positivity_score || 0) * 100));
      } else {
        const ps = calculatePositivityScore(
          data.emotion || "neutral",
          data.engagement_score || 0
        );
        setPositivityScore(Math.round(ps * 100));
      }

      if (data.engagement_score !== undefined) {
        setEngagementScore(Math.round(Number(data.engagement_score || 0) * 100));
      }

      if (data.confidence_score !== undefined) {
        setConfidenceScore(Math.round(Number(data.confidence_score || 0) * 100));
      }

      setLastUpdate(Date.now());
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [API_URL, calculatePositivityScore, isReviewMode]);

  useEffect(() => {
    return () => {
      stopSpeechRecognition();
      stopVideoCapture();
      stopAnalysis();
    };
  }, [stopAnalysis, stopSpeechRecognition, stopVideoCapture]);

  if (!loading && (!interviewData || !interviewData.questions?.length)) {
    return (
      <div className="live-interview-container">
        <div className="feedback-error">
          <p>{error.message || "Interview data not found."}</p>
          <button onClick={() => navigate("/interview-question")}>
            Start Interview Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="live-interview-container">
      {loading ? (
        <div className="loading-screen">
          <div className="loading-content">
            <h2>
              {isReviewMode ? "Opening interview review..." : "Preparing your interview questions..."}
            </h2>
            <div className="spinner"></div>
            <p className="loading-tip">
              {isReviewMode
                ? "Loading your answers and feedback"
                : "Tip: Take a deep breath and relax"}
            </p>
          </div>
        </div>
      ) : showFullscreenPrompt ? (
        <div className="loading-screen">
          <div className="loading-content">
            <h2>Start Interview</h2>
            <p className="loading-tip" style={{ marginBottom: "20px" }}>
              For the best experience, enable fullscreen before you begin.
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button className="btn-next" onClick={handleFullscreenStart}>
                Enable Fullscreen
              </button>
              <button className="btn-exit" onClick={skipFullscreenStart}>
                Continue Normally
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="interview-layout">
          <div className={`questions-sidebar ${sidebarOpen ? "" : "closed"}`}>
            <div className="sidebar-header">
              <h3>{isReviewMode ? "Interview Review" : "Interview Questions"}</h3>
              <button
                className="sidebar-toggle"
                onClick={() => setSidebarOpen(false)}
              >
                &times;
              </button>
            </div>

            {isCompleted && (
              <div
                style={{
                  background: "#d4edda",
                  color: "#155724",
                  borderRadius: "8px",
                  padding: "10px",
                  marginBottom: "12px",
                  fontWeight: "700",
                }}
              >
                <div>✅ Completed</div>
                <div style={{ marginTop: "4px" }}>
                  Final Score: {interviewData?.overall_score ?? 0}
                </div>
              </div>
            )}

            <ul className="questions-list">
              {interviewData.questions.map((question, index) => {
                const hasAnswer = String(allAnswers[index] || "").trim() !== "";
                const hasFeedback = !!allFeedback[index];

                return (
                  <li
                    key={index}
                    className={`question-item ${
                      currentQuestionIndex === index ? "active" : ""
                    } ${hasAnswer ? "answered" : ""}`}
                    onClick={() => handleQuestionSelect(index)}
                  >
                    <span className="question-number">Q{index + 1}</span>
                    <span className="question-text">
                      {question?.question || question?.text || `Question ${index + 1}`}
                    </span>
                    {hasAnswer && hasFeedback && (
                      <span className="answered-icon">✓</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className={`interview-content ${sidebarOpen ? "" : "full-width"}`}>
            {!sidebarOpen && (
              <button
                className="sidebar-toggle closed"
                onClick={() => setSidebarOpen(true)}
              >
                ☰ Show Questions
              </button>
            )}

            {!speechSupported && !isReviewMode && (
              <div className="feedback-error" style={{ marginBottom: "12px" }}>
                Your browser doesn&apos;t support speech recognition. Use Chrome or Edge.
              </div>
            )}

            <div className="connection-status" data-status={connectionStatus}>
              <span className="status-indicator"></span>
              {isReviewMode
                ? "Review Mode"
                : connectionStatus === "connected"
                ? "Live Analysis Active"
                : connectionStatus === "error"
                ? "Analysis Disconnected"
                : "Connecting..."}
            </div>

            <div className="interview-card">
              <div className="interview-header">
                <h2>{isReviewMode ? "Past Interview Review" : "Mock Interview Session"}</h2>
                <div className="header-meta">
                  <div className="progress-indicator">
                    Question {currentQuestionIndex + 1} of{" "}
                    {interviewData?.questions?.length || 0}
                  </div>
                  <div className="question-role">
                    Role: {interviewData?.jobRole || interviewData?.job_role || "N/A"}
                  </div>
                </div>
              </div>

              {isCompleted && (
                <div
                  style={{
                    background: "#f8f9fa",
                    border: "1px solid #dfe3e6",
                    borderRadius: "8px",
                    padding: "12px",
                    marginBottom: "16px",
                  }}
                >
                  <strong>Final Interview Score:</strong>{" "}
                  <span>{interviewData?.overall_score ?? 0}</span>
                </div>
              )}

              <div className="question-container">
                <div className="question-card">
                  <h3>Current Question:</h3>
                  <p className="question-text">{currentQuestion}</p>
                </div>
              </div>

              <div className="media-container">
                <div className="webcam-container">
                  <Webcam
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    className={`webcam-feed ${videoProcessing ? "processing" : ""}`}
                    mirrored={true}
                    audio={false}
                    videoConstraints={{
                      width: 640,
                      height: 480,
                      facingMode: "user",
                    }}
                  />
                  <div className="recording-indicator" data-recording={recording}>
                    <span className="indicator-dot"></span>
                    {isReviewMode ? "REVIEW MODE" : recording ? "RECORDING" : "PAUSED"}
                  </div>
                </div>

                <div className="controls-panel">
                  {!isReviewMode ? (
                    <>
                      <div className="control-buttons">
                        <button
                          onClick={startRecording}
                          disabled={recording || !speechSupported}
                          className="btn-record-start"
                        >
                          🎤 Start Answer
                        </button>
                        <button
                          onClick={stopRecording}
                          disabled={!recording}
                          className="btn-record-stop"
                        >
                          ⏹ Stop Answer
                        </button>
                        <button
                          onClick={resetCurrentQuestionState}
                          disabled={recording}
                          className="btn-skip"
                        >
                          Reset Current Answer
                        </button>
                      </div>

                      <div className="metrics-display">
                        <div className="metric">
                          <div className="metric-header">
                            <span className="metric-label">Positivity</span>
                            <span className="metric-value">{positivityScore}%</span>
                          </div>
                          <div className="score-bar-container">
                            <div
                              className="score-fill positivity-fill"
                              style={{ width: `${positivityScore}%` }}
                            ></div>
                          </div>
                          <div className="emotion-indicator">
                            {positivityScore > 70 ? "😊" : positivityScore > 40 ? "😐" : "😞"}
                          </div>
                        </div>

                        <div className="metric">
                          <div className="metric-header">
                            <span className="metric-label">Engagement</span>
                            <span className="metric-value">{engagementScore}%</span>
                          </div>
                          <div className="score-bar-container">
                            <div
                              className="score-fill engagement-fill"
                              style={{ width: `${engagementScore}%` }}
                            ></div>
                          </div>
                        </div>

                        <div className="metric">
                          <div className="metric-header">
                            <span className="metric-label">Confidence</span>
                            <span className="metric-value">{confidenceScore}%</span>
                          </div>
                          <div className="score-bar-container">
                            <div
                              className="score-fill confidence-fill"
                              style={{ width: `${confidenceScore}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>

                      <div className="engagement-tips">
                        <h4>Tips:</h4>
                        <ul>
                          {engagementTips.map((tip, i) => (
                            <li key={i}>{tip}</li>
                          ))}
                        </ul>
                        {lastUpdate && (
                          <p className="last-update-text">
                            Last updated: {new Date(lastUpdate).toLocaleTimeString()}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        background: "#f8f9fa",
                        border: "1px solid #e0e0e0",
                        borderRadius: "8px",
                        padding: "14px",
                        width: "100%",
                      }}
                    >
                      <h4 style={{ marginTop: 0 }}>Review Summary</h4>
                      <p style={{ margin: "6px 0" }}>
                        You can review all your past questions, answers, and feedback here.
                      </p>
                      <p style={{ margin: "6px 0" }}>
                        Question-wise feedback is preserved after completion.
                      </p>
                      <p style={{ margin: "6px 0", fontWeight: "600" }}>
                        Final Score: {interviewData?.overall_score ?? 0}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="transcript-container">
                <div className="transcript-header">
                  <h3>{isReviewMode ? "Saved Answer:" : "Live Transcript:"}</h3>
                  {!isReviewMode && (
                    <button
                      className="btn-clear-transcript"
                      onClick={clearCurrentTranscript}
                      disabled={!transcript}
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="transcript-box">
                  {transcript ? (
                    <p style={{ margin: 0 }}>{transcript}</p>
                  ) : (
                    <div className="empty-transcript">
                      <p>
                        {isReviewMode
                          ? "No saved answer for this question."
                          : "Your response will appear here as you speak..."}
                      </p>
                      {!isReviewMode && (
                        <p className="hint">
                          Click &quot;Start Answer&quot; and begin speaking
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {loadingFeedback ? (
                <div className="feedback-loading">
                  <div className="spinner"></div>
                  <p>Analyzing your response...</p>
                </div>
              ) : feedback ? (
                <Feedback feedback={feedback} />
              ) : error.message ? (
                <div className="feedback-error">
                  <p>{error.message}</p>
                  {!isReviewMode && error.type === "analysis" && (
                    <button onClick={() => getFeedback()}>Retry</button>
                  )}
                </div>
              ) : null}

              <div className="navigation-buttons">
                <button onClick={handleExit} className="btn-exit">
                  {isReviewMode ? "Back to Dashboard" : "Exit Interview"}
                </button>

                <button
                  onClick={moveToNextQuestion}
                  disabled={recording}
                  className="btn-next"
                >
                  {currentQuestionIndex < (interviewData?.questions?.length || 0) - 1
                    ? "Next Question"
                    : isReviewMode
                    ? "Finish Review"
                    : "Finish Interview"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LiveInterview;