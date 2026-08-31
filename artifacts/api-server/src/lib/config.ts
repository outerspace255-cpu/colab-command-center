// Central typed configuration for CC+. Reads server-side keys (never exposed
// to the client) and groups them into provider pools with rate-limit metadata.

import { loadEnvFile } from "./env";

loadEnvFile();

function splitKeys(...values: (string | undefined)[]): string[] {
  return values
    .map((v) => (v ?? "").trim())
    .filter((v): v is string => v.length > 0);
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type PoolConfig = {
  provider: "gemini" | "deepseek" | "nvidia";
  keys: string[];
  /** Max requests per minute per key (sliding window). */
  perKeyLimitPerMinute: number;
  model: string;
  /** For nvidia: fallback model chain. */
  fallbackModels?: string[];
  /** OpenAI-compatible base URL (chat completions). Empty for gemini. */
  baseUrl: string;
};

export type AppConfig = {
  appName: string;
  occupancyLock: boolean;
  logLevel: string;
  github: { token: string; baseUrl: string };
  kaggle: { apiKey: string };
  pools: {
    gemini: PoolConfig;
    deepseek: PoolConfig;
    nvidia: PoolConfig;
  };
};

function nvidiaModels(): string[] {
  const raw = process.env["NVIDIA_FALLBACK_MODELS"] ?? "";
  return raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export function loadConfig(): AppConfig {
  const githubToken = (process.env["GITHUB_TOKEN"] ?? "").trim();
  if (!githubToken) {
    // Soft warn: github save won't work, but the app should still boot.
    console.warn("[config] GITHUB_TOKEN not set — project save to GitHub disabled.");
  }

  return {
    appName: (process.env["APP_NAME"] ?? "CC+").trim(),
    occupancyLock: (process.env["APP_OCCUPANCY_LOCK"] ?? "true").trim() !== "false",
    logLevel: (process.env["LOG_LEVEL"] ?? "info").trim(),
    github: {
      token: githubToken,
      baseUrl: (process.env["GITHUB_API_BASE_URL"] ?? "https://api.github.com").trim(),
    },
    kaggle: {
      apiKey: (process.env["KAGGLE_API_KEY"] ?? "").trim(),
    },
    pools: {
      gemini: {
        provider: "gemini",
        keys: splitKeys(
          process.env["GEMINI_API_KEY_1"],
          process.env["GEMINI_API_KEY_2"],
        ),
        perKeyLimitPerMinute: int(process.env["GEMINI_RPM"], 14),
        model: (process.env["GEMINI_MODEL"] ?? "gemini-3.5-flash").trim(),
        baseUrl: "",
      },
      deepseek: {
        provider: "deepseek",
        keys: splitKeys(
          process.env["DEEPSEEK_API_KEY_1"],
          process.env["DEEPSEEK_API_KEY_2"],
        ),
        perKeyLimitPerMinute: int(process.env["DEEPSEEK_RPM"], 10),
        model: (process.env["DEEPSEEK_MODEL"] ?? "glm-5.2").trim(),
        baseUrl: (
          process.env["DEEPSEEK_BASE_URL"] ??
          "https://api.b.ai/v1/chat/completions"
        ).trim(),
      },
      nvidia: {
        provider: "nvidia",
        keys: splitKeys(
          process.env["NVIDIA_API_KEY_1"],
          process.env["NVIDIA_API_KEY_2"],
        ),
        perKeyLimitPerMinute: int(process.env["NVIDIA_RPM"], 10),
        model: (process.env["NVIDIA_MODEL"] ?? "").trim(),
        fallbackModels: nvidiaModels(),
        baseUrl: (
          process.env["NVIDIA_BASE_URL"] ??
          "https://integrate.api.nvidia.com/v1/chat/completions"
        ).trim(),
      },
    },
  };
}

export const config = loadConfig();
