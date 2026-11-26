export function clerkFrontendApi(publishableKey: string | null | undefined): string | null;

export function contentSecurityPolicy(options: {
  readonly apiUrl?: string | undefined;
  readonly supabaseUrl?: string | undefined;
  readonly clerkPublishableKey?: string | undefined;
  readonly inlineScriptHashes?: readonly string[];
}): string;
