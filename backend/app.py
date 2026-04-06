import os
import re
import cv2
import jwt
import json
import time
import queue
import random
import logging
import smtplib
import datetime
import threading
import requests
import numpy as np

from functools import wraps
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from pypdf import PdfReader
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from bs4 import BeautifulSoup
from scipy.spatial import distance
from google import genai
from google.genai import types


# Optional jobs engine
try:
    from jobs_engine import get_jobs, run_jobs_engine
    JOBS_ENGINE_AVAILABLE = True
except Exception:
    JOBS_ENGINE_AVAILABLE = False
    get_jobs = None
    run_jobs_engine = None


# Optional DeepFace
try:
    from deepface import DeepFace
    DEEPFACE_AVAILABLE = True
except Exception as exc:
    DEEPFACE_AVAILABLE = False
    DeepFace = None
    print(f"DeepFace not available: {exc}")


# Optional MediaPipe
try:
    import mediapipe as mp
    MEDIAPIPE_AVAILABLE = True
except Exception:
    mp = None
    MEDIAPIPE_AVAILABLE = False


# ──────────────────────────────────────────────
# Environment + constants
# ──────────────────────────────────────────────
load_dotenv()

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+\.[^@\s]+$")
MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024
MAX_CONTENT_LENGTH_BYTES = 8 * 1024 * 1024
MAX_TEXT_FIELD_LENGTH = 5000
MAX_JOB_DESCRIPTION_LENGTH = 4000
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 60
RATE_LIMIT_WINDOW_SECONDS = 60
AI_TIMEOUT_SECONDS = int(os.getenv("AI_TIMEOUT_SECONDS", "45"))
JOB_ENGINE_AUTOSTART = str(os.getenv("JOB_ENGINE_AUTOSTART", "true")).lower() in {"1", "true", "yes", "on"}

RATE_LIMIT_STORE = {}
RATE_LIMIT_LOCK = threading.Lock()

LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]
NOSE_TIP = 1
CHIN = 199
LEFT_EAR = 234
RIGHT_EAR = 454

EMOTION_POSITIVITY = {
    "happy": 1.0,
    "surprise": 0.7,
    "neutral": 0.6,
    "fear": 0.3,
    "sad": 0.2,
    "angry": 0.1,
    "disgust": 0.0,
}

EMOTION_CONFIDENCE = {
    "happy": 1.0,
    "neutral": 0.8,
    "surprise": 0.6,
    "fear": 0.4,
    "sad": 0.3,
    "angry": 0.2,
    "disgust": 0.1,
}


def utcnow():
    return datetime.datetime.utcnow()


def json_body():
    return request.get_json(silent=True) or {}


def clean_input(value, max_len=None):
    text = str(value or "").strip()
    return text[:max_len] if max_len is not None else text


def normalize_email(email: str) -> str:
    return clean_input(email).lower()


def normalize_otp(value: str) -> str:
    return re.sub(r"\D", "", str(value or "").strip())


def parse_bool(value):
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def is_valid_email(email: str) -> bool:
    return bool(EMAIL_REGEX.match((email or "").strip()))


def is_strong_password(password: str) -> bool:
    if not password or len(password) < 8:
        return False
    return (
        bool(re.search(r"[A-Z]", password))
        and bool(re.search(r"[a-z]", password))
        and bool(re.search(r"\d", password))
    )


def is_valid_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
    except Exception:
        return False


def safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def normalize_for_match(value):
    return clean_input(value).lower()


def check_rate_limit(key: str, limit: int, window_seconds: int):
    now = time.time()
    with RATE_LIMIT_LOCK:
        entries = RATE_LIMIT_STORE.get(key, [])
        entries = [t for t in entries if now - t < window_seconds]
        if len(entries) >= limit:
            retry_after = max(1, int(window_seconds - (now - entries[0])))
            RATE_LIMIT_STORE[key] = entries
            return False, retry_after
        entries.append(now)
        RATE_LIMIT_STORE[key] = entries
        return True, 0


def rate_limit_or_429(key: str, limit: int, window_seconds: int):
    allowed, retry_after = check_rate_limit(key, limit, window_seconds)
    if allowed:
        return None
    return jsonify({
        "error": "Too many requests. Please try again later.",
        "retry_after_seconds": retry_after,
    }), 429


# ──────────────────────────────────────────────
# App setup
# ──────────────────────────────────────────────
app = Flask(__name__)

SECRET_KEY = clean_input(os.getenv("SECRET_KEY"))
DATABASE_URL = clean_input(os.getenv("DATABASE_URL"))
GOOGLE_API_KEY = clean_input(os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))
GEMINI_MODEL = clean_input(os.getenv("GEMINI_MODEL") or "gemini-2.5-flash")

if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is missing")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing")
if not GOOGLE_API_KEY:
    raise RuntimeError("GOOGLE_API_KEY or GEMINI_API_KEY is missing")

app.config["SECRET_KEY"] = SECRET_KEY
app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_pre_ping": True,
    "pool_recycle": 280,
}
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH_BYTES

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
RESUMES_DIR = os.path.join(STORAGE_DIR, "resumes")
STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(RESUMES_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

DEFAULT_FRONTEND_ORIGINS = ",".join([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
])

FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", DEFAULT_FRONTEND_ORIGINS).split(",")
    if origin.strip()
]

CORS(
    app,
    resources={
        r"/*": {
            "origins": FRONTEND_ORIGINS if FRONTEND_ORIGINS else "*",
            "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"],
            "supports_credentials": True,
        }
    },
)

socketio = SocketIO(
    app,
    cors_allowed_origins=FRONTEND_ORIGINS if FRONTEND_ORIGINS else "*",
    async_mode="threading",
    max_http_buffer_size=20 * 1024 * 1024,
    ping_timeout=20,
    ping_interval=10,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

db = SQLAlchemy(app)
AI_EXECUTOR = ThreadPoolExecutor(max_workers=4)

SMTP_HOST = clean_input(os.getenv("SMTP_HOST") or "smtp.gmail.com")
SMTP_PORT = safe_int(os.getenv("SMTP_PORT") or 587, 587)
SMTP_USER = clean_input(os.getenv("SMTP_USER"))
SMTP_PASS = clean_input(os.getenv("SMTP_PASS"))
MAIL_FROM = clean_input(os.getenv("MAIL_FROM") or SMTP_USER)
OTP_EXPIRY_MINUTES = safe_int(os.getenv("OTP_EXPIRY_MINUTES") or 10, 10)

gemini_client = genai.Client(
    api_key=GOOGLE_API_KEY,
    http_options=types.HttpOptions(api_version="v1"),
)


# ──────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────
class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False, index=True)
    password = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow)

    is_verified = db.Column(db.Boolean, default=False, nullable=False)
    otp_code = db.Column(db.String(255), nullable=True)
    otp_expiry = db.Column(db.DateTime, nullable=True)
    otp_verified_at = db.Column(db.DateTime, nullable=True)
    otp_last_sent_at = db.Column(db.DateTime, nullable=True)
    otp_attempts = db.Column(db.Integer, nullable=False, default=0)

    reset_otp_code = db.Column(db.String(255), nullable=True)
    reset_otp_expiry = db.Column(db.DateTime, nullable=True)
    reset_otp_verified_at = db.Column(db.DateTime, nullable=True)
    reset_otp_last_sent_at = db.Column(db.DateTime, nullable=True)
    reset_otp_attempts = db.Column(db.Integer, nullable=False, default=0)

    resumes = db.relationship("Resume", backref="user", lazy=True, cascade="all, delete-orphan")
    interviews = db.relationship("Interview", backref="user", lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.id,
            "name": self.name,
            "email": self.email,
            "is_verified": self.is_verified,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Resume(db.Model):
    __tablename__ = "resumes"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    filename = db.Column(db.String(255), nullable=False)
    stored_name = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    extracted_text = db.Column(db.Text)
    uploaded_at = db.Column(db.DateTime, default=utcnow)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "filename": self.filename,
            "stored_name": self.stored_name,
            "file_path": self.file_path,
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None,
            "is_active": self.is_active,
        }


