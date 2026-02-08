/**
 * Google OAuth2 Helper
 *
 * Handles OAuth2 authentication flow for Google Drive API access.
 * Provides functions for initiating auth, exchanging tokens, and refreshing access.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_PORT = 8085;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth/callback`;

// Scopes required for reading Google Drive and Docs
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

/**
 * Generate the OAuth2 authorization URL
 */
export function getAuthorizationUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Initiate the OAuth2 flow
 * Opens browser for user consent and captures the authorization code
 */
export async function initiateOAuthFlow(
  clientId: string,
  clientSecret: string
): Promise<{ authUrl: string; waitForCode: () => Promise<string> }> {
  const authUrl = getAuthorizationUrl(clientId);

  // Create a promise that resolves when we receive the auth code
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  // Start local HTTP server to capture the redirect
  const server = await startCallbackServer((code, error) => {
    if (error) {
      rejectCode(new Error(error));
    } else if (code) {
      resolveCode(code);
    }
  });

  // Set a timeout
  const timeout = setTimeout(
    () => {
      server.close();
      rejectCode(new Error('OAuth flow timed out after 5 minutes'));
    },
    5 * 60 * 1000
  );

  // Keep reference to clientSecret for potential use
  void clientSecret;

  return {
    authUrl,
    waitForCode: async () => {
      try {
        const code = await codePromise;
        return code;
      } finally {
        clearTimeout(timeout);
        server.close();
      }
    },
  };
}

/**
 * Start a local HTTP server to capture the OAuth callback
 */
function startCallbackServer(
  onCode: (code: string | null, error: string | null) => void
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === '/oauth/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Failed</title></head>
            <body>
              <h1>Authentication Failed</h1>
              <p>Error: ${error}</p>
              <p>You can close this window.</p>
            </body>
            </html>
          `);
          onCode(null, error);
        } else if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Successful</title></head>
            <body>
              <h1>Authentication Successful!</h1>
              <p>You can close this window and return to the terminal.</p>
              <script>setTimeout(() => window.close(), 3000);</script>
            </body>
            </html>
          `);
          onCode(code, null);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Error</title></head>
            <body>
              <h1>Error</h1>
              <p>No authorization code received.</p>
            </body>
            </html>
          `);
          onCode(null, 'No authorization code received');
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.on('error', (err) => {
      reject(err);
    });

    server.listen(REDIRECT_PORT, () => {
      resolve(server);
    });
  });
}

/**
 * Exchange authorization code for access and refresh tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<GoogleTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Token exchange failed: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
    );
  }

  interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }
  const data = (await response.json()) as TokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  };
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Token refresh failed: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`
    );
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Open a URL in the default browser
 */
export async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      await execAsync(`open "${url}"`);
    } else if (platform === 'win32') {
      await execAsync(`start "" "${url}"`);
    } else {
      // Linux and others
      await execAsync(`xdg-open "${url}"`);
    }
  } catch {
    // If we can't open the browser, the user will need to do it manually
    console.log(`Please open this URL in your browser: ${url}`);
  }
}

/**
 * Complete OAuth flow: initiate, open browser, wait for code, exchange for tokens
 */
export async function completeOAuthFlow(
  clientId: string,
  clientSecret: string
): Promise<GoogleTokens> {
  const { authUrl, waitForCode } = await initiateOAuthFlow(clientId, clientSecret);

  console.log('\nOpening browser for Google authentication...');
  console.log('If the browser does not open, please visit:');
  console.log(authUrl);

  await openBrowser(authUrl);

  console.log('\nWaiting for authentication...');
  const code = await waitForCode();

  console.log('Authentication successful! Exchanging for tokens...');
  const tokens = await exchangeCodeForTokens(code, clientId, clientSecret);

  return tokens;
}
