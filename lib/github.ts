type GitHubRepoAnalysis = {
  repoName: string;
  description: string;
  stars: number;
  readmeText: string;
  fileTree: string[];
  packageJson: string | null;
  mainEntryPoint: { path: string; content: string } | null;
  defaultBranch: string;
  lastCommitDate: string;
  apiRouteFiles: { path: string; content: string }[];
  envExampleContent: string | null;
  guidanceFiles: { path: string; content: string }[];
  totalFileCount: number;
  hasEnvExample: boolean;
  hasTests: boolean;
};

const MAX_FETCH_FILES = 10;
const MAX_FILE_CHARS = 2000;

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

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/** app/api/.../route.ts|js including app/api/route.ts */
function isApiRouteFile(path: string): boolean {
  return /^app\/api(\/.+)*\/route\.(ts|js)$/.test(path);
}

function isEnvExampleFile(path: string): boolean {
  const b = basename(path);
  return b === ".env.example" || b === ".env.sample";
}

function isGuidanceFile(path: string): boolean {
  const b = basename(path);
  return b === "AGENTS.md" || b === "CLAUDE.md";
}

function hasTestInPath(path: string): boolean {
  return path.includes(".test.") || path.includes(".spec.");
}

export async function analyzeGitHub(githubUrl: string): Promise<GitHubRepoAnalysis | null> {
  try {
    const { apiBase } = toApiBaseUrl(githubUrl);

    const repo = await fetchJson(apiBase);
    const defaultBranch =
      typeof repo?.default_branch === "string" ? repo.default_branch : "main";
    const lastCommitDate = typeof repo?.updated_at === "string" ? repo.updated_at : "";

    const [readme, tree] = await Promise.all([
      fetchJson(`${apiBase}/readme`),
      fetchJson(`${apiBase}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`),
    ]);

    const repoName = typeof repo?.full_name === "string" ? repo.full_name : "";
    const description = typeof repo?.description === "string" ? repo.description : "";
    const stars = typeof repo?.stargazers_count === "number" ? repo.stargazers_count : 0;

    const readmeContent = typeof readme?.content === "string" ? readme.content : "";
    const readmeEncoding = typeof readme?.encoding === "string" ? readme.encoding : "";
    const decodedReadme =
      readmeContent && readmeEncoding === "base64"
        ? Buffer.from(readmeContent.replace(/\s/g, ""), "base64").toString("utf8")
        : "";
    const readmeText = decodedReadme.slice(0, 3000);

    const treeNodes: Array<{ path: string; type: string }> = Array.isArray(tree?.tree)
      ? tree.tree
          .map((n: any) =>
            typeof n?.path === "string" && typeof n?.type === "string"
              ? { path: n.path as string, type: n.type as string }
              : null,
          )
          .filter(Boolean)
      : [];

    const blobPaths = treeNodes.filter((n) => n.type === "blob").map((n) => n.path);
    const totalFileCount = blobPaths.length;
    const pathSet = new Set(blobPaths);

    const hasEnvExample = blobPaths.some(isEnvExampleFile);
    const hasTests = blobPaths.some(hasTestInPath);

    const apiRoutePaths = blobPaths.filter(isApiRouteFile).sort();
    const envPaths = blobPaths.filter(isEnvExampleFile).sort();
    const envPath = envPaths[0] ?? null;
    const guidancePaths = blobPaths.filter(isGuidanceFile).sort();

    const orderedFetchPaths: string[] = [];
    const pushUnique = (p: string) => {
      if (!orderedFetchPaths.includes(p)) orderedFetchPaths.push(p);
    };
    if (envPath) pushUnique(envPath);
    for (const g of guidancePaths) pushUnique(g);
    for (const r of apiRoutePaths) pushUnique(r);
    const fetchPaths = orderedFetchPaths.slice(0, MAX_FETCH_FILES);

    const fetched = new Map<string, string>();
    for (const path of fetchPaths) {
      const raw = await fetchRepoFileText(apiBase, path);
      if (raw != null) {
        fetched.set(path, raw.slice(0, MAX_FILE_CHARS));
      }
    }

    const apiRouteFiles: { path: string; content: string }[] = [];
    for (const path of apiRoutePaths) {
      const c = fetched.get(path);
      if (c != null) apiRouteFiles.push({ path, content: c });
    }

    let envExampleContent: string | null = null;
    if (envPath && fetched.has(envPath)) {
      envExampleContent = fetched.get(envPath) ?? null;
    }

    const guidanceFiles: { path: string; content: string }[] = [];
    for (const path of guidancePaths) {
      const c = fetched.get(path);
      if (c != null) guidanceFiles.push({ path, content: c });
    }

    const fileTree = blobPaths.slice(0, 50);

    const packageJson = pathSet.has("package.json")
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
      if (!pathSet.has(candidate)) continue;
      const content = await fetchRepoFileText(apiBase, candidate);
      if (content) {
        mainEntryPoint = {
          path: candidate,
          content: content.slice(0, MAX_FILE_CHARS),
        };
        break;
      }
    }

    return {
      repoName,
      description,
      stars,
      readmeText,
      fileTree,
      packageJson,
      mainEntryPoint,
      defaultBranch,
      lastCommitDate,
      apiRouteFiles,
      envExampleContent,
      guidanceFiles,
      totalFileCount,
      hasEnvExample,
      hasTests,
    };
  } catch (error) {
    console.warn("GitHub analysis failed:", error);
    return null;
  }
}

export type { GitHubRepoAnalysis };