class Interview(db.Model):
    __tablename__ = "interviews"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    resume_id = db.Column(db.Integer, db.ForeignKey("resumes.id"), nullable=True)
    job_role = db.Column(db.String(200))
    company = db.Column(db.String(200))
    question_type = db.Column(db.String(50))
    experience_level = db.Column(db.String(50))
    job_description = db.Column(db.Text, nullable=True)
    company_website = db.Column(db.String(500), nullable=True)
    questions = db.Column(db.Text)
    feedback = db.Column(db.Text)
    answers = db.Column(db.Text, nullable=True)
    overall_score = db.Column(db.Float, nullable=True)
    current_question_index = db.Column(db.Integer, default=0)
    current_answer = db.Column(db.Text, default="")
    started_at = db.Column(db.DateTime, default=utcnow, index=True)
    completed_at = db.Column(db.DateTime, nullable=True)

    def to_dict(self):
        try:
            parsed_questions = json.loads(self.questions) if self.questions else []
        except Exception:
            parsed_questions = []

        try:
            parsed_feedback = json.loads(self.feedback) if self.feedback else []
        except Exception:
            parsed_feedback = []

        try:
            parsed_answers = json.loads(self.answers) if self.answers else []
        except Exception:
            parsed_answers = []

        return {
            "id": self.id,
            "interview_id": self.id,
            "resume_id": self.resume_id,
            "job_role": self.job_role,
            "jobRole": self.job_role,
            "company": self.company,
            "question_type": self.question_type,
            "questionType": self.question_type,
            "experience_level": self.experience_level,
            "experienceLevel": self.experience_level,
            "job_description": self.job_description or "",
            "jobDescription": self.job_description or "",
            "company_website": self.company_website or "",
            "companyWebsite": self.company_website or "",
            "questions": parsed_questions,
            "feedback": parsed_feedback,
            "answers": parsed_answers,
            "overall_score": self.overall_score,
            "final_score": self.overall_score,
            "status": "completed" if self.completed_at else "in_progress",
            "completed": self.completed_at is not None,
            "current_question_index": self.current_question_index or 0,
            "currentQuestionIndex": self.current_question_index or 0,
            "current_answer": self.current_answer or "",
            "currentAnswer": self.current_answer or "",
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class StoredJob(db.Model):
    __tablename__ = "stored_jobs"

    id = db.Column(db.Integer, primary_key=True)
    source = db.Column(db.String(100), nullable=False, default="adzuna")
    external_id = db.Column(db.String(255), nullable=True)
    title = db.Column(db.String(255), nullable=False)
    company = db.Column(db.String(255), nullable=False)
    location = db.Column(db.String(255), nullable=True)
    description = db.Column(db.Text, nullable=True)
    apply_link = db.Column(db.Text, nullable=False, unique=True)
    posted_date = db.Column(db.DateTime, nullable=True)
    apply_deadline = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(50), nullable=False, default="active")
    salary_min = db.Column(db.Float, nullable=True)
    salary_max = db.Column(db.Float, nullable=True)
    category = db.Column(db.String(255), nullable=True)
    query_text = db.Column(db.String(255), nullable=True)
    location_query = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "company": self.company,
            "location": self.location,
            "description": self.description,
            "apply_link": self.apply_link,
            "posted_date": self.posted_date.isoformat() if self.posted_date else None,
            "apply_deadline": self.apply_deadline.isoformat() if self.apply_deadline else None,
            "source": self.source,
            "salary_min": self.salary_min,
            "salary_max": self.salary_max,
            "category": self.category,
            "status": self.status,
        }


with app.app_context():
    db.create_all()


# ──────────────────────────────────────────────
# Face analysis
# ──────────────────────────────────────────────
face_mesh = None
if MEDIAPIPE_AVAILABLE and mp is not None:
    try:
        mp_face_mesh = mp.solutions.face_mesh
        face_mesh = mp_face_mesh.FaceMesh(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
            static_image_mode=False,
        )
        logger.info("MediaPipe face mesh initialized")
    except Exception as exc:
        logger.warning("MediaPipe init failed: %s", exc)
        face_mesh = None

frame_queue = queue.Queue(maxsize=20)
analysis_active_by_user = {}
latest_metrics_by_user = {}
analysis_lock = threading.Lock()
analyzers_by_user = {}


class FaceAnalyzer:
    def __init__(self):
        self.reset()

    def reset(self):
        self.prev_face_center = None
        self.blink_counter = 0
        self.start_time = time.time()
        self.frame_count = 0
        self.last_emotion = "neutral"
        self.last_emotion_scores = {}
        self.last_age = None
        self.last_deepface_time = 0
        self.deepface_interval = 2.0
        self.engagement_history = []
        self.positivity_history = []
        self.confidence_history = []

    def eye_aspect_ratio(self, landmarks, pts):
        a = distance.euclidean(landmarks[pts[1]], landmarks[pts[5]])
        b = distance.euclidean(landmarks[pts[2]], landmarks[pts[4]])
        c = distance.euclidean(landmarks[pts[0]], landmarks[pts[3]])
        return (a + b) / (2.0 * c + 1e-6)

    def head_tilt_score(self, landmarks):
        vertical_angle = abs(landmarks[NOSE_TIP][1] - landmarks[CHIN][1]) / (
            abs(landmarks[LEFT_EAR][0] - landmarks[RIGHT_EAR][0]) + 1e-6
        )
        return -0.3 if vertical_angle < 0.8 else 0.0

    def run_deepface(self, frame):
        if not DEEPFACE_AVAILABLE or DeepFace is None:
            return None
        try:
            results = DeepFace.analyze(
                frame,
                actions=["emotion", "age"],
                enforce_detection=False,
                silent=True,
            )
            result = results[0] if isinstance(results, list) else results
            return {
                "dominant_emotion": result.get("dominant_emotion", "neutral"),
                "emotion_scores": result.get("emotion", {}),
                "age": result.get("age"),
            }
        except Exception as exc:
            logger.debug("DeepFace error: %s", exc)
            return None

    def process_frame(self, frame):
        self.frame_count += 1
        if self.frame_count % 3 != 0:
            return None

        head_movement = 0.0
        head_tilt = 0.0

        if face_mesh is not None:
            try:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = face_mesh.process(rgb)

                if results.multi_face_landmarks:
                    for fl in results.multi_face_landmarks:
                        lm = {
                            i: (landmark.x * frame.shape[1], landmark.y * frame.shape[0])
                            for i, landmark in enumerate(fl.landmark)
                        }

                        ear = (
                            self.eye_aspect_ratio(lm, LEFT_EYE)
                            + self.eye_aspect_ratio(lm, RIGHT_EYE)
                        ) / 2.0

                        if ear < 0.22:
                            self.blink_counter += 1

                        face_center = np.mean(
                            [lm[i] for i in range(min(468, len(lm)))],
                            axis=0
                        )

                        if self.prev_face_center is not None:
                            head_movement = float(
                                np.linalg.norm(np.array(face_center) - np.array(self.prev_face_center))
                            )

                        self.prev_face_center = face_center
                        head_tilt = self.head_tilt_score(lm)
            except Exception as exc:
                logger.debug("MediaPipe frame error: %s", exc)

        elapsed = time.time() - self.start_time
        blinks_per_sec = self.blink_counter / elapsed if elapsed > 0 else 0

        if elapsed > 10:
            self.blink_counter = 0
            self.start_time = time.time()

        now = time.time()
        if now - self.last_deepface_time >= self.deepface_interval:
            df_result = self.run_deepface(frame)
            if df_result:
                self.last_emotion = df_result["dominant_emotion"]
                self.last_emotion_scores = df_result["emotion_scores"]
                self.last_age = df_result["age"]
            self.last_deepface_time = now

        emotion = self.last_emotion
        emotion_scores = self.last_emotion_scores

        blink_score = min(blinks_per_sec / 4, 1.0)
        movement_score = max(1.0 - min(head_movement / 40, 1.0), 0.1)
        engagement = max(
            0.0,
            min(0.4 * blink_score + 0.4 * movement_score + 0.2 * (1.0 + head_tilt), 1.0),
        )

        if emotion_scores:
            total = sum(emotion_scores.values()) or 1
            positivity = sum(
                EMOTION_POSITIVITY.get(k.lower(), 0.0) * (v / total)
                for k, v in emotion_scores.items()
            )
        else:
            positivity = EMOTION_POSITIVITY.get(emotion, 0.5)

        confidence = (
            0.5 * EMOTION_CONFIDENCE.get(emotion, 0.5)
            + 0.3 * movement_score
            + 0.2 * blink_score
        )

        self._update_history(engagement, positivity, confidence)

        return {
            "status": "success",
            "engagement_score": round(self._smooth(self.engagement_history), 3),
            "positivity_score": round(self._smooth(self.positivity_history), 3),
            "confidence_score": round(self._smooth(self.confidence_history), 3),
            "emotion": emotion,
            "emotion_scores": {k: round(v, 1) for k, v in emotion_scores.items()} if emotion_scores else {},
            "age": self.last_age,
            "deepface_active": DEEPFACE_AVAILABLE,
            "mediapipe_active": face_mesh is not None,
        }

    def _update_history(self, eng, pos, conf):
        for history, value in [
            (self.engagement_history, eng),
            (self.positivity_history, pos),
            (self.confidence_history, conf),
        ]:
            history.append(value)
            if len(history) > 8:
                history.pop(0)

    def _smooth(self, history):
        if not history:
            return 0.0
        weights = list(range(1, len(history) + 1))
        return sum(w * v for w, v in zip(weights, history)) / sum(weights)


def default_metrics():
    return {
        "engagement_score": 0.0,
        "positivity_score": 0.0,
        "confidence_score": 0.0,
        "emotion": "neutral",
        "emotion_scores": {},
        "deepface_active": DEEPFACE_AVAILABLE,
        "mediapipe_active": face_mesh is not None,
    }


def get_user_analyzer(user_id: int) -> FaceAnalyzer:
    with analysis_lock:
        if user_id not in analyzers_by_user:
            analyzers_by_user[user_id] = FaceAnalyzer()
        return analyzers_by_user[user_id]


def reset_user_analyzer(user_id: int):
    with analysis_lock:
        analyzers_by_user[user_id] = FaceAnalyzer()
        latest_metrics_by_user[user_id] = default_metrics()
        analysis_active_by_user[user_id] = False


def process_frames_worker():
    while True:
        try:
            item = frame_queue.get(timeout=1)
            if item is None:
                break
            user_id, frame = item
            analyzer = get_user_analyzer(user_id)
            result = analyzer.process_frame(frame)
            if result:
                with analysis_lock:
                    latest_metrics_by_user[user_id] = result
        except queue.Empty:
            continue
        except Exception as exc:
            logger.error("Frame worker error: %s", exc)


threading.Thread(target=process_frames_worker, daemon=True).start()


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
def validate_password_or_400(password):
    if not is_strong_password(password):
        return jsonify({
            "error": "Password must be at least 8 characters and include uppercase, lowercase, and a number"
        }), 400
    return None


