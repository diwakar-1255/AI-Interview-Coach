import React, { useState, useEffect, useRef } from "react";
import Webcam from "react-webcam";
import RecordRTC from "recordrtc";
import { io } from "socket.io-client";

const API_URL = "http://127.0.0.1:5000";
const SOCKET_URL = "http://127.0.0.1:5000"; // Using HTTP URL for Socket.IO

function LiveSpeechCamera() {
  const webcamRef = useRef(null);
  const mediaRecorder = useRef(null);
  const videoIntervalRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [emotions, setEmotions] = useState({});
  const [positivityScore, setPositivityScore] = useState(0.5);
  const [error, setError] = useState(null);

  // ✅ Connect via Socket.IO instead of raw WebSocket
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket"] });

    socket.on("connect", () => {
      console.log("✅ Connected to Socket.IO!");
      setError(null);
    });

    socket.on("update", (data) => {
      console.log("📡 Socket.IO Data:", data);
      if (data.transcript) {
        setTranscript((prev) => prev + "\n" + data.transcript);
      }
      if (data.emotions) {
        setEmotions(data.emotions);
      }
      if (data.positivity_score !== undefined) {
        setPositivityScore(data.positivity_score);
      }
    });

    socket.on("error", (err) => {
      console.error("❌ Socket.IO Error:", err);
      setError(err);
    });

    socket.on("disconnect", () => {
      console.log("❌ Socket.IO Disconnected!");
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // ✅ Start recording and set up interval for video snapshots
  const startRecording = async () => {
    setRecording(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      webcamRef.current.srcObject = stream;

      // Capture an image every 3 seconds for emotion analysis
      videoIntervalRef.current = setInterval(() => captureImage(), 3000);

      mediaRecorder.current = new RecordRTC(stream, {
        type: "audio",
        mimeType: "audio/wav",
        recorderType: RecordRTC.StereoAudioRecorder,
        timeSlice: 2000,
        ondataavailable: async (blob) => {
          if (blob.size < 500) return;

          const formData = new FormData();
          formData.append("audio", blob, "audio.wav");

          try {
            const response = await fetch(`${API_URL}/send_audio`, {
              method: "POST",
              body: formData,
            });
            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || "Error sending audio to server");
            }
          } catch (err) {
            console.error("❌ Error sending audio:", err);
            setError("Error sending audio to server.");
          }
        },
      });

      mediaRecorder.current.startRecording();
    } catch (err) {
      console.error("❌ Error accessing media devices:", err);
      setError("Error accessing camera or microphone. Please check permissions.");
      setRecording(false);
    }
  };

  // ✅ Stop recording, clear intervals, and stop media tracks
  const stopRecording = () => {
    setRecording(false);
    setError(null);

    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
    }

    if (webcamRef.current && webcamRef.current.srcObject) {
      webcamRef.current.srcObject.getTracks().forEach((track) => track.stop());
    }

    if (mediaRecorder.current) {
      mediaRecorder.current.stopRecording(() => {
        console.log("🛑 Audio recording stopped.");
      });
    }

    console.log("🛑 Recording stopped.");
  };

  // ✅ Capture an image from the webcam and send it for video processing
  const captureImage = async () => {
    if (!webcamRef.current) return;
    const imageSrc = webcamRef.current.getScreenshot();
    if (!imageSrc) return;

    try {
      const blob = await fetch(imageSrc).then((res) => res.blob());
      const formData = new FormData();
      formData.append("video", blob, "video.jpeg");

      const response = await fetch(`${API_URL}/send_video`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Error sending video frame to server");
      }
    } catch (err) {
      console.error("❌ Error sending video:", err);
      setError("Error sending video frame to server.");
    }
  };

  return (
    <div>
      <h2>🎤 Live Speech & Emotion Analysis</h2>
      <Webcam ref={webcamRef} screenshotFormat="image/jpeg" />
      <div>
        <button onClick={startRecording} disabled={recording}>
          🎙 Start
        </button>
        <button onClick={stopRecording} disabled={!recording}>
          🛑 Stop
        </button>
      </div>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <h3>📜 Live Transcription:</h3>
      <textarea
        value={transcript}
        readOnly
        rows="10"
        cols="50"
        style={{ fontSize: "16px", width: "100%" }}
      />
      <h3>😊 Emotion: {JSON.stringify(emotions)}</h3>
      <h3>🌟 Positivity Score: {positivityScore}</h3>
    </div>
  );
}

export default LiveSpeechCamera;
