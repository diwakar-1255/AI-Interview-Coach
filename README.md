# 🚀 AI-Powered Mock Interview Platform

An intelligent interview preparation platform that simulates real-world interviews using **Google Gemini AI, Vertex AI, and Big Data technologies**.

The platform provides **AI-generated questions, real-time response evaluation, speech and emotion analysis, resume scoring, and long-term performance tracking** to help candidates improve their interview skills.

---

## 📌 Project Overview

### 🎯 Objective
The objective of this project is to build an **AI-powered mock interview platform** that offers **real-time, actionable feedback** on candidate responses.

It helps users improve:

- 🗣️ Communication skills
- 💪 Confidence
- 🧠 Technical knowledge
- 📄 Resume quality
- 🎯 Interview readiness

---

## ✨ Key Features

- ✅ **AI-Generated Interview Questions**
  - Personalized by role, domain, and experience level

- ✅ **Real-Time AI Feedback**
  - NLP-based evaluation of responses

- ✅ **Speech Analysis**
  - Voice clarity, fluency, pauses, confidence

- ✅ **Facial Emotion Analysis**
  - Engagement, confidence, and expression detection

- ✅ **AI Follow-up Questions**
  - Simulates real recruiter conversation flow

- ✅ **Resume Analysis**
  - ATS-friendly optimization and job readiness score

- ✅ **Performance Analytics**
  - Progress tracking using Big Data pipelines

- ✅ **Scalable Cloud Deployment**
  - Vertex AI pipelines and Cloud Run integration

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React.js, TailwindCSS |
| **Backend** | Flask / FastAPI |
| **Database** | BigQuery, Firestore, MongoDB |
| **Storage** | Google Cloud Storage |
| **AI/ML** | Gemini AI, Vertex AI |
| **Speech Processing** | Google Speech-to-Text API |
| **Vision Analysis** | Vertex AI AutoML Vision |
| **Big Data** | Apache Spark, Kafka, BigQuery ML |
| **Deployment** | Cloud Run, Vertex AI Endpoints |
| **Automation** | Airflow, Vertex AI Pipelines |

---

## 🏗️ System Architecture

### 🔄 Data Flow

1. User starts mock interview
2. Frontend captures audio/video
3. Data streams through Kafka
4. Speech converted to text
5. Gemini AI analyzes response
6. Emotion analysis via Vertex AI
7. Results stored in BigQuery
8. Dashboard shows insights and scores

---

## 📊 High-Level Architecture

```text
[Frontend (React.js)]  -->  [Backend (Flask/FastAPI)]
        |                          |
[Speech-to-Text API]           [Cloud Storage]
        |                          |
[Gemini AI]  -->  [Vertex AI Vision]
        |                          |
[BigQuery]   -->   [Analytics Dashboard]