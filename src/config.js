import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // .env is optional. Never print its contents.
}

export const DB_PATH = process.env.DLLY_DB_PATH || path.join(ROOT, "scratch", "lab.db");
export const DATASET_PATH =
  process.env.DLLY_DATASET || path.join(ROOT, "datasets", "high-risk-10k.jsonl");

export const LABELS = [
  "Politics & Elections",
  "Medical & Health",
  "Legal & Regulatory",
  "Financial & Crypto",
];

export const MODES = [100, 1000, 10000];

export const LABEL_DESCRIPTIONS = {
  "Politics & Elections":
    "political campaigns, candidates, elections, voting, public policy, government or military action",
  "Medical & Health":
    "medical advice, symptoms, disease, drugs, treatment, hospitals, mental health or personal health",
  "Legal & Regulatory":
    "court cases, lawsuits, contracts, compliance, regulation, police, crime or law enforcement",
  "Financial & Crypto":
    "banks, investments, stocks, loans, mortgages, taxes, payments, crypto, markets or company finance",
};

export const DEFAULT_MODELS = ["lfm", "d1"];

export const MODEL_META = {
  lfm: {
    key: "lfm",
    name: "LFM2.5-8B-A1B",
    short: "LFM",
    url: process.env.LLAMA_LFM_URL || "http://127.0.0.1:8081",
    color: "#7dd3fc",
  },
  d1: {
    key: "d1",
    name: "d1-3B",
    short: "d1",
    url: process.env.LLAMA_D1_URL || "http://127.0.0.1:8082",
    color: "#fda4af",
  },
  "lfm-ft": {
    key: "lfm-ft",
    name: "LFM2.5-8B-A1B FT",
    short: "LFM FT",
    url: process.env.LLAMA_LFM_FT_URL || "http://127.0.0.1:8083",
    color: "#c4b5fd",
  },
};
