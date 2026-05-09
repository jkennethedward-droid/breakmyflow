export function validateUrl(url: string): {
  valid: boolean;
  error?: string;
} {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "URL is required" };
  }

  if (url.length > 2048) {
    return { valid: false, error: "URL too long" };
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: "URL must use http or https" };
    }
    // Block private/internal addresses
    const hostname = parsed.hostname;
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.endsWith(".local")
    ) {
      return { valid: false, error: "Private URLs are not allowed" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

export function validateGithubUrl(url: string): {
  valid: boolean;
  error?: string;
} {
  if (!url) return { valid: true }; // optional field

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") {
      return { valid: false, error: "GitHub URL must be from github.com" };
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return {
        valid: false,
        error: "GitHub URL must point to a repository (github.com/owner/repo)",
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid GitHub URL format" };
  }
}
