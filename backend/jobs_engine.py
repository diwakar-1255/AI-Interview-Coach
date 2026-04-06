import os
import re
import smtplib
import ssl
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from urllib.parse import urlparse

import psycopg2
import psycopg2.extras
import requests


# ─────────────────────────────────────────────
# ENVIRONMENT
# ─────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL")
ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY")

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
MAIL_FROM = os.getenv("MAIL_FROM", SMTP_USER or "no-reply@example.com")

ADZUNA_COUNTRY = os.getenv("ADZUNA_COUNTRY", "in")
JOBS_RESULTS_PER_PAGE = int(os.getenv("JOBS_RESULTS_PER_PAGE", "50"))
JOBS_MAX_PAGES = int(os.getenv("JOBS_MAX_PAGES", "4"))
DEFAULT_JOB_QUERY = os.getenv("DEFAULT_JOB_QUERY", "").strip()
JOB_MAX_AGE_DAYS = int(os.getenv("JOB_MAX_AGE_DAYS", "30"))
REQUEST_TIMEOUT = int(os.getenv("JOB_REQUEST_TIMEOUT", "20"))

MAX_JOBS_PER_EMAIL = int(os.getenv("MAX_JOBS_PER_EMAIL", "5"))
MIN_MATCH_SCORE = float(os.getenv("MIN_MATCH_SCORE", "40"))


# ─────────────────────────────────────────────
# BROAD QUERY COVERAGE
# ─────────────────────────────────────────────
JOB_QUERY_LIST = [
    "software developer",
    "backend developer",
    "frontend developer",
    "full stack developer",
    "python developer",
    "java developer",
    "react developer",
    "node js developer",
    "data analyst",
    "data scientist",
    "machine learning engineer",
    "artificial intelligence engineer",
    "devops engineer",
    "cloud engineer",
    "cyber security analyst",
    "network engineer",
    "qa engineer",
    "test engineer",
    "product manager",
    "business analyst",
    "ui ux designer",
    "mobile app developer",
    "android developer",
    "ios developer",
    "mechanical engineer",
    "electrical engineer",
    "electronics engineer",
    "civil engineer",
    "automobile engineer",
    "embedded engineer",
    "accountant",
    "sales executive",
    "marketing executive",
    "hr executive",
    "customer support",
    "operations executive",
]

JOB_LOCATION_LIST = [
    "",
    "Bangalore",
    "Hyderabad",
    "Chennai",
    "Pune",
    "Mumbai",
    "Delhi",
    "Noida",
    "Gurgaon",
    "Kolkata",
    "Remote",
]


# ─────────────────────────────────────────────
# DB HELPERS
# ─────────────────────────────────────────────
def get_db():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set.")
    return psycopg2.connect(DATABASE_URL)


def init_db():
    conn = get_db()
    try:
        cur = conn.cursor()

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS stored_jobs (
                id SERIAL PRIMARY KEY,
                source VARCHAR(100) NOT NULL DEFAULT 'adzuna',
                external_id VARCHAR(255),
                title VARCHAR(255) NOT NULL,
                company VARCHAR(255) NOT NULL,
                location VARCHAR(255),
                description TEXT,
                apply_link TEXT NOT NULL UNIQUE,
                posted_date TIMESTAMP NULL,
                apply_deadline TIMESTAMP NULL,
                status VARCHAR(50) NOT NULL DEFAULT 'active',
                salary_min DOUBLE PRECISION NULL,
                salary_max DOUBLE PRECISION NULL,
                category VARCHAR(255) NULL,
                query_text VARCHAR(255) NULL,
                location_query VARCHAR(255) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS job_notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                job_id INTEGER NOT NULL REFERENCES stored_jobs(id) ON DELETE CASCADE,
                sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
                match_score DOUBLE PRECISION NULL,
                notification_type VARCHAR(50) NULL DEFAULT 'single_job',
                UNIQUE(user_id, job_id)
            )
            """
        )

        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_stored_jobs_status
            ON stored_jobs(status)
            """
        )

        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_stored_jobs_posted_date
            ON stored_jobs(posted_date DESC)
            """
        )

        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_stored_jobs_company
            ON stored_jobs(company)
            """
        )

        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_stored_jobs_title
            ON stored_jobs(title)
            """
        )

        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_stored_jobs_location
            ON stored_jobs(location)
            """
        )

        conn.commit()
    finally:
        conn.close()


# ─────────────────────────────────────────────
# GENERIC HELPERS
# ─────────────────────────────────────────────
def safe_str(value, default=""):
    if value is None:
        return default
    return str(value).strip()


def safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def is_valid_http_url(value):
    if not value:
        return False
    try:
        parsed = urlparse(value)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def safe_datetime_from_iso(value):
    if not value:
        return None

    text = safe_str(value)
    if not text:
        return None

    try:
        text = text.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone().replace(tzinfo=None)
        return parsed
    except Exception:
        return None