def validate_job_inputs(form_data):
    if not form_data["jobRole"]:
        return "Job role is required"
    if not form_data["jobDescription"]:
        return "Job description is required"
    if len(form_data["jobDescription"]) > MAX_JOB_DESCRIPTION_LENGTH:
        return "Job description is too long"
    if form_data["companyWebsite"] and not is_valid_url(form_data["companyWebsite"]):
        return "Company website URL is invalid"
    return None


def enforce_otp_send_cooldown_or_429(user, field_name="otp_last_sent_at"):
    last_sent = getattr(user, field_name, None)
    if not last_sent:
        return None
    delta = (utcnow() - last_sent).total_seconds()
    if delta < OTP_RESEND_COOLDOWN_SECONDS:
        retry_after = int(OTP_RESEND_COOLDOWN_SECONDS - delta)
        return jsonify({
            "error": "Please wait before requesting another OTP",
            "retry_after_seconds": max(retry_after, 1),
        }), 429
    return None


def mark_otp_sent(user, hashed_field_name, expiry_field_name, last_sent_field_name, otp_plain):
    setattr(user, hashed_field_name, generate_password_hash(otp_plain, method="pbkdf2:sha256"))
    setattr(user, expiry_field_name, utcnow() + datetime.timedelta(minutes=OTP_EXPIRY_MINUTES))
    setattr(user, last_sent_field_name, utcnow())


def reset_otp_state(user):
    user.otp_code = None
    user.otp_expiry = None
    user.otp_verified_at = None
    user.otp_attempts = 0


def reset_reset_otp_state(user):
    user.reset_otp_code = None
    user.reset_otp_expiry = None
    user.reset_otp_verified_at = None
    user.reset_otp_attempts = 0


def safe_json_parse(text):
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty response from Gemini")

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        parts = text.split("```")
        if len(parts) > 1:
            text = parts[1].strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return json.loads(match.group(0))

    raise ValueError(f"Could not parse JSON from model response: {text[:300]}")


def run_with_timeout(func, *args, timeout=AI_TIMEOUT_SECONDS, **kwargs):
    future = AI_EXECUTOR.submit(func, *args, **kwargs)
    try:
        return future.result(timeout=timeout)
    except FuturesTimeoutError:
        future.cancel()
        raise TimeoutError(f"AI request exceeded {timeout} seconds")


def normalize_question_list(questions):
    normalized = []
    for i, item in enumerate(questions[:10], start=1):
        q = item.get("question") if isinstance(item, dict) else str(item)
        q = (q or "").strip()
        if q:
            normalized.append({"id": i, "question": q})
    return normalized


def generate_otp():
    return f"{random.randint(100000, 999999)}"


def validate_smtp_config():
    if not SMTP_USER or not SMTP_PASS:
        raise RuntimeError("SMTP credentials are missing in .env")
    if not MAIL_FROM:
        raise RuntimeError("MAIL_FROM is missing in .env")


def send_email_message(subject, body, to_email):
    validate_smtp_config()

    msg = MIMEMultipart()
    msg["From"] = MAIL_FROM
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    server = None
    try:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20)
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(MAIL_FROM, [to_email], msg.as_string())
    finally:
        if server is not None:
            try:
                server.quit()
            except Exception:
                pass


def send_otp_email(to_email, otp_code, user_name="User"):
    body = f"""
Hi {user_name},

Your OTP for verifying your account is: {otp_code}

This OTP will expire in {OTP_EXPIRY_MINUTES} minutes.

If you did not create this account, you can ignore this email.

- AI Interview Coach
""".strip()
    send_email_message("Verify your AI Interview Coach account", body, to_email)


def send_reset_password_email(to_email, otp_code, user_name="User"):
    body = f"""
Hi {user_name},

Your OTP for resetting your password is: {otp_code}

This OTP will expire in {OTP_EXPIRY_MINUTES} minutes.

If you did not request a password reset, you can ignore this email.

- AI Interview Coach
""".strip()
    send_email_message("Reset your AI Interview Coach password", body, to_email)


def scrape_company_info(url):
    if not url or not is_valid_url(url):
        return ""
    try:
        response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=3)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for tag in ["script", "style", "nav", "footer", "noscript", "svg"]:
            for el in soup.find_all(tag):
                el.decompose()
        text = soup.get_text(separator=" ", strip=True)
        return " ".join(text.split())[:1500]
    except Exception as exc:
        logger.warning("Company scrape failed: %s", exc)
        return ""


def extract_text_from_pdf(path):
    text = ""
    reader = PdfReader(path)
    for page in reader.pages:
        text += page.extract_text() or ""
        text += "\n"
    return text.strip()


def clean_resume_text(text):
    if not text:
        return ""
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" ?• ?", "\n- ", text)
    text = re.sub(r"\s+\n", "\n", text)
    text = re.sub(r"\n\s+", "\n", text)
    text = re.sub(r"[^\S\n]+", " ", text)
    return text.strip()


def extract_resume_sections(text):
    sections = {
        "summary": "",
        "skills": "",
        "education": "",
        "experience": "",
        "projects": "",
        "certifications": "",
    }

    if not text:
        return sections

    lines = [line.strip() for line in text.splitlines()]
    current = None
    mapping = {
        "summary": "summary",
        "profile": "summary",
        "professional summary": "summary",
        "skills": "skills",
        "technical skills": "skills",
        "education": "education",
        "experience": "experience",
        "work experience": "experience",
        "projects": "projects",
        "project": "projects",
        "certifications": "certifications",
        "certificates": "certifications",
    }

    for line in lines:
        normalized = line.lower().strip(":").strip()
        if normalized in mapping:
            current = mapping[normalized]
            continue
        if current and line:
            sections[current] += line + "\n"

    return {k: v.strip() for k, v in sections.items()}


def extract_resume_keywords(resume_text):
    if not resume_text:
        return []

    common_skills = [
        "python", "java", "javascript", "typescript", "c", "c++", "react", "node", "node.js",
        "flask", "django", "sql", "mysql", "postgresql", "mongodb", "redis", "docker",
        "kubernetes", "aws", "azure", "gcp", "git", "rest api", "graphql", "system design",
        "data structures", "algorithms", "oop", "dbms", "os", "computer networks",
        "html", "css", "machine learning", "deep learning", "tensorflow", "pytorch",
        "pandas", "numpy", "linux", "socket.io", "websockets", "ci/cd"
    ]

    lower_text = resume_text.lower()
    found = []
    for skill in common_skills:
        pattern = r"\b" + re.escape(skill) + r"\b"
        if re.search(pattern, lower_text):
            found.append(skill)

    deduped = []
    seen = set()
    for skill in found:
        if skill not in seen:
            seen.add(skill)
            deduped.append(skill)
    return deduped[:15]


def extract_project_lines(text):
    if not text:
        return []
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    candidates = []
    for line in lines:
        if len(line) < 120 and any(
            token in line.lower()
            for token in ["project", "system", "app", "platform", "portal", "website", "tool"]
        ):
            candidates.append(line)
    return candidates[:5]


def build_resume_analysis(resume_text, job_description=""):
    cleaned = clean_resume_text(resume_text)
    sections = extract_resume_sections(cleaned)
    skills = extract_resume_keywords(cleaned)
    projects = extract_project_lines(sections.get("projects") or cleaned)

    jd_skills = extract_resume_keywords(job_description)
    matched_skills = [s for s in skills if s in jd_skills]
    missing_skills = [s for s in jd_skills if s not in skills]
    match_score = round((len(matched_skills) / len(jd_skills)) * 100) if jd_skills else 0

    return {
        "cleaned_text": cleaned[:3500],
        "skills": skills,
        "summary": (sections.get("summary") or "")[:800],
        "education": (sections.get("education") or "")[:800],
        "experience": (sections.get("experience") or "")[:1200],
        "projects": projects,
        "certifications": (sections.get("certifications") or "")[:500],
        "matched_skills": matched_skills[:10],
        "missing_skills": missing_skills[:10],
        "match_score": match_score,
    }


def normalize_question_type(value):
    v = normalize_for_match(value)
    if v in {"technical", "tech", "tectnical"}:
        return "Technical"
    if v in {"behavioral", "behooviral", "behavioural", "behavior", "behaviour"}:
        return "Behavioral"
    if v in {"mixed", "mix"}:
        return "Mixed"
    return "Technical"


