# AI-Powered Mock Interview Platform

## Overview

**AI-Powered Mock Interview Platform** is an end-to-end solution that leverages advanced artificial intelligence to help job candidates prepare for interviews. The platform dynamically generates personalized interview questions, records candidate responses via live audio and video, and provides real-time transcription and facial emotion analysis. Using Google Cloud services and generative AI (Gemini API), the system also delivers detailed feedback to help candidates improve their performance.

---

## Key Features

- **Dynamic Interview Question Generation:**  
  Generates personalized technical or behavioral interview questions based on job role, industry, and job description using Google Gemini AI.

- **Live Interview Experience:**  
  - **Audio Processing:** Real-time speech-to-text transcription via Google Cloud Speech-to-Text API.  
  - **Video Processing:** Facial emotion detection and calculation of a positivity score using Google Cloud Vision API.
  - **Real-Time Updates:** Uses Flask-SocketIO to push live transcription and emotion analysis to the frontend.

- **AI Feedback:**  
  After the candidate answers a question, the system uses Gemini AI to generate detailed, actionable feedback on the candidate’s response.

- **Containerized and Scalable:**  
  Both the Flask backend and React frontend are containerized using Docker. The app is designed for deployment on Google Cloud Run for serverless scalability.

- **Kafka Integration (Optional):**  
  Audio and video files are published to Kafka topics, decoupling data ingestion from processing to support future scalability and asynchronous processing.

---

## Project Architecture

### **Frontend: React**

- **InterviewForm:**  
  A form that captures interview details (job role, industry, job description, question type) and generates interview questions by calling the Flask backend.

- **LiveInterview:**  
  - Displays the current interview question.
  - Uses the webcam and microphone to capture the candidate’s response.
  - Streams live transcription and displays a calculated positivity score.
  - Provides "Next Question" and "Exit Interview" controls.
  - Receives real-time updates from the Flask backend via Socket.IO.
  
- **Feedback:**  
  A component that formats and displays AI-generated feedback (rendering markdown when needed).

- **Navbar:**  
  A responsive navigation bar (using Bootstrap) that allows navigation between Home, Interview, and Exit pages.

### **Backend: Flask**

- **API Endpoints:**  
  - `/generate_questions`: Accepts job details, calls Gemini AI, and returns a JSON object with interview questions.
  - `/get_feedback`: Uses the accumulated candidate answer and the current question to generate feedback via Gemini AI.
  - `/send_audio` & `/send_video`: Accept and process audio/video files using Google Cloud Speech-to-Text and Vision APIs, respectively, and push results via Socket.IO.
  - `/get_transcript` & `/get_score`: Return the current live transcript and positivity score.

- **Real-Time Processing:**  
  Utilizes Flask-SocketIO with Eventlet to send real-time updates (transcription and positivity score) to the frontend.

- **Kafka Integration:**  
  Publishes audio and video data (encoded in base64) to Kafka topics for future asynchronous processing.

- **AI Integration:**  
  Uses Google Generative AI (Gemini API) to generate interview questions and provide feedback.

- **Database:**  
  Uses SQLite for local development. (The project can later be extended to use Cloud SQL for production.)

---

## How to Run the Code Locally

### **Prerequisites**

- **Node.js & npm:** Ensure Node.js (v16 recommended) and npm are installed.
- **Python 3.10+ & pip:** Ensure Python is installed.
- **Docker:** (Optional) for containerization.
- **Kafka:** Ensure Kafka is running locally if you want to test Kafka integration.
- **Google Cloud Credentials:** Create a service account key and set `GOOGLE_APPLICATION_CREDENTIALS` in a `.env` file.
- **Gemini API Key:** Set your `GEMINI_API_KEY` in the `.env` file.
- **Environment File:** Create a `.env` file in the project root with at least:
  ```env
  GOOGLE_APPLICATION_CREDENTIALS=path/to/your/service-account-key.json
  GEMINI_API_KEY=your_gemini_api_key
  SECRET_KEY=your_secret_key
  ```