def normalize_text_for_search(value):
    return safe_str(value).lower()


def normalize_text(value):
    text = safe_str(value).lower()
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_skills_string(skills_value):
    if not skills_value:
        return []

    if isinstance(skills_value, list):
        items = skills_value
    else:
        items = re.split(r"[,;\n|]+", safe_str(skills_value))

    cleaned = []
    seen = set()

    for item in items:
        skill = re.sub(r"\s+", " ", safe_str(item)).strip(" -•,:")
        if len(skill) < 2:
            continue
        lowered = skill.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        cleaned.append(skill)

    return cleaned


def extract_resume_skills_from_text(parsed_text):
    text = safe_str(parsed_text)
    if not text:
        return []

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    skills = []
    capture = False

    section_headers = {
        "skills",
        "technical skills",
        "key skills",
        "core skills",
        "core competencies",
        "technologies",
        "tools",
        "tech stack",
        "skills & abilities",
    }

    for line in lines:
        lowered = line.lower().rstrip(":").strip()

        if lowered in section_headers:
            capture = True
            continue

        if capture:
            if len(line.split()) > 20:
                break

            if ":" in line and len(line.split()) <= 8:
                break

            parts = re.split(r"[,|/•]+", line)
            line_skills = [p.strip(" -•,:") for p in parts if p.strip(" -•,:")]

            if not line_skills:
                break

            skills.extend(line_skills)

            if len(skills) >= 50:
                break

    # Fallback: extract likely skill phrases from whole text if section not found
    if not skills:
        possible = re.findall(r"[A-Za-z][A-Za-z0-9+#./ -]{1,40}", text)
        for token in possible:
            token = re.sub(r"\s+", " ", token).strip(" -•,:")
            if not token:
                continue
            if len(token) < 2 or len(token) > 35:
                continue
            if token.lower() in {
                "resume", "education", "experience", "projects", "summary",
                "objective", "contact", "name", "email", "phone"
            }:
                continue
            if any(ch.isdigit() for ch in token) and len(token.split()) > 4:
                continue
            skills.append(token)

    final_skills = []
    seen = set()
    for skill in skills:
        cleaned = re.sub(r"\s+", " ", safe_str(skill)).strip(" -•,:")
        if len(cleaned) < 2:
            continue
        lowered = cleaned.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        final_skills.append(cleaned)

    return final_skills[:60]


def format_email_date(value):
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y")
    return "Not specified"


# ─────────────────────────────────────────────
# SEARCH CONFIG
# ─────────────────────────────────────────────
def get_search_queries(custom_query=None):
    cleaned = safe_str(custom_query)
    if cleaned:
        return [cleaned]

    if DEFAULT_JOB_QUERY:
        return [DEFAULT_JOB_QUERY]

    return JOB_QUERY_LIST


def get_search_locations(custom_location=None):
    cleaned = safe_str(custom_location)
    if cleaned:
        return [cleaned]
    return JOB_LOCATION_LIST


# ─────────────────────────────────────────────
# FETCHING FROM ADZUNA
# ─────────────────────────────────────────────
def fetch_jobs_for_query(query, location=None, pages=None):
    if not ADZUNA_APP_ID or not ADZUNA_APP_KEY:
        raise RuntimeError("ADZUNA_APP_ID or ADZUNA_APP_KEY is missing.")

    total_pages = pages or JOBS_MAX_PAGES
    total_pages = max(1, min(total_pages, JOBS_MAX_PAGES))
    all_jobs = []

    for page in range(1, total_pages + 1):
        url = f"https://api.adzuna.com/v1/api/jobs/{ADZUNA_COUNTRY}/search/{page}"
        params = {
            "app_id": ADZUNA_APP_ID,
            "app_key": ADZUNA_APP_KEY,
            "results_per_page": JOBS_RESULTS_PER_PAGE,
            "what": safe_str(query),
            "content-type": "application/json",
        }

        if location:
            params["where"] = safe_str(location)

        try:
            response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            payload = response.json()
            results = payload.get("results", [])

            if isinstance(results, list):
                for item in results:
                    if isinstance(item, dict):
                        item["_search_query"] = safe_str(query)
                        item["_search_location"] = safe_str(location)
                        all_jobs.append(item)
        except Exception as exc:
            print(
                f"Error fetching jobs for query='{query}', location='{location}', page={page}: {exc}"
            )

    return all_jobs


