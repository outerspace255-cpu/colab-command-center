// GitHub project save for CC+. Uses the server-side GITHUB_TOKEN to create a
// repo (in the user-given name) and push the complete project files via the
// Git Data API (create a tree from blobs, commit, update the ref).
//
// No git CLI is required; this uses the REST API only. The token must have
// Contents: read+write (or the older `repo` scope) for the target account.

import { config } from "./config";

type GithubError = { message: string };

async function gh<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = config.github.token;
  if (!token) throw new Error("GITHUB_TOKEN not set — cannot save to GitHub.");
  const url = path.startsWith("http")
    ? path
    : `${config.github.baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as GithubError | null;
    throw new Error(
      `GitHub API ${res.status}: ${err?.message ?? res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

async function currentUser(): Promise<{ login: string }> {
  return gh<{ login: string }>("/user");
}

type FileInput = { path: string; content: string };

async function ensureRepo(name: string, description: string): Promise<string> {
  // Try to get the repo first; create only if missing.
  const user = await currentUser();
  const fullName = `${user.login}/${name}`;
  try {
    const repo = await gh<{ default_branch: string }>(`/repos/${fullName}`);
    return repo.default_branch || "main";
  } catch {
    // create it
    await gh(`/user/repos`, {
      method: "POST",
      body: JSON.stringify({
        name,
        description,
        private: true,
        auto_init: true,
      }),
    });
    return "main";
  }
}

async function blobSha(content: string): Promise<string> {
  // base64-encode content for the blob API
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const blob = await gh<{ sha: string }>("/git/blobs", {
    method: "POST",
    body: JSON.stringify({ content: encoded, encoding: "base64" }),
  });
  return blob.sha;
}

/**
 * Save the given files to a GitHub repo (creating it if needed) as a single
 * commit on the default branch. Returns the repo full name and commit sha.
 */
export async function saveProjectToGithub(
  repoName: string,
  description: string,
  files: FileInput[],
): Promise<{ repo: string; commitSha: string }> {
  const branch = await ensureRepo(repoName, description);
  const user = await currentUser();
  const fullName = `${user.login}/${repoName}`;

  // 1. Get the current commit the branch points at.
  const ref = await gh<{ object: { sha: string } }>(
    `/repos/${fullName}/git/ref/heads/${branch}`,
  );
  const baseSha = ref.object.sha;
  const baseCommit = await gh<{ tree: { sha: string } }>(
    `/repos/${fullName}/git/commits/${baseSha}`,
  );
  const baseTree = baseCommit.tree.sha;

  // 2. Build blobs + tree entries.
  const treeItems = await Promise.all(
    files.map(async (f) => ({
      path: f.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: await blobSha(f.content),
    })),
  );
  const tree = await gh<{ sha: string }>("/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: treeItems }),
  });

  // 3. Create the commit.
  const commit = await gh<{ sha: string }>("/git/commits", {
    method: "POST",
    body: JSON.stringify({
      message: `chore: save project ${repoName} from CC+`,
      tree: tree.sha,
      parents: [baseSha],
    }),
  });

  // 4. Update the branch ref.
  await gh(`/repos/${fullName}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  return { repo: fullName, commitSha: commit.sha };
}