### **Running the Flask Backend**

1. **Navigate to the `server` folder** (or the root if your Flask code is there).
2. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
3. **Run the Flask app:**
   ```bash
   python app.py
   ```
   The Flask backend will run on `http://localhost:5000` (ensure Kafka is running if you want to test audio/video processing).

### **Running the React Frontend**

1. **Navigate to the `client` folder.**
2. **Install npm dependencies:**
   ```bash
   npm install
   ```
3. **Run the React app:**
   ```bash
   npm start
   ```
   The React app will typically run on `http://localhost:3000`.

### **Testing the App**

- **Interview Form:** Visit `http://localhost:3000` to fill out the interview form.  
- **Live Interview:** Once questions are generated, you will be navigated to the live interview page. Start recording, answer questions, and view live transcription and positivity score.  
- **Feedback:** After stopping the recording, feedback will be generated and displayed.

---

## How to Deploy on Google Cloud

### **Step 1: Containerize the Applications**

- **Backend Dockerfile:** Create a Dockerfile in the server folder.
- **Frontend Dockerfile:** Create a multi-stage Dockerfile in the client folder that builds and serves your React app using Nginx.

### **Step 2: Build and Push Docker Images**

1. **Build the backend image:**
   ```bash
   docker build -t gcr.io/YOUR_PROJECT_ID/flask-server ./server
   ```
2. **Push the backend image:**
   ```bash
   docker push gcr.io/YOUR_PROJECT_ID/flask-server
   ```
3. **Build the frontend image:**
   ```bash
   docker build -t gcr.io/YOUR_PROJECT_ID/react-client ./client
   ```
4. **Push the frontend image:**
   ```bash
   docker push gcr.io/YOUR_PROJECT_ID/react-client
   ```

### **Step 3: Deploy to Cloud Run**

1. **Deploy the Flask backend:**
   ```bash
   gcloud run deploy flask-server-service \
     --image gcr.io/YOUR_PROJECT_ID/flask-server \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --port 8080 \
     --set-env-vars GOOGLE_APPLICATION_CREDENTIALS=/app/path/to/credentials.json,GEMINI_API_KEY=your_gemini_api_key,SECRET_KEY=your_secret_key
   ```
2. **Deploy the React frontend:**
   ```bash
   gcloud run deploy react-client-service \
     --image gcr.io/YOUR_PROJECT_ID/react-client \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --port 80
   ```

### **Step 4: Configure Networking and Domain (Optional)**

- Configure custom domains via the Cloud Run console.
- Ensure your frontend code points to the correct backend URL (update API_URL accordingly).

---

## Future Contributions

- **Enhanced Analytics:** Integrate BigQuery and Apache Spark for detailed analysis of interview sessions and candidate performance.
- **Resume Analysis:** Add modules to analyze candidate resumes using NLP and provide additional feedback.
- **Multi-Language Support:** Extend support for multiple languages in interview questions and feedback.
- **Mobile Optimization:** Create a mobile-friendly version of the platform.
- **Security Enhancements:** Move from SQLite to a production-ready database (e.g., Cloud SQL) and secure endpoints with proper authentication and authorization.
- **CI/CD Pipeline:** Integrate with Google Cloud Build or GitHub Actions for automated testing and deployment.
- **User Profiles and History:** Expand the database to store interview histories and allow candidates to track their progress over time.
- **Integration with Job Portals:** Connect with platforms like LinkedIn to suggest jobs based on interview performance.

---

## Conclusion

This project harnesses the power of AI to create a comprehensive mock interview platform. By integrating live speech transcription, facial emotion analysis, and AI-driven question and feedback generation—all deployed in a scalable cloud environment—this platform addresses a critical need in interview preparation. The project leverages Google Cloud technologies, Docker, and modern web frameworks, and it has a clear roadmap for future development and contribution.

---