def fetch_jobs(query=None, location=None, pages=None):
    queries = get_search_queries(query)
    locations = get_search_locations(location)

    all_jobs = []
    seen_links = set()

    for current_query in queries:
        for current_location in locations:
            raw_jobs = fetch_jobs_for_query(
                query=current_query,
                location=current_location,
                pages=pages,
            )

            for raw_job in raw_jobs:
                apply_link = safe_str(raw_job.get("redirect_url"))
                if not is_valid_http_url(apply_link):
                    continue
                if apply_link in seen_links:
                    continue
                seen_links.add(apply_link)
                all_jobs.append(raw_job)

    return all_jobs


# ─────────────────────────────────────────────
# NORMALIZATION
# ─────────────────────────────────────────────
def normalize_job(raw_job):
    company = raw_job.get("company") or {}
    location = raw_job.get("location") or {}
    category = raw_job.get("category") or {}

    apply_link = safe_str(raw_job.get("redirect_url"))
    if not is_valid_http_url(apply_link):
        return None

    external_id = safe_str(
        raw_job.get("id") or raw_job.get("__CLASS__") or raw_job.get("adref")
    )

    title = safe_str(raw_job.get("title")) or "Untitled Job"
    company_name = safe_str(company.get("display_name")) or "Unknown Company"
    location_name = safe_str(location.get("display_name")) or "Location not specified"
    description = safe_str(raw_job.get("description"))
    posted_date = safe_datetime_from_iso(raw_job.get("created"))

    # Adzuna often does not provide deadline. Check multiple possible keys.
    deadline_raw = (
        raw_job.get("apply_deadline")
        or raw_job.get("expiration_date")
        or raw_job.get("expires")
        or raw_job.get("closing_date")
    )
    apply_deadline = safe_datetime_from_iso(deadline_raw)

    category_label = safe_str(category.get("label"))
    salary_min = raw_job.get("salary_min")
    salary_max = raw_job.get("salary_max")
    query_text = safe_str(raw_job.get("_search_query"))
    location_query = safe_str(raw_job.get("_search_location"))

    extra_parts = []
    if category_label:
        extra_parts.append(f"Category: {category_label}")
    if salary_min or salary_max:
        extra_parts.append(f"Salary: {salary_min or 'N/A'} - {salary_max or 'N/A'}")

    if description and extra_parts:
        description = f"{description}\n\n" + " | ".join(extra_parts)
    elif not description and extra_parts:
        description = " | ".join(extra_parts)

    return {
        "source": "adzuna",
        "external_id": external_id or None,
        "title": title[:255],
        "company": company_name[:255],
        "location": location_name[:255],
        "description": description,
        "apply_link": apply_link,
        "posted_date": posted_date,
        "apply_deadline": apply_deadline,
        "status": "active",
        "salary_min": salary_min,
        "salary_max": salary_max,
        "category": category_label,
        "query_text": query_text[:255] if query_text else None,
        "location_query": location_query[:255] if location_query else None,
    }


def serialize_job_for_api(job):
    if not job:
        return None

    description = safe_str(job.get("description"))
    if len(description) > 1000:
        description = description[:1000].strip() + "..."

    posted_date = job.get("posted_date")
    if isinstance(posted_date, datetime):
        posted_date = posted_date.isoformat()

    apply_deadline = job.get("apply_deadline")
    if isinstance(apply_deadline, datetime):
        apply_deadline = apply_deadline.isoformat()

    return {
        "id": job.get("external_id") or job.get("apply_link") or job.get("id"),
        "title": safe_str(job.get("title")),
        "company": safe_str(job.get("company")),
        "location": safe_str(job.get("location")),
        "description": description,
        "apply_link": safe_str(job.get("apply_link")),
        "posted_date": posted_date,
        "apply_deadline": apply_deadline,
        "source": safe_str(job.get("source") or "adzuna"),
        "salary_min": job.get("salary_min"),
        "salary_max": job.get("salary_max"),
        "category": safe_str(job.get("category")),
        "status": safe_str(job.get("status") or "active"),
    }