def fallback_generate_questions(resume_text, form_data):
    role = form_data.get("jobRole", "candidate")
    company = form_data.get("company", "the company")
    level = form_data.get("experienceLevel", "Mid")
    qtype = normalize_question_type(form_data.get("questionType", "Mixed"))
    jd = form_data.get("jobDescription", "")
    analysis = build_resume_analysis(resume_text, jd)
    skills = analysis.get("skills", [])
    projects = analysis.get("projects", [])
    matched_skills = analysis.get("matched_skills", [])

    skill_line = ", ".join(skills[:6]) if skills else "your core technical skills"
    matched_line = ", ".join(matched_skills[:6]) if matched_skills else skill_line
    project_line = projects[0] if projects else "one project from your resume"

    technical_role_questions = [
        f"Explain how your background prepares you for the {role} position at {company}.",
        f"Which technical skills are most important for this {role} role, and how have you used them?",
        f"How would you solve a realistic problem from this job description: {jd[:220]}",
        f"What trade-offs would you consider while designing a solution for this role?",
        f"How do you test and validate the quality of your work in a {role} position?",
        f"What would be your approach during your first 30 days as a {role} at {company}?",
    ]

    resume_based_technical = [
        f"Can you explain {project_line} and the technical decisions behind it?",
        f"How have you used {matched_line} in your real projects or academic work?",
        f"Which project in your resume best demonstrates problem-solving for this role and why?",
        f"Describe a technical challenge from your resume and how you solved it.",
    ]

    behavioral_questions = [
        f"Tell me about a time you solved a difficult problem under pressure.",
        f"Describe a situation where you had to learn something quickly to finish a task.",
        f"Tell me about a time you worked with others to complete a project successfully.",
        f"Describe a mistake you made and what you learned from it.",
        f"Tell me about a situation where you had to communicate a complex idea clearly.",
        f"Describe a time you handled disagreement or conflict in a team.",
        f"What challenge from your resume taught you the most about responsibility?",
        f"Tell me about a project from your resume where you showed leadership or ownership.",
        f"Describe how one of your resume projects changed based on feedback.",
        f"Why are you a strong fit for this {level} level opportunity?",
    ]

    mixed_questions = [
        f"Tell me about yourself and your background relevant to the {role} position.",
        f"Why do you want to work as a {role} at {company}?",
        f"Which of your skills are the best match for this role and why?",
        f"Can you explain {project_line} and the impact it had?",
        f"What technical challenge have you faced in previous work or projects, and how did you solve it?",
        f"How have you used {skill_line} in real projects or practice?",
        f"What do you understand from this job description, and how does your profile match it?",
        f"Describe a situation where you had to communicate a technical idea clearly to someone else.",
        f"What would be your approach to learning quickly and contributing in your first few weeks at {company}?",
        f"What makes you a strong fit for this mixed interview for the {role} role?",
    ]

    if qtype == "Technical":
        questions = technical_role_questions[:6] + resume_based_technical[:4]
    elif qtype == "Behavioral":
        questions = behavioral_questions[:10]
    else:
        questions = mixed_questions[:10]

    return {
        "questions": [{"id": i + 1, "question": q} for i, q in enumerate(questions)],
        "resume_analysis": analysis,
    }


def build_question_prompt_instructions(form_data, resume_analysis, company_context):
    qtype = normalize_question_type(form_data["questionType"])

    if qtype == "Technical":
        distribution = """
Generate exactly 10 questions.
Question distribution must be:
- 6 role/job-description based technical questions
- 4 resume/project/experience based technical questions

Do not make all questions generic.
All 10 must still feel role-specific.
"""
    elif qtype == "Behavioral":
        distribution = """
Generate exactly 10 behavioral questions.
Question distribution must be:
- 6 situational/problem-solving/decision-making questions
- 4 resume/project/experience based behavioral questions

Avoid generic HR-only questions.
"""
    else:
        distribution = """
Generate exactly 10 mixed questions.
Question distribution should balance:
- technical role-based questions
- resume/project-based questions
- behavioral/situational questions
"""

    return f"""
You are an expert interview coach.

{distribution}

Requirements:
- Personalize questions to the candidate's actual resume, skills, projects, and experience.
- Match the target role and job description closely.
- Avoid repeated or generic questions.
- Include project-based questions if projects are present.
- Return ONLY valid JSON.

Role: {form_data['jobRole']}
Company: {form_data['company']}
Experience Level: {form_data['experienceLevel']}
Question Type: {qtype}

Job Description:
{form_data['jobDescription'][:2000]}

Resume Analysis:
{json.dumps(resume_analysis, ensure_ascii=False)[:2500]}

Company Context:
{company_context[:1200]}

Return only valid JSON with this exact structure:
{{
  "questions": [
    {{"id": 1, "question": "..." }},
    {{"id": 2, "question": "..." }},
    {{"id": 3, "question": "..." }},
    {{"id": 4, "question": "..." }},
    {{"id": 5, "question": "..." }},
    {{"id": 6, "question": "..." }},
    {{"id": 7, "question": "..." }},
    {{"id": 8, "question": "..." }},
    {{"id": 9, "question": "..." }},
    {{"id": 10, "question": "..." }}
  ]
}}
""".strip()


def generate_questions_with_rag(resume_text, form_data):
    company_context = ""
    if form_data["companyWebsite"]:
        company_context = scrape_company_info(form_data["companyWebsite"])

    resume_analysis = build_resume_analysis(resume_text, form_data["jobDescription"])
    prompt = build_question_prompt_instructions(form_data, resume_analysis, company_context)

    response = gemini_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0.35),
    )

    raw_text = (response.text or "").strip()
    parsed = safe_json_parse(raw_text)
    questions = parsed.get("questions", []) if isinstance(parsed, dict) else []
    normalized = normalize_question_list(questions)

    if len(normalized) != 10:
        raise ValueError(f"Expected 10 questions, got {len(normalized)}")

    return {
        "questions": normalized,
        "resume_analysis": resume_analysis,
    }


def analyze_answer_with_gemini(question, response_text):
    prompt = f"""
You are an expert interview coach.

Evaluate this interview response.

Question:
{question}

Candidate Response:
{response_text[:4000]}

Return only valid JSON in this exact format:
{{
  "concise_feedback": "...",
  "technical_score": 3,
  "communication_score": 3,
  "overall_score": 65,
  "strengths": ["..."],
  "improvements": ["..."],
  "suggested_answer": "..."
}}
""".strip()

    response = gemini_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0.3),
    )

    parsed = safe_json_parse((response.text or "").strip())

    def to_int(value, default=0):
        try:
            return int(value)
        except Exception:
            return default

    def to_list(value):
        if isinstance(value, list):
            return [str(x).strip() for x in value if str(x).strip()]
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        return []

    return {
        "concise_feedback": str(parsed.get("concise_feedback", "") or "").strip(),
        "technical_score": to_int(parsed.get("technical_score", 0)),
        "communication_score": to_int(parsed.get("communication_score", 0)),
        "overall_score": to_int(parsed.get("overall_score", 0)),
        "strengths": to_list(parsed.get("strengths", [])),
        "improvements": to_list(parsed.get("improvements", [])),
        "suggested_answer": str(parsed.get("suggested_answer", "") or "").strip(),
    }


def fallback_analyze_answer(question, response_text):
    word_count = len((response_text or "").split())
    technical_score = 2
    communication_score = 2

    if word_count >= 25:
        communication_score = 3
    if word_count >= 60:
        communication_score = 4

    technical_keywords = [
        "because", "approach", "design", "optimize", "database", "api",
        "algorithm", "tradeoff", "performance", "scalable", "testing"
    ]
    matches = sum(1 for kw in technical_keywords if kw in response_text.lower())
    if matches >= 2:
        technical_score = 3
    if matches >= 4:
        technical_score = 4

    overall = min(100, max(35, int(((technical_score + communication_score) / 8) * 100)))

    return {
        "concise_feedback": "Your answer has been saved. Fallback feedback was used because the AI model was unavailable or slow.",
        "technical_score": technical_score,
        "communication_score": communication_score,
        "overall_score": overall,
        "strengths": [
            "You attempted the question",
            "Your response was captured successfully"
        ],
        "improvements": [
            "Add more structure to your answer",
            "Include specific examples, tools, or results",
            "Explain your approach more clearly"
        ],
        "suggested_answer": (
            f"A stronger answer to '{question}' should include context, your approach, "
            f"the tools or concepts used, and the final result."
        ),
    }


def get_user_resume_dir(user_id):
    user_dir = os.path.join(RESUMES_DIR, f"user_{user_id}")
    os.makedirs(user_dir, exist_ok=True)
    return user_dir


def get_active_resume(current_user):
    return (
        Resume.query
        .filter_by(user_id=current_user.id, is_active=True)
        .order_by(Resume.uploaded_at.desc())
        .first()
    )


def save_uploaded_resume_for_user(current_user, file_storage):
    if not file_storage or not file_storage.filename:
        raise ValueError("No resume file provided")

    if not file_storage.filename.lower().endswith(".pdf"):
        raise ValueError("Only PDF files accepted")

    file_storage.seek(0, os.SEEK_END)
    file_size = file_storage.tell()
    file_storage.seek(0)

    if file_size > MAX_RESUME_SIZE_BYTES:
        raise ValueError("Resume file is too large. Maximum size is 5MB.")

    original_name = secure_filename(file_storage.filename)
    timestamp = utcnow().strftime("%Y%m%d_%H%M%S")
    stored_name = f"{timestamp}_{original_name}"
    user_dir = get_user_resume_dir(current_user.id)
    file_path = os.path.join(user_dir, stored_name)

    file_storage.save(file_path)
    extracted_text = clean_resume_text(extract_text_from_pdf(file_path))

    Resume.query.filter_by(user_id=current_user.id, is_active=True).update({"is_active": False})

    resume = Resume(
        user_id=current_user.id,
        filename=original_name,
        stored_name=stored_name,
        file_path=file_path,
        extracted_text=extracted_text,
        is_active=True,
    )
    db.session.add(resume)
    db.session.commit()
    return resume


