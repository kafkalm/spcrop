import type { ProviderAdapterMap, RunWithFallbackResult, GenerateRequest, ProviderId } from "./types";

function getAdapter(provider: ProviderId, adapters: ProviderAdapterMap) {
  if (provider === "openai") {
    return adapters.openai;
  }
  return adapters.gemini;
}

export async function runWithFallback(
  request: GenerateRequest,
  adapters: ProviderAdapterMap,
  signal?: AbortSignal,
): Promise<RunWithFallbackResult> {
  const primaryProvider = request.provider;
  const primary = getAdapter(primaryProvider, adapters);

  try {
    const assets = await primary.generate(request, signal);
    return {
      assets,
      providerUsed: primaryProvider,
      fallbackFrom: null,
    };
  } catch (primaryError) {
    const fallbackProvider = request.fallbackProvider;
    if (!fallbackProvider || fallbackProvider === primaryProvider) {
      throw primaryError;
    }

    const fallback = getAdapter(fallbackProvider, adapters);
    const fallbackRequest: GenerateRequest = {
      ...request,
      provider: fallbackProvider,
      fallbackProvider: undefined,
    };
    const assets = await fallback.generate(fallbackRequest, signal);
    return {
      assets,
      providerUsed: fallbackProvider,
      fallbackFrom: primaryProvider,
    };
  }
}
