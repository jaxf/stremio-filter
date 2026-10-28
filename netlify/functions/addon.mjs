import { handle } from '../../lib/api.mjs';
export const handler = async event => {
  const result = await handle({ method:event.httpMethod,
    path:new URL(event.rawUrl || `https://local.invalid${event.path}`).pathname.replace(/^\/\.netlify\/functions\/addon(?=\/)/,''),
    body:event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '',
    userAgent:event.headers['user-agent'] || '', client:event.headers['x-nf-client-connection-ip'] || 'unknown' });
  return {statusCode:result.status,headers:result.headers,body:result.body};
};