def get_request_form_data():
    if request.content_type and "application/json" in request.content_type:
        data = json_body()
        return {
            "jobRole": clean_input(data.get("jobRole"), 200),
            "company": clean_input(data.get("company") or "the company", 200) or "the company",
            "jobDescription": clean_input(data.get("jobDescription"), MAX_JOB_DESCRIPTION_LENGTH),
            "questionType": normalize_question_type(data.get("questionType") or "Technical"),
            "experienceLevel": clean_input(data.get("experienceLevel") or "Mid", 50) or "Mid",
            "companyWebsite": clean_input(data.get("companyWebsite"), 500),
            "useExistingResume": parse_bool(data.get("useExistingResume", False)),
        }

    return {
        "jobRole": clean_input(request.form.get("jobRole"), 200),
        "company": clean_input(request.form.get("company", "the company"), 200) or "the company",
        "jobDescription": clean_input(request.form.get("jobDescription"), MAX_JOB_DESCRIPTION_LENGTH),
        "questionType": normalize_question_type(request.form.get("questionType", "Technical")),
        "experienceLevel": clean_input(request.form.get("experienceLevel", "Mid"), 50) or "Mid",
        "companyWebsite": clean_input(request.form.get("companyWebsite"), 500),
        "useExistingResume": parse_bool(request.form.get("useExistingResume", False)),
    }


def parse_questions(interview):
    try:
        return json.loads(interview.questions) if interview.questions else []
    except Exception:
        return []


def parse_feedback(interview):
    try:
        return json.loads(interview.feedback) if interview.feedback else []
    except Exception:
        return []


def parse_answers(interview):
    try:
        return json.loads(interview.answers) if interview.answers else []
    except Exception:
        return []


def save_answers(interview, answers_list):
    interview.answers = json.dumps(answers_list)


def save_feedback(interview, feedback_list):
    interview.feedback = json.dumps(feedback_list)


def current_question_for_interview(interview):
    questions = parse_questions(interview)
    idx = max(0, min(interview.current_question_index or 0, max(len(questions) - 1, 0)))
    return questions, idx


def find_recent_matching_in_progress_interview(current_user, form_data, resume_id):
    cutoff = utcnow() - datetime.timedelta(minutes=10)

    rows = (
        Interview.query
        .filter(
            Interview.user_id == current_user.id,
            Interview.completed_at.is_(None),
            Interview.started_at >= cutoff,
        )
        .order_by(Interview.started_at.desc())
        .all()
    )

    for row in rows:
        if (
            row.resume_id == resume_id and
            normalize_for_match(row.job_role) == normalize_for_match(form_data["jobRole"]) and
            normalize_for_match(row.company) == normalize_for_match(form_data["company"]) and
            normalize_for_match(row.job_description) == normalize_for_match(form_data["jobDescription"]) and
            normalize_for_match(row.question_type) == normalize_for_match(form_data["questionType"]) and
            normalize_for_match(row.experience_level) == normalize_for_match(form_data["experienceLevel"]) and
            normalize_for_match(row.company_website) == normalize_for_match(form_data["companyWebsite"])
        ):
            return row
    return None


def get_interview_or_404(current_user, interview_id):
    interview = Interview.query.filter_by(id=interview_id, user_id=current_user.id).first()
    if not interview:
        return None, (jsonify({"error": "Interview not found"}), 404)
    return interview, None


def merge_feedback_lists(existing_feedback, incoming_feedback):
    merged = existing_feedback[:]
    if not isinstance(incoming_feedback, list):
        return merged
    while len(merged) < len(incoming_feedback):
        merged.append(None)
    for i, item in enumerate(incoming_feedback):
        if item:
            merged[i] = item
    return merged


def merge_answers_lists(existing_answers, incoming_answers):
    merged = existing_answers[:]
    if not isinstance(incoming_answers, list):
        return merged
    while len(merged) < len(incoming_answers):
        merged.append("")
    for i, item in enumerate(incoming_answers):
        if item is not None and str(item).strip() != "":
            merged[i] = item
    return merged


def calculate_final_score_from_feedback(feedback_list, question_count=None):
    usable_feedback = feedback_list[:question_count] if question_count is not None else feedback_list
    scores = [
        f.get("overall_score", 0)
        for f in usable_feedback
        if isinstance(f, dict) and f.get("overall_score") is not None
    ]
    return round(sum(scores) / len(scores), 1) if scores else 0.0


def build_recommended_jobs_for_user(current_user, limit=20):
    active_resume = get_active_resume(current_user)
    resume_text = active_resume.extracted_text if active_resume else ""
    skills = extract_resume_keywords(resume_text)
    lower_skills = [s.lower() for s in skills]

    latest_interview = (
        Interview.query.filter_by(user_id=current_user.id)
        .order_by(Interview.started_at.desc())
        .first()
    )
    role_hint = latest_interview.job_role.lower() if latest_interview and latest_interview.job_role else ""

    rows = (
        StoredJob.query
        .filter(StoredJob.status == "active")
        .order_by(StoredJob.posted_date.desc().nullslast(), StoredJob.id.desc())
        .limit(300)
        .all()
    )

    scored = []
    for job in rows:
        hay = " ".join([
            clean_input(job.title).lower(),
            clean_input(job.company).lower(),
            clean_input(job.location).lower(),
            clean_input(job.description).lower(),
            clean_input(job.category).lower(),
            clean_input(job.query_text).lower(),
        ])

        score = 0
        if role_hint and role_hint in hay:
            score += 8

        for skill in lower_skills:
            if skill and skill in hay:
                score += 3

        if "remote" in hay:
            score += 1

        if score > 0:
            scored.append((score, job))

    scored.sort(key=lambda x: (x[0], x[1].posted_date or datetime.datetime.min), reverse=True)
    return [item[1].to_dict() for item in scored[:limit]]


def start_jobs_engine_background():
    if not JOBS_ENGINE_AVAILABLE or run_jobs_engine is None:
        logger.info("Jobs engine not available, skipping background startup.")
        return

    def _runner():
        try:
            logger.info("Starting background jobs engine sync...")
            run_jobs_engine()
            logger.info("Background jobs engine sync completed.")
        except Exception as exc:
            logger.exception("Background jobs engine sync failed: %s", exc)

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()


# ──────────────────────────────────────────────
# Auth helpers
# ──────────────────────────────────────────────
def create_token_for_user(user_id: int):
    return jwt.encode(
        {
            "user_id": user_id,
            "exp": utcnow() + datetime.timedelta(hours=24),
        },
        app.config["SECRET_KEY"],
        algorithm="HS256",
    )


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.method == "OPTIONS":
            return jsonify({"ok": True}), 200

        auth_header = request.headers.get("Authorization", "").strip()
        token = auth_header.replace("Bearer ", "").strip() if auth_header else ""

        if not token:
            return jsonify({"error": "Token is missing"}), 401

        try:
            data = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
            current_user = db.session.get(User, data["user_id"])
            if not current_user:
                return jsonify({"error": "User not found"}), 401
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token has expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Token is invalid"}), 401
        except Exception as exc:
            logger.exception("Token validation failed: %s", exc)
            return jsonify({"error": "Token is invalid"}), 401

        return f(current_user, *args, **kwargs)

    return decorated


# ──────────────────────────────────────────────
# Response hooks + errors
# ──────────────────────────────────────────────
@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(RequestEntityTooLarge)
def handle_large_file(_error):
    return jsonify({"error": "Uploaded file is too large"}), 413


@app.errorhandler(HTTPException)
def handle_http_error(error):
    return jsonify({
        "error": error.name,
        "message": error.description,
        "status": error.code,
    }), error.code


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    logger.exception("Unhandled error occurred: %s", error)
    return jsonify({
        "error": "Internal Server Error",
        "message": "Something went wrong on the server",
        "status": 500,
    }), 500


# ──────────────────────────────────────────────
# Basic routes
# ──────────────────────────────────────────────
@app.route("/", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "message": "AI Interview backend running",
        "model": GEMINI_MODEL,
        "deepface": DEEPFACE_AVAILABLE,
        "mediapipe": face_mesh is not None,
        "allowed_origins": FRONTEND_ORIGINS,
        "jobs_engine_available": JOBS_ENGINE_AVAILABLE,
    }), 200


@app.route("/favicon.ico")
def favicon():
    icon_file = os.path.join(STATIC_DIR, "favicon.ico")
    if os.path.exists(icon_file):
        return send_from_directory(STATIC_DIR, "favicon.ico", mimetype="image/vnd.microsoft.icon")
    return "", 204


# ──────────────────────────────────────────────
# Jobs routes
# ──────────────────────────────────────────────
@app.route("/api/jobs", methods=["GET"])
def jobs_route():
    limited = rate_limit_or_429(f"jobs:{request.remote_addr}", limit=20, window_seconds=RATE_LIMIT_WINDOW_SECONDS)
    if limited:
        return limited

    try:
        query = clean_input(request.args.get("query"), 150)
        location = clean_input(request.args.get("location"), 150)
        page = max(1, safe_int(request.args.get("page", 1), 1))

        if not JOBS_ENGINE_AVAILABLE or get_jobs is None:
            return jsonify({
                "jobs": [],
                "count": 0,
                "page": page,
                "query": query,
                "location": location,
                "warning": "jobs_engine.py is not available",
            }), 200

        jobs = get_jobs(query=query, location=location, page=page)
        if not isinstance(jobs, list):
            jobs = []

        return jsonify({
            "jobs": jobs,
            "count": len(jobs),
            "page": page,
            "query": query,
            "location": location,
        }), 200
    except Exception as exc:
        logger.exception("Jobs fetch failed: %s", exc)
        return jsonify({
            "jobs": [],
            "count": 0,
            "page": 1,
            "query": "",
            "location": "",
            "error": "Failed to fetch jobs",
        }), 200


@app.route("/api/jobs/recommended", methods=["GET"])
@token_required
def recommended_jobs_route(current_user):
    try:
        jobs = build_recommended_jobs_for_user(current_user, limit=20)
        return jsonify({
            "jobs": jobs,
            "count": len(jobs),
        }), 200
    except Exception as exc:
        logger.exception("Recommended jobs failed: %s", exc)
        return jsonify({"jobs": [], "count": 0, "error": "Failed to fetch recommended jobs"}), 200


