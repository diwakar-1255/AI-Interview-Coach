import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  useMemo,
  useRef,
} from "react";

export const AuthContext = createContext();

const API_URL = process.env.REACT_APP_API_URL || "http://127.0.0.1:5000";
const REQUEST_TIMEOUT = 12000;

const AUTH_STORAGE_KEYS = {
  token: "token",
  userId: "user_id",
  userName: "user_name",
  userEmail: "user_email",
};

const INTERVIEW_STORAGE_KEYS = [
  "current_interview_data",
  "unfinished_interview",
  "dashboard_resume_cache",
  "dashboard_interviews_cache",
  "profile_cache",
];

const SESSION_STORAGE_KEYS = [
  "liveInterviewData",
  "live_interview_session",
  "interviewData",
  "currentInterviewId",
  "currentQuestionIndex",
  "interview_answers_draft",
];

const fetchWithTimeout = async (
  url,
  options = {},
  timeout = REQUEST_TIMEOUT
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

const parseJsonSafely = async (response) => {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
};

const normalizeUser = (userData, fallback = {}) => {
  if (!userData || typeof userData !== "object") {
    return {
      id: fallback.id || null,
      name: fallback.name || "User",
      email: fallback.email || "",
      is_verified: fallback.is_verified ?? true,
    };
  }

  return {
    id: userData.id ?? userData.user_id ?? fallback.id ?? null,
    name: userData.name || userData.username || fallback.name || "User",
    email: userData.email || fallback.email || "",
    is_verified:
      userData.is_verified ??
      userData.isVerified ??
      fallback.is_verified ??
      true,
  };
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUserState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(false);

  const isMountedRef = useRef(false);
  const authCheckInProgressRef = useRef(false);
  const lastAuthCheckAtRef = useRef(0);
  const latestTokenRef = useRef("");
  const hasInitializedOnceRef = useRef(false);

  const clearStoredAuth = useCallback(() => {
    localStorage.removeItem(AUTH_STORAGE_KEYS.token);
    localStorage.removeItem(AUTH_STORAGE_KEYS.userId);
    localStorage.removeItem(AUTH_STORAGE_KEYS.userName);
    localStorage.removeItem(AUTH_STORAGE_KEYS.userEmail);
  }, []);

  const clearInterviewStorage = useCallback(() => {
    INTERVIEW_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    SESSION_STORAGE_KEYS.forEach((key) => sessionStorage.removeItem(key));
  }, []);

  const clearAllAppState = useCallback(() => {
    clearStoredAuth();
    clearInterviewStorage();
  }, [clearStoredAuth, clearInterviewStorage]);

  const syncUserToStorage = useCallback((userData) => {
    if (!userData) return;

    if (userData.id !== undefined && userData.id !== null && userData.id !== "") {
      localStorage.setItem(AUTH_STORAGE_KEYS.userId, String(userData.id));
    }

    localStorage.setItem(
      AUTH_STORAGE_KEYS.userName,
      typeof userData.name === "string" && userData.name.trim()
        ? userData.name.trim()
        : "User"
    );

    localStorage.setItem(
      AUTH_STORAGE_KEYS.userEmail,
      typeof userData.email === "string" ? userData.email : ""
    );
  }, []);

  const getToken = useCallback(() => {
    return localStorage.getItem(AUTH_STORAGE_KEYS.token) || "";
  }, []);

  const getStoredUser = useCallback(() => {
    return {
      token: localStorage.getItem(AUTH_STORAGE_KEYS.token),
      userId: localStorage.getItem(AUTH_STORAGE_KEYS.userId),
      userName: localStorage.getItem(AUTH_STORAGE_KEYS.userName),
      userEmail: localStorage.getItem(AUTH_STORAGE_KEYS.userEmail),
    };
  }, []);

  const setAuthState = useCallback((authState, userData = null) => {
    if (!isMountedRef.current) return;

    setIsAuthenticated(Boolean(authState));
    setUserState(userData);
  }, []);

  const storeToken = useCallback((token) => {
    latestTokenRef.current = token || "";
    if (token) {
      localStorage.setItem(AUTH_STORAGE_KEYS.token, token);
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEYS.token);
    }
  }, []);

  const authenticatedFetch = useCallback(
    async (path, options = {}, timeout = REQUEST_TIMEOUT) => {
      const token = latestTokenRef.current || getToken();

      const headers = {
        Accept: "application/json",
        ...(options.headers || {}),
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      return fetchWithTimeout(
        `${API_URL}${path}`,
        {
          ...options,
          headers,
        },
        timeout
      );
    },
    [getToken]
  );

  const checkAuth = useCallback(
    async (token) => {
      const resolvedToken = token || getToken();

      if (!resolvedToken) {
        return {
          valid: false,
          user: null,
          message: "No token found",
          status: 0,
          networkError: false,
        };
      }

      try {
        const response = await fetchWithTimeout(
          `${API_URL}/api/check-auth`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${resolvedToken}`,
              Accept: "application/json",
            },
          },
          REQUEST_TIMEOUT
        );

        const data = await parseJsonSafely(response);

        return {
          valid: response.ok,
          user: data?.user || data?.data || data || null,
          message: data?.message || data?.error || "",
          status: response.status,
          networkError: false,
        };
      } catch (error) {
        console.error("checkAuth failed:", error);

        return {
          valid: false,
          user: null,
          message:
            error?.name === "AbortError"
              ? "Authentication request timed out"
              : "Authentication request failed",
          status: 0,
          networkError: true,
        };
      }
    },
    [getToken]
  );

  const login = useCallback((token, userId, userName, email = "") => {
    const normalized = normalizeUser({
      id: userId,
      name: userName,
      email,
      is_verified: true,
    });

    storeToken(token);
    syncUserToStorage(normalized);

    if (isMountedRef.current) {
      setIsAuthenticated(true);
      setUserState(normalized);
      setLoading(false);
      setAuthInitialized(true);
    }
  }, [storeToken, syncUserToStorage]);

  const logout = useCallback(() => {
    latestTokenRef.current = "";
    clearAllAppState();

    if (isMountedRef.current) {
      setIsAuthenticated(false);
      setUserState(null);
      setLoading(false);
      setAuthInitialized(true);
    }
  }, [clearAllAppState]);

  const setUser = useCallback(
    (userDataOrUpdater) => {
      setUserState((prevUser) => {
        const nextUser =
          typeof userDataOrUpdater === "function"
            ? userDataOrUpdater(prevUser)
            : userDataOrUpdater;

        const normalized = nextUser
          ? normalizeUser(nextUser, prevUser || {})
          : null;

        if (normalized) {
          syncUserToStorage(normalized);
        }

        return normalized;
      });
    },
    [syncUserToStorage]
  );

  const updateUser = useCallback(
    (updatedUserData) => {
      if (!updatedUserData || typeof updatedUserData !== "object") return;

      setUserState((prevUser) => {
        const mergedUser = normalizeUser(
          {
            ...(prevUser || {}),
            ...updatedUserData,
          },
          prevUser || {}
        );

        syncUserToStorage(mergedUser);
        return mergedUser;
      });
    },
    [syncUserToStorage]
  );

  const initializeAuth = useCallback(
    async ({ force = false } = {}) => {
      const now = Date.now();

      if (authCheckInProgressRef.current) return;

      if (!force && now - lastAuthCheckAtRef.current < 2500 && hasInitializedOnceRef.current) {
        if (isMountedRef.current) {
          setLoading(false);
          setAuthInitialized(true);
        }
        return;
      }

      authCheckInProgressRef.current = true;
      lastAuthCheckAtRef.current = now;

      try {
        if (isMountedRef.current) {
          setLoading(true);
        }

        const { token, userId, userName, userEmail } = getStoredUser();
        latestTokenRef.current = token || "";

        if (!token || !userId) {
          setAuthState(false, null);
          return;
        }

        const fallbackUser = normalizeUser({
          id: userId,
          name: userName || "User",
          email: userEmail || "",
        });

        const result = await checkAuth(token);

        if (!isMountedRef.current) return;

        if (result.valid) {
          const resolvedUser = normalizeUser(result.user, fallbackUser);
          syncUserToStorage(resolvedUser);
          setAuthState(true, resolvedUser);
          hasInitializedOnceRef.current = true;
          return;
        }

        if (result.networkError) {
          setAuthState(true, fallbackUser);
          hasInitializedOnceRef.current = true;
          return;
        }

        clearStoredAuth();
        setAuthState(false, null);
      } catch (error) {
        console.error("initializeAuth failed:", error);

        const { token, userId, userName, userEmail } = getStoredUser();

        if (token && userId) {
          const fallbackUser = normalizeUser({
            id: userId,
            name: userName || "User",
            email: userEmail || "",
          });
          setAuthState(true, fallbackUser);
          hasInitializedOnceRef.current = true;
        } else {
          clearStoredAuth();
          setAuthState(false, null);
        }
      } finally {
        authCheckInProgressRef.current = false;
        if (isMountedRef.current) {
          setLoading(false);
          setAuthInitialized(true);
        }
      }
    },
    [checkAuth, clearStoredAuth, getStoredUser, setAuthState, syncUserToStorage]
  );

  const refreshAuth = useCallback(async () => {
    await initializeAuth({ force: true });
  }, [initializeAuth]);

  const register = useCallback(
    async ({ name, email, password }) => {
      try {
        const response = await fetchWithTimeout(
          `${API_URL}/api/register`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ name, email, password }),
          },
          REQUEST_TIMEOUT
        );

        const data = await parseJsonSafely(response);

        return {
          ok: response.ok,
          status: response.status,
          data,
          error: data?.error || data?.message || "",
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          data: {},
          error:
            error?.name === "AbortError"
              ? "Registration request timed out"
              : "Registration request failed",
        };
      }
    },
    []
  );

  const loginWithCredentials = useCallback(
    async ({ email, password }) => {
      try {
        const response = await fetchWithTimeout(
          `${API_URL}/api/login`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ email, password }),
          },
          REQUEST_TIMEOUT
        );

        const data = await parseJsonSafely(response);

        if (response.ok && data?.token) {
          login(
            data.token,
            data.user_id ?? data.id,
            data.name || "User",
            data.email || email || ""
          );
        }

        return {
          ok: response.ok,
          status: response.status,
          data,
          error: data?.error || data?.message || "",
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          data: {},
          error:
            error?.name === "AbortError"
              ? "Login request timed out"
              : "Login request failed",
        };
      }
    },
    [login]
  );

  const verifyOtp = useCallback(async ({ email, otp }) => {
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/api/verify-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ email, otp }),
        },
        REQUEST_TIMEOUT
      );

      const data = await parseJsonSafely(response);

      return {
        ok: response.ok,
        status: response.status,
        data,
        error: data?.error || data?.message || "",
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        data: {},
        error:
          error?.name === "AbortError"
            ? "OTP verification timed out"
            : "OTP verification failed",
      };
    }
  }, []);

  const resendOtp = useCallback(async ({ email }) => {
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/api/resend-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ email }),
        },
        REQUEST_TIMEOUT
      );

      const data = await parseJsonSafely(response);

      return {
        ok: response.ok,
        status: response.status,
        data,
        error: data?.error || data?.message || "",
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        data: {},
        error:
          error?.name === "AbortError"
            ? "Resend OTP timed out"
            : "Resend OTP failed",
      };
    }
  }, []);

  const forgotPassword = useCallback(async ({ email }) => {
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/api/forgot-password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ email }),
        },
        REQUEST_TIMEOUT
      );

      const data = await parseJsonSafely(response);

      return {
        ok: response.ok,
        status: response.status,
        data,
        error: data?.error || data?.message || "",
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        data: {},
        error:
          error?.name === "AbortError"
            ? "Forgot password request timed out"
            : "Forgot password request failed",
      };
    }
  }, []);

  const verifyResetOtp = useCallback(async ({ email, otp }) => {
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/api/verify-reset-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ email, otp }),
        },
        REQUEST_TIMEOUT
      );

      const data = await parseJsonSafely(response);

      return {
        ok: response.ok,
        status: response.status,
        data,
        error: data?.error || data?.message || "",
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        data: {},
        error:
          error?.name === "AbortError"
            ? "Reset OTP verification timed out"
            : "Reset OTP verification failed",
      };
    }
  }, []);

  const resetPassword = useCallback(async ({ email, otp, new_password }) => {
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/api/reset-password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ email, otp, new_password }),
        },
        REQUEST_TIMEOUT
      );

      const data = await parseJsonSafely(response);

      return {
        ok: response.ok,
        status: response.status,
        data,
        error: data?.error || data?.message || "",
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        data: {},
        error:
          error?.name === "AbortError"
            ? "Reset password request timed out"
            : "Reset password request failed",
      };
    }
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      const response = await authenticatedFetch("/api/profile", {
        method: "GET",
      });

      const data = await parseJsonSafely(response);

      if (response.ok && data) {
        updateUser(data);
      }

      return {
        ok: response.ok,
        status: response.status,
        data,
        error: data?.error || data?.message || "",
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        data: {},
        error:
          error?.name === "AbortError"
            ? "Profile request timed out"
            : "Profile request failed",
      };
    }
  }, [authenticatedFetch, updateUser]);

  const updateProfile = useCallback(
    async ({ name, email }) => {
      try {
        const response = await authenticatedFetch("/api/profile", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name, email }),
        });

        const data = await parseJsonSafely(response);

        if (response.ok) {
          updateUser({
            id: data?.id ?? data?.user_id ?? user?.id,
            name: data?.name ?? name,
            email: data?.email ?? email,
          });
        }

        return {
          ok: response.ok,
          status: response.status,
          data,
          error: data?.error || data?.message || "",
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          data: {},
          error:
            error?.name === "AbortError"
              ? "Update profile timed out"
              : "Update profile failed",
        };
      }
    },
    [authenticatedFetch, updateUser, user?.id]
  );

  const changePassword = useCallback(
    async ({ current_password, new_password }) => {
      try {
        const response = await authenticatedFetch("/api/change-password", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ current_password, new_password }),
        });

        const data = await parseJsonSafely(response);

        return {
          ok: response.ok,
          status: response.status,
          data,
          error: data?.error || data?.message || "",
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          data: {},
          error:
            error?.name === "AbortError"
              ? "Change password timed out"
              : "Change password failed",
        };
      }
    },
    [authenticatedFetch]
  );

  useEffect(() => {
    isMountedRef.current = true;
    initializeAuth();

    return () => {
      isMountedRef.current = false;
    };
  }, [initializeAuth]);

  const contextValue = useMemo(
    () => ({
      isAuthenticated,
      user,
      loading,
      authInitialized,
      API_URL,

      login,
      logout,
      setUser,
      updateUser,

      getToken,
      checkAuth,
      refreshAuth: refreshAuth,

      clearStoredAuth,
      clearInterviewStorage,
      clearAllAppState,

      authenticatedFetch,

      register,
      loginWithCredentials,
      verifyOtp,
      resendOtp,
      forgotPassword,
      verifyResetOtp,
      resetPassword,

      fetchProfile,
      updateProfile,
      changePassword,
    }),
    [
      isAuthenticated,
      user,
      loading,
      authInitialized,
      login,
      logout,
      setUser,
      updateUser,
      getToken,
      checkAuth,
      refreshAuth,
      clearStoredAuth,
      clearInterviewStorage,
      clearAllAppState,
      authenticatedFetch,
      register,
      loginWithCredentials,
      verifyOtp,
      resendOtp,
      forgotPassword,
      verifyResetOtp,
      resetPassword,
      fetchProfile,
      updateProfile,
      changePassword,
    ]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);