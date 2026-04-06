import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./Jobs.css";

const API_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:5000";
const REQUEST_TIMEOUT = 15000;
const PAGE_SIZE = 100;
const MAX_AUTO_PAGES = 12;

const normalizeText = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const safeLower = (value) => normalizeText(value).toLowerCase();

const parseDateValue = (value) => {
  if (!value) return null;

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;

  const normalized = String(value).replace(" ", "T");
  const fallback = new Date(normalized);
  if (!Number.isNaN(fallback.getTime())) return fallback;

  return null;
};

const formatDate = (value) => {
  const date = parseDateValue(value);
  if (!date) return "Not specified";

  return date.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const truncateText = (text, maxLength = 220) => {
  const safeText = normalizeText(text);
  if (!safeText) return "No description available.";
  if (safeText.length <= maxLength) return safeText;
  return `${safeText.slice(0, maxLength).trim()}...`;
};

const isValidUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const fetchWithTimeout = async (url, options = {}, timeout = REQUEST_TIMEOUT) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      credentials: "include",
    });
    return response;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const parseJobsResponse = (payload) => {
  if (Array.isArray(payload)) {
    return {
      jobs: payload,
      page: 1,
      limit: payload.length || PAGE_SIZE,
      hasNext: payload.length >= PAGE_SIZE,
    };
  }

  if (payload && Array.isArray(payload.jobs)) {
    return {
      jobs: payload.jobs,
      page: Number(payload.page ?? 1),
      limit: Number(payload.limit ?? PAGE_SIZE),
      hasNext:
        typeof payload.has_next === "boolean"
          ? payload.has_next
          : payload.jobs.length >= Number(payload.limit ?? PAGE_SIZE),
    };
  }

  if (payload && Array.isArray(payload.data)) {
    return {
      jobs: payload.data,
      page: Number(payload.page ?? 1),
      limit: Number(payload.limit ?? PAGE_SIZE),
      hasNext:
        typeof payload.has_next === "boolean"
          ? payload.has_next
          : payload.data.length >= Number(payload.limit ?? PAGE_SIZE),
    };
  }

  if (payload && payload.results && Array.isArray(payload.results)) {
    return {
      jobs: payload.results,
      page: Number(payload.page ?? 1),
      limit: Number(payload.limit ?? PAGE_SIZE),
      hasNext:
        typeof payload.has_next === "boolean"
          ? payload.has_next
          : payload.results.length >= Number(payload.limit ?? PAGE_SIZE),
    };
  }

  return {
    jobs: null,
    page: 1,
    limit: PAGE_SIZE,
    hasNext: false,
  };
};

const sanitizeJob = (job, index) => {
  const applyLink = normalizeText(
    job?.apply_link || job?.apply_url || job?.url || job?.job_url
  );

  return {
    id: job?.id ?? job?._id ?? job?.job_id ?? `job-${index}`,
    title: normalizeText(job?.title || job?.job_title) || "Untitled Job",
    company: normalizeText(job?.company || job?.company_name) || "Unknown Company",
    location:
      normalizeText(job?.location || job?.job_location || job?.candidate_required_location) ||
      "Location not specified",
    description: normalizeText(job?.description || job?.summary || job?.job_description),
    apply_link: applyLink,
    posted_date: normalizeText(
      job?.posted_date || job?.created_at || job?.publication_date || job?.created
    ),
    apply_deadline: normalizeText(job?.apply_deadline || job?.deadline || ""),
    status: normalizeText(job?.status) || "active",
    source: normalizeText(job?.source || job?.provider || job?.site) || "platform",
    category: normalizeText(job?.category || ""),
    salary_min: job?.salary_min ?? null,
    salary_max: job?.salary_max ?? null,
  };
};

const dedupeJobs = (jobs) => {
  const seen = new Map();

  jobs.forEach((job) => {
    const key = [
      safeLower(job.title),
      safeLower(job.company),
      safeLower(job.location),
      safeLower(job.apply_link),
    ].join("||");

    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, job);
      return;
    }

    const existingDate = parseDateValue(existing.posted_date)?.getTime() ?? 0;
    const newDate = parseDateValue(job.posted_date)?.getTime() ?? 0;

    if (newDate >= existingDate) {
      seen.set(key, {
        ...existing,
        ...job,
        description: normalizeText(job.description) || existing.description,
        apply_deadline: normalizeText(job.apply_deadline) || existing.apply_deadline,
        posted_date: normalizeText(job.posted_date) || existing.posted_date,
      });
    }
  });

  return Array.from(seen.values());
};

