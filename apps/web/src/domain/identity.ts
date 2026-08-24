/**
 * Identity boundary.
 *
 * Authority: docs/11_AUTH_IDENTITY_AND_ACCESS.md, M3 continuation §5 and §7.
 *
 * NOTHING IN THIS FILE IS IMPLEMENTED YET. Stage 1 is local-first with no
 * account (docs/25 §25.10). These types exist so that when authentication is
 * introduced it is an addition, not a rewrite.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT MATTERS
 * ---------------------------------------------------------------------------
 *
 *   Auth provider  ->  auth_user_id  ->  student_profile.id  ->  academic records
 *
 * The canonical application identity is `AuthUserId`. It is NEVER a USN, an
 * email address, a name, or a college. Those are attributes, not identities:
 *
 *   USN      academic identifier    changes college-to-college, reused, public
 *   email    auth/contact attribute changeable, provider-linked
 *   name     profile information    changeable, non-unique
 *   college  academic metadata      changeable (transfer)
 *
 * Keying records on any of them means an email change, a provider switch or a
 * USN correction corrupts a student's academic history. Keying on an opaque
 * auth_user_id means all of those are ordinary profile edits.
 *
 * ---------------------------------------------------------------------------
 * WHY student_profile IS SEPARATE FROM auth_user
 * ---------------------------------------------------------------------------
 *
 * The Supabase (or any provider) user row is NOT the academic profile.
 * Keeping them 1:1 but distinct is what later permits:
 *   - deleting an account without destroying academic records
 *   - changing identity provider (Google -> Apple) without re-keying data
 *   - linking multiple providers to one profile
 *   - changing the email address
 *   - editing academic metadata independently of identity
 *   - institutional account linking
 *
 * Supabase Auth would be the identity provider only. It is not the business
 * logic layer: Express remains the authoritative API, PostgreSQL the
 * authoritative store, and @gradtools/academic-rules the domain. No domain
 * type in this codebase imports a Supabase SDK.
 */

/** Opaque brands stop an id of one kind being passed where another is expected. */
declare const authUserIdBrand: unique symbol;
declare const studentProfileIdBrand: unique symbol;

/**
 * The canonical identity, issued by the authentication provider.
 * FUTURE — always `null` in Stage 1.
 */
export type AuthUserId = string & { readonly [authUserIdBrand]: true };

/** Local identifier for an academic profile. Exists in Stage 1. */
export type StudentProfileId = string & { readonly [studentProfileIdBrand]: true };

export function asStudentProfileId(value: string): StudentProfileId {
  return value as StudentProfileId;
}

/** FUTURE — identity providers the roadmap anticipates. Not implemented. */
export type AuthProvider = 'google' | 'apple' | 'email';

/**
 * FUTURE — the shape an authenticated user would take.
 *
 * Deliberately minimal, and deliberately NOT containing academic fields.
 * There is no date of birth here and none will be added: DOB has no approved
 * product requirement (docs/32 DEC-008). Reintroducing it requires a new,
 * explicit product decision.
 */
export interface AuthUser {
  readonly id: AuthUserId;
  readonly provider: AuthProvider;
  /** Authentication/contact attribute. Never an identity key. */
  readonly email: string;
}

/**
 * How Stage 1 data becomes account-owned later.
 *
 * A local profile carries `authUserId: null`. On first sign-in the profile is
 * claimed by setting it — an update, not a migration, because every academic
 * record already points at `student_profile.id` rather than at anything
 * identity-shaped.
 *
 * The claim must be an explicit, consented action: local-first data is never
 * silently uploaded on sign-in (docs/11 §11.7).
 */
export type ProfileOwnership =
  { readonly kind: 'local' } | { readonly kind: 'account'; readonly authUserId: AuthUserId };