# ─────────────────────────────────────────────
# READ JOBS FOR API
# ─────────────────────────────────────────────
def get_jobs(query=None, location=None, page=1):
    init_db()
    page = max(1, safe_int(page, 1))
    per_page = JOBS_RESULTS_PER_PAGE
    offset = (page - 1) * per_page

    cleaned_query = normalize_text_for_search(query)
    cleaned_location = normalize_text_for_search(location)

    conn = get_db()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        where_clauses = ["status = 'active'"]
        params = []

        fresh_cutoff = datetime.utcnow() - timedelta(days=JOB_MAX_AGE_DAYS)
        where_clauses.append("(posted_date IS NULL OR posted_date >= %s)")
        params.append(fresh_cutoff)

        if cleaned_query:
            where_clauses.append(
                """(
                    LOWER(title) LIKE %s OR
                    LOWER(company) LIKE %s OR
                    LOWER(description) LIKE %s OR
                    LOWER(COALESCE(query_text, '')) LIKE %s OR
                    LOWER(COALESCE(category, '')) LIKE %s
                )"""
            )
            like = f"%{cleaned_query}%"
            params.extend([like, like, like, like, like])

        if cleaned_location:
            where_clauses.append(
                """(
                    LOWER(location) LIKE %s OR
                    LOWER(COALESCE(location_query, '')) LIKE %s
                )"""
            )
            like_loc = f"%{cleaned_location}%"
            params.extend([like_loc, like_loc])

        sql = f"""
            SELECT
                id, source, external_id, title, company, location,
                description, apply_link, posted_date, apply_deadline,
                status, salary_min, salary_max, category
            FROM stored_jobs
            WHERE {' AND '.join(where_clauses)}
            ORDER BY COALESCE(posted_date, created_at) DESC, id DESC
            LIMIT %s OFFSET %s
        """
        params.extend([per_page, offset])
        cur.execute(sql, params)
        rows = cur.fetchall()

        if rows:
            return [serialize_job_for_api(dict(row)) for row in rows]

    finally:
        conn.close()

    raw_jobs = fetch_jobs_for_query(
        query=query or DEFAULT_JOB_QUERY or "software developer",
        location=location,
        pages=page
    )

    normalized_jobs = []
    seen_links = set()
    freshness_cutoff = datetime.utcnow() - timedelta(days=JOB_MAX_AGE_DAYS)

    for raw in raw_jobs:
        normalized = normalize_job(raw)
        if not normalized:
            continue

        apply_link = normalized["apply_link"]
        if apply_link in seen_links:
            continue
        seen_links.add(apply_link)

        posted_date = normalized.get("posted_date")
        if posted_date and posted_date < freshness_cutoff:
            continue

        normalized_jobs.append(normalized)

    normalized_jobs.sort(
        key=lambda x: (
            x.get("posted_date") is not None,
            x.get("posted_date") or datetime.min
        ),
        reverse=True,
    )

    return [serialize_job_for_api(job) for job in normalized_jobs[:per_page]]


# ─────────────────────────────────────────────
# UPSERT LOGIC
# ─────────────────────────────────────────────
def get_existing_job_by_apply_link(cur, apply_link):
    cur.execute(
        """
        SELECT id, status
        FROM stored_jobs
        WHERE apply_link = %s
        LIMIT 1
        """,
        (apply_link,),
    )
    return cur.fetchone()


