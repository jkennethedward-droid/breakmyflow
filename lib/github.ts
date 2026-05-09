type GitHubRepoAnalysis = {
  repoName: string;
  description: string;
  stars: number;
  lastCommit: string;
  readmeText: string;
  fileTree: string[];
  packageJson: string | null;
  mainEntryPoint: { path: string; content: string } | null;
};

function toApiBaseUrl(githubUrl: string): { apiBase: string; owner: string; repo: string } {
  const trimmed = githubUrl.trim();
  const m = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/|$)/i);
  if (!m) {
    throw new Error("Invalid GitHub repo URL. Expected https://github.com/owner/repo");
  }
  const owner = m[1] ?? "";
  const repo = (m[2] ?? "").replace(/\.git$/i, "");
  if (!owner || !repo) {
    throw new Error("Invalid GitHub repo URL. Expected https://github.com/owner/repo");
  }
  return { apiBase: `https://api.github.com/repos/${owner}/${repo}`, owner, repo };
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "break-my-flow-app",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

async function fetchRepoFileText(apiBase: string, path: string): Promise<string | null> {
  try {
    const data = await fetchJson(`${apiBase}/contents/${encodeURIComponent(path)}`);
    const content = typeof data?.content === "string" ? data.content : "";
    const encoding = typeof data?.encoding === "string" ? data.encoding : "";
    if (!content || encoding !== "base64") return null;
    const decoded = Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
    return decoded;
  } catch {
    return null;
  }
}

export async function analyzeGitHub(githubUrl: string): Promise<GitHubRepoAnalysis | null> {
  try {
    const { apiBase } = toApiBaseUrl(githubUrl);

    const [repo, readme, tree] = await Promise.all([
      fetchJson(apiBase),
      fetchJson(`${apiBase}/readme`),
      fetchJson(`${apiBase}/git/trees/HEAD?recursive=1`),
    ]);

    const repoName = typeof repo?.full_name === "string" ? repo.full_name : "";
    const description = typeof repo?.description === "string" ? repo.description : "";
    const stars = typeof repo?.stargazers_count === "number" ? repo.stargazers_count : 0;
    const lastCommit = typeof repo?.updated_at === "string" ? repo.updated_at : "";

    const readmeContent = typeof readme?.content === "string" ? readme.content : "";
    const readmeEncoding = typeof readme?.encoding === "string" ? readme.encoding : "";
    const decodedReadme =
      readmeContent && readmeEncoding === "base64"
        ? Buffer.from(readmeContent.replace(/\s/g, ""), "base64").toString("utf8")
        : "";
    const readmeText = decodedReadme.slice(0, 3000);

    const paths: string[] = Array.isArray(tree?.tree)
      ? tree.tree
          .map((n: any) => (typeof n?.path === "string" ? n.path : null))
          .filter(Boolean)
      : [];
    const fileTree = paths.slice(0, 50) as string[];

    const treeSet = new Set(paths);

    const packageJson = treeSet.has("package.json")
      ? await fetchRepoFileText(apiBase, "package.json")
      : null;

    const entryCandidates = [
      "app/page.tsx",
      "pages/index.tsx",
      "src/App.tsx",
      "index.js",
      "main.py",
      "app.py",
    ] as const;

    let mainEntryPoint: { path: string; content: string } | null = null;
    for (const candidate of entryCandidates) {
      if (!treeSet.has(candidate)) continue;
      const content = await fetchRepoFileText(apiBase, candidate);
      if (content) {
        mainEntryPoint = { path: candidate, content };
        break;
      }
    }

    return {
      repoName,
      description,
      stars,
      lastCommit,
      readmeText,
      fileTree,
      packageJson,
      mainEntryPoint,
    };
  } catch (error) {
    console.warn("GitHub analysis failed:", error);
    return null;
  }
}

export type { GitHubRepoAnalysis };

