import { getProviderConfig } from './_config.js';
import { getSecurityConfig } from './_security.js';

// Configuration readiness only. Never expose credentials or claim a live model check.
export default function health(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const provider = getProviderConfig();
  const security = getSecurityConfig();
  const protectionConfigured = !security.requiresDurable || security.durableConfigured;
  const configured = provider.configured && protectionConfigured;
  return res.status(configured ? 200 : 503).json({
    mode: provider.mode,
    configured,
    providerConfigured: provider.configured,
    protectionConfigured,
    providers: provider.providers,
  });
}