def insert_or_update_jobs(raw_jobs):
    normalized_jobs = []
    for raw in raw_jobs:
        normalized = normalize_job(raw)
        if normalized:
            normalized_jobs.append(normalized)

    inserted_job_ids = []
    updated_job_ids = []

    if not normalized_jobs:
        return {
            "inserted_job_ids": inserted_job_ids,
            "updated_job_ids": updated_job_ids,
            "processed_count": 0,
        }

    conn = get_db()
    try:
        cur = conn.cursor()

        for job in normalized_jobs:
            existing = get_existing_job_by_apply_link(cur, job["apply_link"])

            if existing:
                job_id = existing[0]
                cur.execute(
                    """
                    UPDATE stored_jobs
                    SET
                        source = %s,
                        external_id = %s,
                        title = %s,
                        company = %s,
                        location = %s,
                        description = %s,
                        posted_date = COALESCE(%s, posted_date),
                        apply_deadline = COALESCE(%s, apply_deadline),
                        status = %s,
                        salary_min = %s,
                        salary_max = %s,
                        category = %s,
                        query_text = COALESCE(%s, query_text),
                        location_query = COALESCE(%s, location_query),
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        job["source"],
                        job["external_id"],
                        job["title"],
                        job["company"],
                        job["location"],
                        job["description"],
                        job["posted_date"],
                        job["apply_deadline"],
                        "active",
                        job["salary_min"],
                        job["salary_max"],
                        job["category"],
                        job["query_text"],
                        job["location_query"],
                        job_id,
                    ),
                )
                updated_job_ids.append(job_id)
            else:
                cur.execute(
                    """
                    INSERT INTO stored_jobs (
                        source,
                        external_id,
                        title,
                        company,
                        location,
                        description,
                        apply_link,
                        posted_date,
                        apply_deadline,
                        status,
                        salary_min,
                        salary_max,
                        category,
                        query_text,
                        location_query,
                        created_at,
                        updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id
                    """,
                    (
                        job["source"],
                        job["external_id"],
                        job["title"],
                        job["company"],
                        job["location"],
                        job["description"],
                        job["apply_link"],
                        job["posted_date"],
                        job["apply_deadline"],
                        job["status"],
                        job["salary_min"],
                        job["salary_max"],
                        job["category"],
                        job["query_text"],
                        job["location_query"],
                    ),
                )
                new_id = cur.fetchone()[0]
                inserted_job_ids.append(new_id)

        conn.commit()

        return {
            "inserted_job_ids": inserted_job_ids,
            "updated_job_ids": updated_job_ids,
            "processed_count": len(normalized_jobs),
        }
    finally:
        conn.close()


# ─────────────────────────────────────────────
# CLEANUP
# ─────────────────────────────────────────────
def cleanup_expired_jobs():
    conn = get_db()
    try:
        cur = conn.cursor()

        cur.execute(
            """
            UPDATE stored_jobs
            SET status = 'expired',
                updated_at = NOW()
            WHERE status = 'active'
              AND (
                    (apply_deadline IS NOT NULL AND apply_deadline < NOW())
                    OR
                    (apply_deadline IS NULL AND posted_date IS NOT NULL AND posted_date < NOW() - (%s || ' days')::interval)
                    OR
                    (apply_deadline IS NULL AND posted_date IS NULL AND created_at < NOW() - (%s || ' days')::interval)
                  )
            """,
            (JOB_MAX_AGE_DAYS, JOB_MAX_AGE_DAYS),
        )

        expired_count = cur.rowcount
        conn.commit()
        return expired_count
    finally:
        conn.close()


# ─────────────────────────────────────────────
# USER / RESUME HELPERS
# ─────────────────────────────────────────────
def get_notification_users():
    conn = get_db()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        try:
            cur.execute(
                """
                SELECT id, name, email
                FROM users
                WHERE COALESCE(job_alerts_enabled, TRUE) = TRUE
                  AND COALESCE(is_verified, FALSE) = TRUE
                  AND email IS NOT NULL
                  AND TRIM(email) <> ''
                ORDER BY id ASC
                """
            )
        except Exception:
            conn.rollback()
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                """
                SELECT id, name, email
                FROM users
                WHERE COALESCE(is_verified, FALSE) = TRUE
                  AND email IS NOT NULL
                  AND TRIM(email) <> ''
                ORDER BY id ASC
                """
            )

        return cur.fetchall()
    finally:
        conn.close()


def get_user_resume_profile(user_id):
    conn = get_db()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT id, user_id, filename, parsed_text, extracted_skills
            FROM resumes
            WHERE user_id = %s
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return None

        extracted_skills = parse_skills_string(row.get("extracted_skills"))
        if not extracted_skills:
            extracted_skills = extract_resume_skills_from_text(row.get("parsed_text"))

        return {
            "resume_id": row.get("id"),
            "user_id": row.get("user_id"),
            "filename": row.get("filename"),
            "parsed_text": safe_str(row.get("parsed_text")),
            "skills": extracted_skills,
        }
    finally:
        conn.close()


def get_all_active_jobs():
    conn = get_db()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT id, title, company, location, description, apply_link,
                   posted_date, apply_deadline, source, status, category, created_at
            FROM stored_jobs
            WHERE status = 'active'
            ORDER BY COALESCE(posted_date, created_at) DESC, id DESC
            """
        )
        return cur.fetchall()
    finally:
        conn.close()


def get_jobs_by_ids(job_ids):
    if not job_ids:
        return []

    conn = get_db()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT id, title, company, location, description, apply_link,
                   posted_date, apply_deadline, source, status, category, created_at
            FROM stored_jobs
            WHERE id = ANY(%s)
              AND status = 'active'
            ORDER BY COALESCE(posted_date, created_at) DESC, id DESC
            """,
            (job_ids,),
        )
        return cur.fetchall()
    finally:
        conn.close()


def notification_exists(user_id, job_id):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT 1
            FROM job_notifications
            WHERE user_id = %s AND job_id = %s
            LIMIT 1
            """,
            (user_id, job_id),
        )
        return cur.fetchone() is not None
    finally:
        conn.close()


