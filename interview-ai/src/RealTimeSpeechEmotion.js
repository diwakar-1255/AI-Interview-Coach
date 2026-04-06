import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import RecordRTC from "recordrtc";

const SOCKET_URL = "http://127.0.0.1:5000";

function RealTimeSpeechEmotion() {
  const socketRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const captureIntervalRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [confidenceScore, setConfidenceScore] = useState(0);
  const [error, setError] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("Connecting...");

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionStatus("Connected");
    });

    socket.on("disconnect", () => {
      setConnectionStatus("Disconnected");
    });

    socket.on("connect_error", () => {
      setConnectionStatus("Connection failed");
      setError("Could not connect to backend server.");
    });

    socket.on("transcription", (data) => {
      setTranscript(data?.transcript || "");
    });

    socket.on("emotion_analysis", (data) => {
      setConfidenceScore(Number(data?.confidence_score) || 0);
    });

    return () => {
      stopMediaAndIntervals();

      if (socketRef.current) {
        socketRef.current.off("connect");
        socketRef.current.off("disconnect");
        socketRef.current.off("connect_error");
        socketRef.current.off("transcription");
        socketRef.current.off("emotion_analysis");
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const stopMediaAndIntervals = () => {
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    if (recorderRef.current) {
      try {
        recorderRef.current.stopRecording(() => {});
      } catch (err) {
        // ignore stop errors
      }
      recorderRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  };

  const startRecording = async () => {
    if (recording) return;

    setError("");
    setTranscript("");
    setConfidenceScore(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const recorder = new RecordRTC(stream, {
        type: "audio",
        mimeType: "audio/wav",
        recorderType: RecordRTC.StereoAudioRecorder,
        numberOfAudioChannels: 1,
        desiredSampRate: 16000,
        timeSlice: 1000,
        ondataavailable: (blob) => {
          if (blob && blob.size > 0 && socketRef.current?.connected) {
            socketRef.current.emit("audio_stream", blob);
          }
        },
      });

      recorderRef.current = recorder;
      recorder.startRecording();

      captureIntervalRef.current = setInterval(() => {
        if (!videoRef.current || !socketRef.current?.connected) return;

        const video = videoRef.current;
        if (video.readyState < 2) return;

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;

        const context = canvas.getContext("2d");
        if (!context) return;

        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (blob && blob.size > 0) {
              socketRef.current.emit("image_stream", blob);
            }
          },
          "image/jpeg",
          0.8
        );
      }, 1000);

      setRecording(true);
    } catch (err) {
      setError("Microphone or camera access was denied, or not available.");
      setRecording(false);
      stopMediaAndIntervals();
    }
  };

  const stopRecording = () => {
    stopMediaAndIntervals();
    setRecording(false);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>🎤 Real-Time Speech & Emotion Analysis</h2>

      <p>
        <strong>Status:</strong> {connectionStatus}
      </p>

      {error && (
        <p style={{ color: "red" }}>
          <strong>Error:</strong> {error}
        </p>
      )}

      <div style={{ marginBottom: "12px" }}>
        <button onClick={startRecording} disabled={recording}>
          🎙 Start Recording
        </button>
        <button
          onClick={stopRecording}
          disabled={!recording}
          style={{ marginLeft: "10px" }}
        >
          🛑 Stop Recording
        </button>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{
            width: "320px",
            height: "240px",
            background: "#000",
            borderRadius: "8px",
          }}
        />
      </div>

      <p>
        <strong>📜 Transcription:</strong> {transcript || "Waiting for speech..."}
      </p>
      <p>
        <strong>😊 Confidence Score:</strong> {confidenceScore.toFixed(2)}
      </p>
    </div>
  );
}

export default RealTimeSpeechEmotion;