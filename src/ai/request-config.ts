import type { ProviderId } from "./types";

export interface ResolveFallbackProviderInput {
  primaryProvider: ProviderId;
  enableFallback: boolean;
  fallbackProvider: "" | ProviderId;
}

export function resolveFallbackProvider(input: ResolveFallbackProviderInput): ProviderId | undefined {
  if (!input.enableFallback) {
    return undefined;
  }
  if (!input.fallbackProvider) {
    return undefined;
  }
  if (input.fallbackProvider === input.primaryProvider) {
    return undefined;
  }
  return input.fallbackProvider;
}
