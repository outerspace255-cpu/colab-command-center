// GitHub project save for CC+. Uses either a user-supplied GitHub token (from
// the session key vault → writes to the user's own account) or the server-side
// app GITHUB_TOKEN (writes to the app's account). Creates a repo (in the
// user-given name) and pushes files via the Git Data API. No git CLI required.
//
// The token must have Contents: read+write (or the older `repo` scope).

import { config } from "./config";

type GithubError = { message: string };

async function gh<T = unknown>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  if (!token) throw new Error("No GitHub token available — cannot save to GitHub.");
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

async function currentUser(token: string): Promise<{ login: string }> {
  return gh<{ login: string }>("/user", token);
}

type FileInput = { path: string; content: string };

async function ensureRepo(
  name: string,
  description: string,
  token: string,
): Promise<string> {
  // Try to get the repo first; create only if missing.
  const user = await currentUser(token);
  const fullName = `${user.login}/${name}`;
  try {
    const repo = await gh<{ default_branch: string }>(
      `/repos/${fullName}`,
      token,
    );
    return repo.default_branch || "main";
  } catch {
    // create it
    await gh(`/user/repos`, token, {
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

async function blobSha(content: string, token: string): Promise<string> {
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const blob = await gh<{ sha: string }>("/git/blobs", token, {
    method: "POST",
    body: JSON.stringify({ content: encoded, encoding: "base64" }),
  });
  return blob.sha;
}

/**
 * Save the given files to a GitHub repo (creating it if needed) as a single
 * commit on the default branch. Uses `userToken` when provided (the user's own
 * account), otherwise falls back to the app's GITHUB_TOKEN (the app account).
 * Returns the repo full name, commit sha, and which account was used.
 */
export async function saveProjectToGithub(
  repoName: string,
  description: string,
  files: FileInput[],
  userToken?: string,
): Promise<{ repo: string; commitSha: string; account: "user" | "app" }> {
  const token = userToken || config.github.token;
  if (!token) throw new Error("GitHub save is not configured (no token).");
  const account: "user" | "app" = userToken ? "user" : "app";

  const branch = await ensureRepo(repoName, description, token);
  const user = await currentUser(token);
  const fullName = `${user.login}/${repoName}`;

  // 1. Get the current commit the branch points at.
  const ref = await gh<{ object: { sha: string } }>(
    `/repos/${fullName}/git/ref/heads/${branch}`,
    token,
  );
  const baseSha = ref.object.sha;
  const baseCommit = await gh<{ tree: { sha: string } }>(
    `/repos/${fullName}/git/commits/${baseSha}`,
    token,
  );
  const baseTree = baseCommit.tree.sha;

  // 2. Build blobs + tree entries.
  const treeItems = await Promise.all(
    files.map(async (f) => ({
      path: f.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: await blobSha(f.content, token),
    })),
  );
  const tree = await gh<{ sha: string }>("/git/trees", token, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: treeItems }),
  });

  // 3. Create the commit.
  const commit = await gh<{ sha: string }>("/git/commits", token, {
    method: "POST",
    body: JSON.stringify({
      message: `chore: save project ${repoName} from CC+`,
      tree: tree.sha,
      parents: [baseSha],
    }),
  });

  // 4. Update the branch ref.
  await gh(`/repos/${fullName}/git/refs/heads/${branch}`, token, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  return { repo: fullName, commitSha: commit.sha, account };
}
