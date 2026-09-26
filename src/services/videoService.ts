import { ServiceUnavailableError } from '../utils/errors';

export const generateSecureVideoAccess = async (videoId: string): Promise<{ token: string; url: string }> => {
  const accountId = process.env.CF_STREAM_ACCOUNT_ID;
  const apiToken = process.env.CF_STREAM_API_TOKEN;

  // Fail closed if credentials are missing or are placeholder values
  if (
    !accountId || !apiToken ||
    accountId === 'your-account-id' ||
    apiToken === 'your-api-token'
  ) {
    throw new ServiceUnavailableError('Video streaming provider is not configured properly.');
  }

  try {
    // 1-hour expiration
    const expiry = Math.floor(Date.now() / 1000) + 3600;

    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoId}/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        exp: expiry,
        downloadable: false
      })
    });

    if (!response.ok) {
      throw new Error(`Cloudflare API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success || !data.result || !data.result.token) {
      throw new Error('Cloudflare API did not return a valid token');
    }

    const token = data.result.token;

    return {
      token,
      url: `https://customer-${accountId}.cloudflarestream.com/${token}/manifest/video.m3u8`
    };
  } catch (error) {
    console.error('[videoService] Failed to generate secure video access:', error);
    throw new ServiceUnavailableError('Failed to generate secure video access');
  }
};
