import { google } from 'googleapis';
import { env } from '../config/env.js';

export const GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export function createOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

export function buildConsentUrl(state: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  });
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number;
}

export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error('Google did not return an access_token during code exchange');
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiryDate: tokens.expiry_date ?? Date.now() + 3600 * 1000,
  };
}

/**
 * Revokes a Google OAuth token (POSTs to Google's `/revoke` endpoint under the hood, via
 * google-auth-library's `OAuth2Client.revokeToken`). Best-effort by design — the caller should
 * still delete local data even if Google's revoke call fails, since "delete my data" is a promise
 * about this app's own storage, not a guarantee it can force Google's side to succeed.
 */
export async function revokeGoogleAccess(accessToken: string): Promise<void> {
  const client = createOAuthClient();
  await client.revokeToken(accessToken);
}

export interface GoogleUserInfo {
  googleId: string;
  email: string;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const client = createOAuthClient();
  client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ auth: client, version: 'v2' });
  const { data } = await oauth2.userinfo.get();
  if (!data.id || !data.email) {
    throw new Error('Google userinfo response missing id or email');
  }
  return { googleId: data.id, email: data.email };
}