function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("all");
  const [selectedCompany, setSelectedCompany] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  const buildJobsUrl = useCallback((page) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
    });

    return `${API_URL}/api/jobs?${params.toString()}`;
  }, []);

  const fetchPage = useCallback(
    async (page) => {
      const response = await fetchWithTimeout(buildJobsUrl(page), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      let data = null;
      try {
        const rawText = await response.text();
        data = rawText ? JSON.parse(rawText) : [];
      } catch {
        throw new Error("Jobs API did not return valid JSON.");
      }

      if (!response.ok) {
        const backendMessage =
          normalizeText(data?.message) ||
          normalizeText(data?.error) ||
          normalizeText(data?.detail);

        throw new Error(
          backendMessage || `Failed to fetch jobs. Status: ${response.status}`
        );
      }

      const parsed = parseJobsResponse(data);

      if (!Array.isArray(parsed.jobs)) {
        throw new Error("Invalid jobs response format.");
      }

      return {
        jobs: parsed.jobs.map((job, index) => sanitizeJob(job, `${page}-${index}`)),
        hasNext: Boolean(parsed.hasNext),
      };
    },
    [buildJobsUrl]
  );

  const fetchJobs = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        let allJobs = [];
        let page = 1;
        let shouldContinue = true;

        while (shouldContinue && page <= MAX_AUTO_PAGES) {
          const result = await fetchPage(page);
          const pageJobs = result.jobs || [];

          allJobs = allJobs.concat(pageJobs);

          const pageReturnedFullBatch = pageJobs.length >= PAGE_SIZE;
          shouldContinue = result.hasNext || pageReturnedFullBatch;

          if (!pageReturnedFullBatch && !result.hasNext) {
            break;
          }

          page += 1;
        }

        const uniqueJobs = dedupeJobs(allJobs);
        setJobs(uniqueJobs);
      } catch (err) {
        console.error("Error fetching jobs:", err);

        if (err?.name === "AbortError") {
          setError("Request timed out while loading jobs. Please try again.");
        } else if (
          err?.message?.includes("Failed to fetch") ||
          err?.message?.includes("NetworkError")
        ) {
          setError(
            "Unable to reach the jobs server. Make sure the backend is running and the API URL is correct."
          );
        } else {
          setError(err?.message || "Something went wrong while loading available jobs.");
        }

        setJobs([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchPage]
  );

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const locationOptions = useMemo(() => {
    return Array.from(
      new Set(
        jobs
          .map((job) => normalizeText(job.location))
          .filter((value) => value && value !== "Location not specified")
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [jobs]);

  const companyOptions = useMemo(() => {
    return Array.from(
      new Set(
        jobs
          .map((job) => normalizeText(job.company))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    let result = [...jobs];
    const search = searchTerm.trim().toLowerCase();

    if (search) {
      result = result.filter((job) => {
        const haystack = [
          job.title,
          job.company,
          job.location,
          job.description,
          job.source,
          job.status,
          job.category,
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(search);
      });
    }

    if (selectedLocation !== "all") {
      result = result.filter((job) => job.location === selectedLocation);
    }

    if (selectedCompany !== "all") {
      result = result.filter((job) => job.company === selectedCompany);
    }

    result.sort((a, b) => {
      if (sortBy === "company") {
        return a.company.localeCompare(b.company);
      }

      if (sortBy === "title") {
        return a.title.localeCompare(b.title);
      }

      if (sortBy === "location") {
        return a.location.localeCompare(b.location);
      }

      const dateA = parseDateValue(a.posted_date)?.getTime() ?? 0;
      const dateB = parseDateValue(b.posted_date)?.getTime() ?? 0;
      return dateB - dateA;
    });

    return result;
  }, [jobs, searchTerm, selectedLocation, selectedCompany, sortBy]);

  const handleApply = useCallback((applyLink) => {
    if (!isValidUrl(applyLink)) {
      window.alert("This application link is not available right now.");
      return;
    }

    window.open(applyLink, "_blank", "noopener,noreferrer");
  }, []);

  const clearFilters = useCallback(() => {
    setSearchTerm("");
    setSelectedLocation("all");
    setSelectedCompany("all");
    setSortBy("newest");
  }, []);

  return (
    <div className="jobs-page">
      <div className="jobs-page__container">
        <section className="jobs-hero">
          <div className="jobs-hero__content">
            <span className="jobs-hero__badge">Career Opportunities</span>
            <h1 className="jobs-hero__title">Explore Available Job Vacancies</h1>
            <p className="jobs-hero__subtitle">
              Browse current openings, filter by company or location, and apply
              directly through the official job link.
            </p>
          </div>
        </section>

        <section className="jobs-toolbar">
          <div className="jobs-toolbar__top">
            <div className="jobs-toolbar__search">
              <label htmlFor="job-search" className="jobs-label">
                Search Jobs
              </label>
              <input
                id="job-search"
                type="text"
                className="jobs-input"
                placeholder="Search by title, company, location, or keyword"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="jobs-toolbar__actions">
              <button
                type="button"
                className="jobs-btn jobs-btn--secondary"
                onClick={() => fetchJobs({ silent: true })}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>

              <button
                type="button"
                className="jobs-btn jobs-btn--ghost"
                onClick={clearFilters}
              >
                Clear Filters
              </button>
            </div>
          </div>

          <div className="jobs-toolbar__filters">
            <div className="jobs-filter">
              <label htmlFor="location-filter" className="jobs-label">
                Location
              </label>
              <select
                id="location-filter"
                className="jobs-select"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
              >
                <option value="all">All Locations</option>
                {locationOptions.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </div>

            <div className="jobs-filter">
              <label htmlFor="company-filter" className="jobs-label">
                Company
              </label>
              <select
                id="company-filter"
                className="jobs-select"
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
              >
                <option value="all">All Companies</option>
                {companyOptions.map((company) => (
                  <option key={company} value={company}>
                    {company}
                  </option>
                ))}
              </select>
            </div>

            <div className="jobs-filter">
              <label htmlFor="sort-filter" className="jobs-label">
                Sort By
              </label>
              <select
                id="sort-filter"
                className="jobs-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="newest">Newest</option>
                <option value="company">Company</option>
                <option value="title">Job Title</option>
                <option value="location">Location</option>
              </select>
            </div>
          </div>
        </section>

        {loading ? (
          <section className="jobs-feedback">
            <div className="jobs-feedback__card">
              <h2>Loading jobs...</h2>
              <p>Please wait while we fetch the latest vacancies.</p>
            </div>
          </section>
        ) : error ? (
          <section className="jobs-feedback">
            <div className="jobs-feedback__card jobs-feedback__card--error">
              <h2>Unable to load jobs</h2>
              <p>{error}</p>
              <button
                type="button"
                className="jobs-btn jobs-btn--primary"
                onClick={() => fetchJobs()}
              >
                Retry
              </button>
            </div>
          </section>
        ) : filteredJobs.length === 0 ? (
          <section className="jobs-feedback">
            <div className="jobs-feedback__card">
              <h2>No jobs found</h2>
              <p>Try changing your search or filters to see more opportunities.</p>
            </div>
          </section>
        ) : (
          <section className="jobs-results">
            <div className="jobs-results__header">
              <h2>Job Listings</h2>
            </div>

            <div className="jobs-grid">
              {filteredJobs.map((job) => (
                <article className="job-card" key={job.id}>
                  <div className="job-card__top">
                    <div>
                      <h3 className="job-card__title">{job.title}</h3>
                      <p className="job-card__company">{job.company}</p>
                    </div>

                    <span className="job-card__badge">{job.status || "active"}</span>
                  </div>

                  <div className="job-card__meta">
                    <span className="job-card__meta-item">📍 {job.location}</span>
                    <span className="job-card__meta-item">
                      🗓 Posted: {formatDate(job.posted_date)}
                    </span>
                    <span className="job-card__meta-item">
                      ⏳ Deadline: {formatDate(job.apply_deadline)}
                    </span>
                  </div>

                  <p className="job-card__description">
                    {truncateText(job.description)}
                  </p>

                  <div className="job-card__footer">
                    <span className="job-card__source">
                      Source: {job.source || "platform"}
                    </span>

                    <button
                      type="button"
                      className="jobs-btn jobs-btn--primary"
                      onClick={() => handleApply(job.apply_link)}
                    >
                      Apply Now
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default Jobs;