@app.route("/api/jobs/run-engine", methods=["POST"])
def run_jobs_engine_route():
    try:
        if not JOBS_ENGINE_AVAILABLE or run_jobs_engine is None:
            return jsonify({"error": "jobs_engine.py is not available"}), 500
        result = run_jobs_engine()
        return jsonify(result), 200
    except Exception as exc:
        logger.exception("Jobs engine run failed: %s", exc)
        return jsonify({"error": "Failed to run jobs engine"}), 500


# ──────────────────────────────────────────────
# Auth routes
# ──────────────────────────────────────────────
@app.route("/api/register", methods=["POST"])
def register():
    limited = rate_limit_or_429(f"register:{request.remote_addr}", limit=5, window_seconds=RATE_LIMIT_WINDOW_SECONDS)
    if limited:
        return limited

    try:
        data = json_body()
        name = clean_input(data.get("name"), 100)
        email = normalize_email(data.get("email"))
        password = clean_input(data.get("password"), 255)

        if not all([name, email, password]):
            return jsonify({"error": "Name, email and password are required"}), 400

        if not is_valid_email(email):
            return jsonify({"error": "Invalid email format"}), 400

        password_error = validate_password_or_400(password)
        if password_error:
            return password_error

        existing_user = User.query.filter_by(email=email).first()
        otp_code = generate_otp()

        if existing_user and existing_user.is_verified:
            return jsonify({"error": "Email already exists"}), 400

        if existing_user and not existing_user.is_verified:
            cooldown_resp = enforce_otp_send_cooldown_or_429(existing_user, "otp_last_sent_at")
            if cooldown_resp:
                return cooldown_resp

            existing_user.name = name
            existing_user.password = generate_password_hash(password, method="pbkdf2:sha256")
            mark_otp_sent(existing_user, "otp_code", "otp_expiry", "otp_last_sent_at", otp_code)
            existing_user.otp_verified_at = None
            existing_user.otp_attempts = 0
            send_otp_email(existing_user.email, otp_code, existing_user.name)
            db.session.commit()

            return jsonify({
                "message": "OTP sent to your email. Please verify your account.",
                "email": existing_user.email,
                "requires_verification": True,
                "otp_sent": True,
            }), 200

        user = User(
            name=name,
            email=email,
            password=generate_password_hash(password, method="pbkdf2:sha256"),
            is_verified=False,
        )
        db.session.add(user)
        db.session.flush()

        mark_otp_sent(user, "otp_code", "otp_expiry", "otp_last_sent_at", otp_code)
        user.otp_attempts = 0

        send_otp_email(user.email, otp_code, user.name)
        db.session.commit()
        get_user_resume_dir(user.id)

        return jsonify({
            "message": "Registered successfully. OTP sent to your email.",
            "email": user.email,
            "requires_verification": True,
            "otp_sent": True,
        }), 201

    except Exception as exc:
        db.session.rollback()
        logger.exception("Registration failed: %s", exc)
        return jsonify({"error": "Registration failed"}), 500


@app.route("/api/verify-otp", methods=["POST"])
def verify_otp():
    limited = rate_limit_or_429(f"verify-otp:{request.remote_addr}", limit=8, window_seconds=RATE_LIMIT_WINDOW_SECONDS)
    if limited:
        return limited

    try:
        data = json_body()
        email = normalize_email(data.get("email"))
        otp = normalize_otp(data.get("otp"))

        if not email or not otp:
            return jsonify({"error": "Email and OTP are required"}), 400

        user = User.query.filter_by(email=email).first()
        if not user:
            return jsonify({"error": "User not found"}), 404

        if user.is_verified:
            return jsonify({"message": "Account already verified"}), 200

        if not user.otp_code or not user.otp_expiry:
            return jsonify({"error": "No OTP found. Please register again."}), 400

        if user.otp_attempts >= OTP_MAX_ATTEMPTS:
            return jsonify({"error": "Too many invalid OTP attempts. Please request a new OTP."}), 429

        if utcnow() > user.otp_expiry:
            reset_otp_state(user)
            db.session.commit()
            return jsonify({"error": "OTP expired. Please request a new OTP."}), 400

        if not check_password_hash(user.otp_code, otp):
            user.otp_attempts += 1
            db.session.commit()
            return jsonify({"error": "Invalid OTP"}), 400

        user.is_verified = True
        user.otp_verified_at = utcnow()
        reset_otp_state(user)
        db.session.commit()

        return jsonify({"message": "Email verified successfully. You can now log in."}), 200

    except Exception as exc:
        db.session.rollback()
        logger.exception("OTP verification failed: %s", exc)
        return jsonify({"error": "OTP verification failed"}), 500


@app.route("/api/resend-otp", methods=["POST"])
def resend_otp():
    limited = rate_limit_or_429(f"resend-otp:{request.remote_addr}", limit=5, window_seconds=RATE_LIMIT_WINDOW_SECONDS)
    if limited:
        return limited

    try:
        data = json_body()
        email = normalize_email(data.get("email"))

        if not email:
            return jsonify({"error": "Email is required"}), 400

        user = User.query.filter_by(email=email).first()
        if not user:
            return jsonify({"error": "User not found"}), 404

        if user.is_verified:
            return jsonify({"message": "Account already verified"}), 200

        cooldown_resp = enforce_otp_send_cooldown_or_429(user, "otp_last_sent_at")
        if cooldown_resp:
            return cooldown_resp

        otp_code = generate_otp()
        mark_otp_sent(user, "otp_code", "otp_expiry", "otp_last_sent_at", otp_code)
        user.otp_verified_at = None
        user.otp_attempts = 0

        send_otp_email(user.email, otp_code, user.name)
        db.session.commit()

        return jsonify({
            "message": "OTP resent successfully",
            "email": user.email,
            "otp_sent": True,
        }), 200

    except Exception as exc:
        db.session.rollback()
        logger.exception("Failed to resend OTP: %s", exc)
        return jsonify({"error": "Failed to resend OTP"}), 500


@app.route("/api/login", methods=["POST"])
def login():
    limited = rate_limit_or_429(f"login:{request.remote_addr}", limit=8, window_seconds=RATE_LIMIT_WINDOW_SECONDS)
    if limited:
        return limited

    try:
        data = json_body()
        email = normalize_email(data.get("email"))
        password = clean_input(data.get("password"), 255)

        if not email or not password:
            return jsonify({"error": "Email and password are required"}), 400

        user = User.query.filter_by(email=email).first()

        if not user or not check_password_hash(user.password, password):
            logger.warning("Login failed for %s", email)
            return jsonify({"error": "Invalid credentials"}), 401

        if not user.is_verified:
            return jsonify({
                "error": "Please verify your email before logging in",
                "requires_verification": True,
                "email": user.email,
            }), 403

        token = create_token_for_user(user.id)

        return jsonify({
            "token": token,
            "user_id": user.id,
            "name": user.name,
            "email": user.email,
            "message": "Login successful",
        }), 200

    except Exception as exc:
        logger.exception("Login failed: %s", exc)
        return jsonify({"error": "Login failed"}), 500


@app.route("/api/check-auth", methods=["GET"])
@token_required
def check_auth(current_user):
    return jsonify({
        "authenticated": True,
        "user": current_user.to_dict(),
    }), 200


@app.route("/api/forgot-password", methods=["POST"])
def forgot_password():
    limited = rate_limit_or_429(f"forgot-password:{request.remote_addr}", limit=5, window_seconds=RATE_LIMIT_WINDOW_SECONDS)
    if limited:
        return limited

    try:
        data = json_body()
        email = normalize_email(data.get("email"))

        if not email:
            return jsonify({"error": "Email is required"}), 400

        user = User.query.filter_by(email=email).first()
        if not user:
            return jsonify({"error": "No account found with this email"}), 404

        cooldown_resp = enforce_otp_send_cooldown_or_429(user, "reset_otp_last_sent_at")
        if cooldown_resp:
            return cooldown_resp

        otp_code = generate_otp()
        mark_otp_sent(user, "reset_otp_code", "reset_otp_expiry", "reset_otp_last_sent_at", otp_code)
        user.reset_otp_verified_at = None
        user.reset_otp_attempts = 0

        send_reset_password_email(user.email, otp_code, user.name)
        db.session.commit()

        return jsonify({
            "message": "OTP sent to your email for password reset",
            "email": user.email,
            "otp_sent": True,
        }), 200

    except Exception as exc:
        db.session.rollback()
        logger.exception("Forgot password failed: %s", exc)
        return jsonify({"error": "Forgot password failed"}), 500


