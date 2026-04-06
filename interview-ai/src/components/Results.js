import React from "react";

function Results({ transcript, emotions, positivityScore }) {
  return (
    <div>
      <h3>📜 Live Transcription:</h3>
      <textarea 
        value={transcript} 
        readOnly 
        rows="10" 
        cols="50" 
        style={{ fontSize: "16px", width: "100%" }}>
      </textarea>

      <h3>😊 Emotion: {JSON.stringify(emotions)}</h3>
      <h3>🌟 Positivity Score: {positivityScore}</h3>
    </div>
  );
}

export default Results;
