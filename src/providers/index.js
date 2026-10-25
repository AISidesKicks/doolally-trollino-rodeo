import { DEFAULT_MODELS, MODEL_META } from "../config.js";
import { createD1Provider, createLfmProvider } from "./llama.js";
import { createMockProvider } from "./mock.js";

export function createProviders(options = {}) {
  const {
    kind = "mock",
    models = DEFAULT_MODELS,
    lfmUrl = MODEL_META.lfm.url,
    d1Url = MODEL_META.d1.url,
    lfmFtUrl = MODEL_META["lfm-ft"].url,
    mockDelay = true,
  } = options;

  const providers = {};
  for (const model of models) {
    if (kind === "mock") {
      providers[model] = createMockProvider(model, { delay: mockDelay });
      continue;
    }
    if (kind !== "llama") throw new Error(`Unknown provider kind: ${kind}`);
    if (model === "lfm" || model === "lfm-ft") {
      providers[model] = createLfmProvider({
        baseUrl: model === "lfm" ? lfmUrl : lfmFtUrl,
        model,
      });
    } else if (model === "d1") {
      providers[model] = createD1Provider({ baseUrl: d1Url });
    } else {
      throw new Error(`Unknown model: ${model}`);
    }
  }
  return providers;
}