@app.route("/api/verify-reset-otp", methods=["POST"])
def verify_reset_otp():
    limited = rate_limit_or_429(f"verify-reset-otp:{request.remote_addr}", limit=8, window_seconds=RATE_LIMIT_WINDOW_SECONDS)
    if limited:
        return limited

    try:
        data = json_body()
        email = normalize_email(data.get("email"))
        otp = normalize_otp(data.get("otp"))

        if not email or not otp:
            return jsonify({"error": "Email and OTP are required"}), 400

        user = User.query.filter_by(email=email).first()
        if not user:
            return jsonify({"error": "User not found"}), 404

        if not user.reset_otp_code or not user.reset_otp_expiry:
            return jsonify({"error": "No reset OTP found. Please request a new OTP."}), 400

        if user.reset_otp_attempts >= OTP_MAX_ATTEMPTS:
            return jsonify({"error": "Too many invalid OTP attempts. Please request a new OTP."}), 429

        if utcnow() > user.reset_otp_expiry:
            reset_reset_otp_state(user)
            db.session.commit()
            return jsonify({"error": "OTP expired. Please request a new OTP."}), 400

        if not check_password_hash(user.reset_otp_code, otp):
            user.reset_otp_attempts += 1
            db.session.commit()
            return jsonify({"error": "Invalid OTP"}), 400

        user.reset_otp_verified_at = utcnow()
        user.reset_otp_attempts = 0
        db.session.commit()

        return jsonify({"message": "OTP verified successfully"}), 200

    except Exception as exc:
        db.session.rollback()
        logger.exception("Verify reset OTP failed: %s", exc)
        return jsonify({"error": "Verify reset OTP failed"}), 500


@app.route("/api/reset-password", methods=["POST"])
def reset_password():
    limited = rate_limit_or_429(f"reset-password:{request.remote_addr}", limit=5, window_seconds=RATE_LIMIT_WINDOW_SECONDS)
    if limited:
        return limited

    try:
        data = json_body()
        email = normalize_email(data.get("email"))
        otp = normalize_otp(data.get("otp"))
        new_password = clean_input(data.get("new_password"), 255)

        if not email or not otp or not new_password:
            return jsonify({"error": "Email, OTP and new password are required"}), 400

        password_error = validate_password_or_400(new_password)
        if password_error:
            return password_error

        user = User.query.filter_by(email=email).first()
        if not user:
            return jsonify({"error": "User not found"}), 404

        if not user.reset_otp_code or not user.reset_otp_expiry:
            return jsonify({"error": "No reset OTP found. Please request a new OTP."}), 400

        if user.reset_otp_attempts >= OTP_MAX_ATTEMPTS:
            return jsonify({"error": "Too many invalid OTP attempts. Please request a new OTP."}), 429

        if utcnow() > user.reset_otp_expiry:
            reset_reset_otp_state(user)
            db.session.commit()
            return jsonify({"error": "OTP expired. Please request a new OTP."}), 400

        if not check_password_hash(user.reset_otp_code, otp):
            user.reset_otp_attempts += 1
            db.session.commit()
            return jsonify({"error": "Invalid OTP"}), 400

        user.password = generate_password_hash(new_password, method="pbkdf2:sha256")
        user.reset_otp_verified_at = utcnow()
        reset_reset_otp_state(user)
        db.session.commit()

        return jsonify({"message": "Password reset successful. You can now log in."}), 200

    except Exception as exc:
        db.session.rollback()
        logger.exception("Reset password failed: %s", exc)
        return jsonify({"error": "Reset password failed"}), 500


# ──────────────────────────────────────────────
# Profile routes
# ──────────────────────────────────────────────
@app.route("/api/profile", methods=["GET"])
@token_required
def get_profile(current_user):
    active_resume = get_active_resume(current_user)
    interviews = Interview.query.filter_by(user_id=current_user.id).all()

    completed_interviews = [
        i for i in interviews if i.completed_at is not None and i.overall_score is not None
    ]
    in_progress_interviews = [i for i in interviews if i.completed_at is None]
    completed_scores = [i.overall_score for i in completed_interviews]

    total = len(interviews)
    completed = len(completed_interviews)
    in_progress = len(in_progress_interviews)
    avg_score = round(sum(completed_scores) / len(completed_scores), 1) if completed_scores else 0

    return jsonify({
        "id": current_user.id,
        "user_id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "is_verified": current_user.is_verified,
        "active_resume": bool(active_resume),
        "active_resume_name": active_resume.filename if active_resume else "",
        "resume_uploaded": bool(active_resume),
        "has_resume": bool(active_resume),
        "resume_name": active_resume.filename if active_resume else "",
        "total_interviews": total,
        "completed_interviews": completed,
        "in_progress_interviews": in_progress,
        "average_score": avg_score,
        "totalInterviews": total,
        "completed": completed,
        "inProgress": in_progress,
        "avgScore": avg_score,
    }), 200