def record_job_notifications(user_id, job_ids, match_scores=None, notification_type="single_job"):
    if not job_ids:
        return

    match_scores = match_scores or {}

    conn = get_db()
    try:
        cur = conn.cursor()
        for job_id in job_ids:
            cur.execute(
                """
                INSERT INTO job_notifications (user_id, job_id, sent_at, match_score, notification_type)
                VALUES (%s, %s, NOW(), %s, %s)
                ON CONFLICT (user_id, job_id) DO NOTHING
                """,
                (
                    user_id,
                    job_id,
                    match_scores.get(job_id),
                    notification_type,
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ─────────────────────────────────────────────
# MATCHING LOGIC
# ─────────────────────────────────────────────
def compute_match_score(skills, parsed_text, job):
    user_skills = parse_skills_string(skills) if not isinstance(skills, list) else skills
    user_skills = [safe_str(skill) for skill in user_skills if safe_str(skill)]

    if not user_skills and not safe_str(parsed_text):
        return 0.0, []

    job_text = normalize_text(
        " ".join(
            [
                safe_str(job.get("title")),
                safe_str(job.get("company")),
                safe_str(job.get("location")),
                safe_str(job.get("description")),
                safe_str(job.get("category")),
            ]
        )
    )

    matched_skills = []
    for skill in user_skills:
        skill_text = normalize_text(skill)
        if skill_text and skill_text in job_text:
            matched_skills.append(skill)

    skill_score = 0.0
    if user_skills:
        skill_score = (len(matched_skills) / len(user_skills)) * 100

    parsed_text_normalized = normalize_text(parsed_text)
    title_words = set(normalize_text(job.get("title")).split())
    parsed_words = set(parsed_text_normalized.split())

    title_bonus = 0.0
    if title_words and parsed_words:
        overlap = len(title_words & parsed_words)
        title_bonus = min(overlap * 5.0, 20.0)

    final_score = min(skill_score + title_bonus, 100.0)
    return round(final_score, 2), matched_skills


# ─────────────────────────────────────────────
# EMAIL BUILDERS
# ─────────────────────────────────────────────
def build_single_job_email_html(user_name, job, match_score, matched_skills):
    greeting_name = safe_str(user_name) or "there"
    title = safe_str(job.get("title")) or "Untitled Job"
    company = safe_str(job.get("company")) or "Unknown Company"
    location = safe_str(job.get("location")) or "Location not specified"
    apply_link = safe_str(job.get("apply_link"))
    posted_text = format_email_date(job.get("posted_date"))
    deadline_text = format_email_date(job.get("apply_deadline"))
    description = safe_str(job.get("description"))
    if len(description) > 320:
        description = f"{description[:320].strip()}..."

    matched_skills_text = ", ".join(matched_skills) if matched_skills else "Relevant skills found from your resume"

    return f"""
    <html>
      <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;">
        <div style="max-width:760px;margin:0 auto;background:#ffffff;border-radius:18px;padding:28px;border:1px solid #e5e7eb;">
          <h1 style="margin-top:0;color:#111827;">A New Job Matches Your Resume</h1>
          <p style="color:#374151;line-height:1.7;">Hi {greeting_name},</p>
          <p style="color:#374151;line-height:1.7;">
            A newly fetched job matches your resume based on the skills and role alignment in your profile.
          </p>

          <div style="border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-top:16px;background:#ffffff;">
            <h3 style="margin:0 0 8px;color:#111827;font-size:18px;">{title}</h3>
            <p style="margin:4px 0;color:#374151;"><strong>Company:</strong> {company}</p>
            <p style="margin:4px 0;color:#374151;"><strong>Location:</strong> {location}</p>
            <p style="margin:4px 0;color:#374151;"><strong>Match Score:</strong> {match_score}%</p>
            <p style="margin:4px 0;color:#374151;"><strong>Matched Skills:</strong> {matched_skills_text}</p>
            <p style="margin:4px 0;color:#374151;"><strong>Posted:</strong> {posted_text}</p>
            <p style="margin:4px 0 10px;color:#374151;"><strong>Deadline:</strong> {deadline_text}</p>
            <p style="margin:0 0 14px;color:#4b5563;line-height:1.6;">{description or 'No description available.'}</p>
            <a href="{apply_link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:700;">
              Apply Now
            </a>
          </div>

          <p style="color:#6b7280;line-height:1.7;margin-top:20px;">
            This is an automated job alert from AI Interview Coach.
          </p>
        </div>
      </body>
    </html>
    """


def build_single_job_email_text(user_name, job, match_score, matched_skills):
    greeting_name = safe_str(user_name) or "there"
    title = safe_str(job.get("title")) or "Untitled Job"
    company = safe_str(job.get("company")) or "Unknown Company"
    location = safe_str(job.get("location")) or "Location not specified"
    apply_link = safe_str(job.get("apply_link"))
    posted_text = format_email_date(job.get("posted_date"))
    deadline_text = format_email_date(job.get("apply_deadline"))
    matched_skills_text = ", ".join(matched_skills) if matched_skills else "Relevant skills found from your resume"

    return "\n".join(
        [
            f"Hi {greeting_name},",
            "",
            "A newly fetched job matches your resume.",
            "",
            f"Job Title: {title}",
            f"Company: {company}",
            f"Location: {location}",
            f"Match Score: {match_score}%",
            f"Matched Skills: {matched_skills_text}",
            f"Posted: {posted_text}",
            f"Deadline: {deadline_text}",
            f"Apply: {apply_link}",
            "",
            "This is an automated job alert from AI Interview Coach.",
        ]
    )


def build_top_jobs_email_html(user_name, jobs_with_scores):
    greeting_name = safe_str(user_name) or "there"
    job_items = []

    for item in jobs_with_scores:
        job = item["job"]
        score = item["score"]
        matched_skills = item.get("matched_skills", [])

        title = safe_str(job.get("title")) or "Untitled Job"
        company = safe_str(job.get("company")) or "Unknown Company"
        location = safe_str(job.get("location")) or "Location not specified"
        apply_link = safe_str(job.get("apply_link"))
        posted_text = format_email_date(job.get("posted_date"))
        deadline_text = format_email_date(job.get("apply_deadline"))
        description = safe_str(job.get("description"))
        if len(description) > 240:
            description = f"{description[:240].strip()}..."

        matched_skills_text = ", ".join(matched_skills) if matched_skills else "Relevant skills found from your resume"

        job_items.append(
            f"""
            <div style="border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-bottom:14px;background:#ffffff;">
              <h3 style="margin:0 0 8px;color:#111827;font-size:18px;">{title}</h3>
              <p style="margin:4px 0;color:#374151;"><strong>Company:</strong> {company}</p>
              <p style="margin:4px 0;color:#374151;"><strong>Location:</strong> {location}</p>
              <p style="margin:4px 0;color:#374151;"><strong>Match Score:</strong> {score}%</p>
              <p style="margin:4px 0;color:#374151;"><strong>Matched Skills:</strong> {matched_skills_text}</p>
              <p style="margin:4px 0;color:#374151;"><strong>Posted:</strong> {posted_text}</p>
              <p style="margin:4px 0 10px;color:#374151;"><strong>Deadline:</strong> {deadline_text}</p>
              <p style="margin:0 0 14px;color:#4b5563;line-height:1.6;">{description or 'No description available.'}</p>
              <a href="{apply_link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:700;">
                Apply Now
              </a>
            </div>
            """
        )

    jobs_html = "\n".join(job_items)

    return f"""
    <html>
      <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,sans-serif;">
        <div style="max-width:760px;margin:0 auto;background:#ffffff;border-radius:18px;padding:28px;border:1px solid #e5e7eb;">
          <h1 style="margin-top:0;color:#111827;">Top Jobs Matching Your Resume</h1>
          <p style="color:#374151;line-height:1.7;">Hi {greeting_name},</p>
          <p style="color:#374151;line-height:1.7;">
            We analyzed your resume and found these top matching jobs from our database.
          </p>
          {jobs_html}
          <p style="color:#6b7280;line-height:1.7;margin-top:20px;">
            This is an automated job alert from AI Interview Coach.
          </p>
        </div>
      </body>
    </html>
    """


def build_top_jobs_email_text(user_name, jobs_with_scores):
    greeting_name = safe_str(user_name) or "there"
    lines = [
        f"Hi {greeting_name},",
        "",
        "We analyzed your resume and found these top matching jobs:",
        "",
    ]

    for idx, item in enumerate(jobs_with_scores, start=1):
        job = item["job"]
        score = item["score"]
        matched_skills = item.get("matched_skills", [])

        title = safe_str(job.get("title")) or "Untitled Job"
        company = safe_str(job.get("company")) or "Unknown Company"
        location = safe_str(job.get("location")) or "Location not specified"
        apply_link = safe_str(job.get("apply_link"))
        posted_text = format_email_date(job.get("posted_date"))
        deadline_text = format_email_date(job.get("apply_deadline"))
        matched_skills_text = ", ".join(matched_skills) if matched_skills else "Relevant skills found from your resume"

        lines.extend(
            [
                f"{idx}. {title}",
                f"   Company: {company}",
                f"   Location: {location}",
                f"   Match Score: {score}%",
                f"   Matched Skills: {matched_skills_text}",
                f"   Posted: {posted_text}",
                f"   Deadline: {deadline_text}",
                f"   Apply: {apply_link}",
                "",
            ]
        )

    lines.append("This is an automated job alert from AI Interview Coach.")
    return "\n".join(lines)


# ─────────────────────────────────────────────
# EMAIL SENDER
# ─────────────────────────────────────────────
def send_email_message(to_email, subject, text_body, html_body):
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASS:
        print("SMTP settings are incomplete. Skipping job email.")
        return False

    if not to_email:
        return False

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = MAIL_FROM
    message["To"] = to_email

    message.attach(MIMEText(text_body, "plain", "utf-8"))
    message.attach(MIMEText(html_body, "html", "utf-8"))

    context = ssl.create_default_context()

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.starttls(context=context)
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(MAIL_FROM, [to_email], message.as_string())

    return True


# ─────────────────────────────────────────────
# NOTIFY EXISTING USERS ABOUT NEW JOBS
# ─────────────────────────────────────────────
def notify_users_about_new_jobs(inserted_job_ids):
    if not inserted_job_ids:
        return {
            "emails_sent": 0,
            "users_considered": 0,
            "matched_notifications": 0,
        }

    users = get_notification_users()
    new_jobs = get_jobs_by_ids(inserted_job_ids)

    emails_sent = 0
    matched_notifications = 0

    for user in users:
        user_id = user["id"]
        user_email = safe_str(user.get("email"))
        user_name = safe_str(user.get("name"))

        resume_profile = get_user_resume_profile(user_id)
        if not resume_profile:
            continue

        skills = resume_profile.get("skills", [])
        parsed_text = resume_profile.get("parsed_text", "")

        for job in new_jobs:
            if notification_exists(user_id, job["id"]):
                continue

            score, matched_skills = compute_match_score(skills, parsed_text, job)
            if score < MIN_MATCH_SCORE:
                continue

            try:
                sent = send_email_message(
                    user_email,
                    f"New job matching your resume: {safe_str(job.get('title'))}",
                    build_single_job_email_text(user_name, job, score, matched_skills),
                    build_single_job_email_html(user_name, job, score, matched_skills),
                )
                if sent:
                    record_job_notifications(
                        user_id,
                        [job["id"]],
                        match_scores={job["id"]: score},
                        notification_type="single_job",
                    )
                    emails_sent += 1
                    matched_notifications += 1
            except Exception as exc:
                print(f"Failed to send single job email to {user_email}: {exc}")

    return {
        "emails_sent": emails_sent,
        "users_considered": len(users),
        "matched_notifications": matched_notifications,
    }


# ─────────────────────────────────────────────
# NOTIFY NEW/UPLOADING USER WITH TOP 5 JOBS
# ─────────────────────────────────────────────
def send_top_jobs_for_user(user_id, limit=MAX_JOBS_PER_EMAIL):
    conn = get_db()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT id, name, email
            FROM users
            WHERE id = %s
              AND COALESCE(is_verified, FALSE) = TRUE
              AND email IS NOT NULL
              AND TRIM(email) <> ''
            LIMIT 1
            """,
            (user_id,),
        )
        user = cur.fetchone()
    finally:
        conn.close()

    if not user:
        return {
            "success": False,
            "reason": "user_not_found_or_not_verified",
        }

    resume_profile = get_user_resume_profile(user_id)
    if not resume_profile:
        return {
            "success": False,
            "reason": "resume_not_found",
        }

    skills = resume_profile.get("skills", [])
    parsed_text = resume_profile.get("parsed_text", "")

    jobs = get_all_active_jobs()
    ranked = []

    for job in jobs:
        if notification_exists(user_id, job["id"]):
            continue

        score, matched_skills = compute_match_score(skills, parsed_text, job)
        if score < MIN_MATCH_SCORE:
            continue

        ranked.append(
            {
                "job": job,
                "score": score,
                "matched_skills": matched_skills,
            }
        )

    ranked.sort(key=lambda item: item["score"], reverse=True)
    top_matches = ranked[: max(1, limit)]

    if not top_matches:
        return {
            "success": True,
            "emails_sent": 0,
            "matched_jobs": 0,
        }

    try:
        sent = send_email_message(
            safe_str(user.get("email")),
            f"Top {len(top_matches)} jobs matching your resume",
            build_top_jobs_email_text(safe_str(user.get("name")), top_matches),
            build_top_jobs_email_html(safe_str(user.get("name")), top_matches),
        )

        if sent:
            record_job_notifications(
                user_id,
                [item["job"]["id"] for item in top_matches],
                match_scores={item["job"]["id"]: item["score"] for item in top_matches},
                notification_type="top_jobs",
            )
            return {
                "success": True,
                "emails_sent": 1,
                "matched_jobs": len(top_matches),
            }

        return {
            "success": False,
            "reason": "email_not_sent",
        }

    except Exception as exc:
        print(f"Failed to send top jobs email to user_id={user_id}: {exc}")
        return {
            "success": False,
            "reason": "exception",
            "error": str(exc),
        }


# ─────────────────────────────────────────────
# MAIN ENGINE
# ─────────────────────────────────────────────
def run_jobs_engine(query=None, location=None, pages=None):
    print("Starting jobs engine...")
    init_db()

    raw_jobs = fetch_jobs(query=query, location=location, pages=pages)
    upsert_result = insert_or_update_jobs(raw_jobs)
    expired_count = cleanup_expired_jobs()
    notify_result = notify_users_about_new_jobs(upsert_result["inserted_job_ids"])

    result = {
        "fetched_count": len(raw_jobs),
        "processed_count": upsert_result["processed_count"],
        "inserted_count": len(upsert_result["inserted_job_ids"]),
        "updated_count": len(upsert_result["updated_job_ids"]),
        "expired_count": expired_count,
        "emails_sent": notify_result["emails_sent"],
        "users_considered": notify_result["users_considered"],
        "matched_notifications": notify_result["matched_notifications"],
        "queries_used": len(get_search_queries(query)),
        "locations_used": len(get_search_locations(location)),
    }

    print("Jobs engine finished:", result)
    return result


if __name__ == "__main__":
    run_jobs_engine()