@app.route("/api/profile", methods=["PUT"])
@token_required
def update_profile(current_user):
    try:
        data = json_body()
        name = clean_input(data.get("name"), 100)
        email = normalize_email(data.get("email"))

        if not name or not email:
            return jsonify({"error": "Name and email are required"}), 400

        if not is_valid_email(email):
            return jsonify({"error": "Invalid email format"}), 400

        existing_user = User.query.filter(User.email == email, User.id != current_user.id).first()
        if existing_user:
            return jsonify({"error": "Email is already in use by another account"}), 400

        current_user.name = name
        current_user.email = email
        db.session.commit()

        return jsonify({
            "message": "Profile updated successfully",
            "id": current_user.id,
            "user_id": current_user.id,
            "name": current_user.name,
            "email": current_user.email,
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.exception("Profile update failed: %s", exc)
        return jsonify({"error": "Failed to update profile"}), 500


@app.route("/api/change-password", methods=["PUT"])
@token_required
def change_password(current_user):
    try:
        data = json_body()
        current_password = clean_input(data.get("current_password"), 255)
        new_password = clean_input(data.get("new_password"), 255)

        if not current_password or not new_password:
            return jsonify({"error": "Current password and new password are required"}), 400

        password_error = validate_password_or_400(new_password)
        if password_error:
            return password_error

        if not check_password_hash(current_user.password, current_password):
            return jsonify({"error": "Current password is incorrect"}), 400

        if check_password_hash(current_user.password, new_password):
            return jsonify({"error": "New password must be different from the current password"}), 400

        current_user.password = generate_password_hash(new_password, method="pbkdf2:sha256")
        db.session.commit()

        return jsonify({"message": "Password changed successfully"}), 200
    except Exception as exc:
        db.session.rollback()
        logger.exception("Change password failed: %s", exc)
        return jsonify({"error": "Failed to change password"}), 500


# ──────────────────────────────────────────────
# Resume routes
# ──────────────────────────────────────────────
@app.route("/api/resume/upload", methods=["POST"])
@token_required
def upload_resume(current_user):
    if "resume" not in request.files:
        return jsonify({"error": "No resume file provided"}), 400

    file = request.files["resume"]

    try:
        resume = save_uploaded_resume_for_user(current_user, file)
        analysis = build_resume_analysis(resume.extracted_text or "")

        return jsonify({
            "message": "Resume uploaded successfully",
            "resume": resume.to_dict(),
            "resume_analysis": analysis,
        }), 201
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        logger.exception("Resume upload failed: %s", exc)
        return jsonify({"error": "Failed to upload resume"}), 500


@app.route("/api/resume/active", methods=["GET"])
@token_required
def active_resume_route(current_user):
    resume = get_active_resume(current_user)
    if not resume:
        return jsonify({"resume": None}), 200
    return jsonify({"resume": resume.to_dict()}), 200


# ──────────────────────────────────────────────
# Interview routes
# ──────────────────────────────────────────────
@app.route("/api/generate_questions", methods=["POST", "OPTIONS"])
@app.route("/generate_questions", methods=["POST", "OPTIONS"])
@token_required
def generate_questions_endpoint(current_user):
    if request.method == "OPTIONS":
        return jsonify({"ok": True}), 200

    limited = rate_limit_or_429(f"generate_questions:{current_user.id}", limit=4, window_seconds=RATE_LIMIT_WINDOW_SECONDS)
    if limited:
        return limited

    try:
        form_data = get_request_form_data()
        validation_error = validate_job_inputs(form_data)
        if validation_error:
            return jsonify({"error": validation_error}), 400

        use_existing_resume = form_data["useExistingResume"]
        resume_record = None

        if "resume" in request.files and request.files["resume"].filename:
            resume_record = save_uploaded_resume_for_user(current_user, request.files["resume"])
        elif use_existing_resume:
            resume_record = get_active_resume(current_user)
            if not resume_record:
                return jsonify({"error": "No resume found. Please upload your resume first."}), 400
        else:
            resume_record = get_active_resume(current_user)
            if not resume_record:
                return jsonify({"error": "No resume found. Please upload your resume first."}), 400

        existing_match = find_recent_matching_in_progress_interview(
            current_user=current_user,
            form_data=form_data,
            resume_id=resume_record.id if resume_record else None,
        )

        if existing_match:
            payload = existing_match.to_dict()
            return jsonify({
                "success": True,
                "message": "Reusing existing in-progress interview",
                "interview_id": existing_match.id,
                "interview": payload,
                "interviewData": payload,
                "questions": payload.get("questions", []),
                "currentQuestionIndex": payload.get("currentQuestionIndex", 0),
                "current_question_index": payload.get("current_question_index", 0),
                "answers": payload.get("answers", []),
                "feedback": payload.get("feedback", []),
                "status": payload.get("status", "in_progress"),
                "completed": payload.get("completed", False),
            }), 200

        resume_text = resume_record.extracted_text or ""

        try:
            generated = run_with_timeout(
                generate_questions_with_rag,
                resume_text,
                form_data,
                timeout=AI_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            logger.warning("Falling back to offline question generation: %s", exc)
            generated = fallback_generate_questions(resume_text, form_data)

        questions = generated["questions"]
        interview = Interview(
            user_id=current_user.id,
            resume_id=resume_record.id if resume_record else None,
            job_role=form_data["jobRole"],
            company=form_data["company"],
            question_type=form_data["questionType"],
            experience_level=form_data["experienceLevel"],
            job_description=form_data["jobDescription"],
            company_website=form_data["companyWebsite"],
            questions=json.dumps(questions),
            feedback=json.dumps([]),
            answers=json.dumps(["" for _ in questions]),
            current_question_index=0,
            current_answer="",
            completed_at=None,
        )
        db.session.add(interview)
        db.session.commit()

        payload = interview.to_dict()
        return jsonify({
            "success": True,
            "message": "Questions generated successfully",
            "interview_id": interview.id,
            "interview": payload,
            "interviewData": payload,
            "questions": questions,
            "resume_analysis": generated.get("resume_analysis", {}),
            "currentQuestionIndex": 0,
            "current_question_index": 0,
            "answers": payload.get("answers", []),
            "feedback": payload.get("feedback", []),
            "status": "in_progress",
            "completed": False,
        }), 201

    except Exception as exc:
        db.session.rollback()
        logger.exception("Question generation failed: %s", exc)
        return jsonify({"error": "Failed to generate questions"}), 500


@app.route("/api/interviews", methods=["GET"])
@token_required
def list_interviews(current_user):
    interviews = (
        Interview.query
        .filter_by(user_id=current_user.id)
        .order_by(Interview.started_at.desc())
        .all()
    )
    return jsonify({
        "interviews": [i.to_dict() for i in interviews]
    }), 200


@app.route("/api/interviews/<int:interview_id>", methods=["GET"])
@token_required
def get_interview(current_user, interview_id):
    interview, error_response = get_interview_or_404(current_user, interview_id)
    if error_response:
        return error_response
    return jsonify(interview.to_dict()), 200


@app.route("/api/interviews/current", methods=["GET"])
@token_required
def get_current_interview(current_user):
    interview = (
        Interview.query
        .filter_by(user_id=current_user.id, completed_at=None)
        .order_by(Interview.started_at.desc())
        .first()
    )
    if not interview:
        return jsonify({"interview": None}), 200
    return jsonify({"interview": interview.to_dict()}), 200


@app.route("/api/interviews/<int:interview_id>/progress", methods=["PUT"])
@token_required
def save_interview_progress(current_user, interview_id):
    interview, error_response = get_interview_or_404(current_user, interview_id)
    if error_response:
        return error_response

    try:
        data = json_body()
        answers = data.get("answers", [])
        feedback = data.get("feedback", [])
        current_question_index = safe_int(data.get("currentQuestionIndex", data.get("current_question_index", 0)), 0)
        current_answer = clean_input(data.get("currentAnswer", data.get("current_answer", "")), MAX_TEXT_FIELD_LENGTH)

        existing_answers = parse_answers(interview)
        existing_feedback = parse_feedback(interview)

        merged_answers = merge_answers_lists(existing_answers, answers)
        merged_feedback = merge_feedback_lists(existing_feedback, feedback)

        save_answers(interview, merged_answers)
        save_feedback(interview, merged_feedback)
        interview.current_question_index = max(0, current_question_index)
        interview.current_answer = current_answer

        db.session.commit()

        return jsonify({
            "message": "Interview progress saved",
            "interview": interview.to_dict(),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.exception("Saving interview progress failed: %s", exc)
        return jsonify({"error": "Failed to save interview progress"}), 500


@app.route("/api/interviews/<int:interview_id>/answer", methods=["POST"])
@token_required
def submit_interview_answer(current_user, interview_id):
    interview, error_response = get_interview_or_404(current_user, interview_id)
    if error_response:
        return error_response

    try:
        data = json_body()
        answer_text = clean_input(data.get("answer"), MAX_TEXT_FIELD_LENGTH)
        question_index = safe_int(data.get("question_index", data.get("currentQuestionIndex", interview.current_question_index)), interview.current_question_index)

        questions, idx = current_question_for_interview(interview)
        if not questions:
            return jsonify({"error": "No questions found for this interview"}), 400

        question_index = max(0, min(question_index, len(questions) - 1))
        question_text = questions[question_index].get("question", "")

        answers = parse_answers(interview)
        feedback_list = parse_feedback(interview)

        while len(answers) < len(questions):
            answers.append("")
        while len(feedback_list) < len(questions):
            feedback_list.append(None)

        answers[question_index] = answer_text

        if answer_text.strip():
            try:
                feedback_item = run_with_timeout(
                    analyze_answer_with_gemini,
                    question_text,
                    answer_text,
                    timeout=AI_TIMEOUT_SECONDS,
                )
            except Exception as exc:
                logger.warning("Falling back to offline feedback: %s", exc)
                feedback_item = fallback_analyze_answer(question_text, answer_text)
        else:
            feedback_item = None

        feedback_list[question_index] = feedback_item
        save_answers(interview, answers)
        save_feedback(interview, feedback_list)

        next_index = min(question_index + 1, len(questions) - 1)
        interview.current_question_index = next_index
        interview.current_answer = ""

        db.session.commit()

        return jsonify({
            "message": "Answer submitted successfully",
            "feedback": feedback_item,
            "answers": answers,
            "all_feedback": feedback_list,
            "currentQuestionIndex": interview.current_question_index,
            "current_question_index": interview.current_question_index,
            "interview": interview.to_dict(),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.exception("Submitting answer failed: %s", exc)
        return jsonify({"error": "Failed to submit answer"}), 500


@app.route("/api/interviews/<int:interview_id>/complete", methods=["POST"])
@token_required
def complete_interview(current_user, interview_id):
    interview, error_response = get_interview_or_404(current_user, interview_id)
    if error_response:
        return error_response

    try:
        data = json_body()
        incoming_answers = data.get("answers", [])
        incoming_feedback = data.get("feedback", [])

        questions = parse_questions(interview)
        existing_answers = parse_answers(interview)
        existing_feedback = parse_feedback(interview)

        merged_answers = merge_answers_lists(existing_answers, incoming_answers)
        merged_feedback = merge_feedback_lists(existing_feedback, incoming_feedback)

        save_answers(interview, merged_answers)
        save_feedback(interview, merged_feedback)

        interview.overall_score = calculate_final_score_from_feedback(merged_feedback, question_count=len(questions))
        interview.completed_at = utcnow()
        interview.current_answer = ""
        interview.current_question_index = len(questions) - 1 if questions else 0

        db.session.commit()

        return jsonify({
            "message": "Interview completed successfully",
            "final_score": interview.overall_score,
            "overall_score": interview.overall_score,
            "interview": interview.to_dict(),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.exception("Completing interview failed: %s", exc)
        return jsonify({"error": "Failed to complete interview"}), 500


@app.route("/api/interviews/<int:interview_id>/restart", methods=["POST"])
@token_required
def restart_interview(current_user, interview_id):
    interview, error_response = get_interview_or_404(current_user, interview_id)
    if error_response:
        return error_response

    try:
        questions = parse_questions(interview)
        restarted = Interview(
            user_id=current_user.id,
            resume_id=interview.resume_id,
            job_role=interview.job_role,
            company=interview.company,
            question_type=interview.question_type,
            experience_level=interview.experience_level,
            job_description=interview.job_description,
            company_website=interview.company_website,
            questions=json.dumps(questions),
            feedback=json.dumps([]),
            answers=json.dumps(["" for _ in questions]),
            current_question_index=0,
            current_answer="",
            completed_at=None,
            overall_score=None,
        )
        db.session.add(restarted)
        db.session.commit()

        return jsonify({
            "message": "Interview restarted successfully",
            "interview": restarted.to_dict(),
        }), 201
    except Exception as exc:
        db.session.rollback()
        logger.exception("Restart interview failed: %s", exc)
        return jsonify({"error": "Failed to restart interview"}), 500


# ──────────────────────────────────────────────
# Live analysis routes
# ──────────────────────────────────────────────
@app.route("/api/analysis/reset", methods=["POST"])
@token_required
def reset_analysis(current_user):
    reset_user_analyzer(current_user.id)
    return jsonify({"message": "Analysis reset", "metrics": default_metrics()}), 200


@app.route("/api/analysis/metrics", methods=["GET"])
@token_required
def get_analysis_metrics(current_user):
    with analysis_lock:
        metrics = latest_metrics_by_user.get(current_user.id, default_metrics())
    return jsonify(metrics), 200


@app.route("/api/analysis/frame", methods=["POST"])
@token_required
def analyze_frame(current_user):
    try:
        if "frame" not in request.files:
            return jsonify({"error": "Frame file is required"}), 400

        file = request.files["frame"]
        image_bytes = np.frombuffer(file.read(), np.uint8)
        frame = cv2.imdecode(image_bytes, cv2.IMREAD_COLOR)

        if frame is None:
            return jsonify({"error": "Invalid frame"}), 400

        try:
            frame_queue.put_nowait((current_user.id, frame))
        except queue.Full:
            pass

        with analysis_lock:
            metrics = latest_metrics_by_user.get(current_user.id, default_metrics())

        return jsonify(metrics), 200
    except Exception as exc:
        logger.exception("Frame analysis failed: %s", exc)
        return jsonify({"error": "Failed to analyze frame"}), 500


# ──────────────────────────────────────────────
# Socket.IO
# ──────────────────────────────────────────────
@socketio.on("connect")
def on_connect():
    emit("connected", {"message": "Socket connected"})


@socketio.on("disconnect")
def on_disconnect():
    pass


# ──────────────────────────────────────────────
# Startup
# ──────────────────────────────────────────────
with app.app_context():
    db.create_all()

if JOB_ENGINE_AUTOSTART:
    start_jobs_engine_background()


if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=safe_int(os.getenv("PORT", 5000), 5000),
        debug=parse_bool(os.getenv("FLASK_DEBUG", "true")),
    )