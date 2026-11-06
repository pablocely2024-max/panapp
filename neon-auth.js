import { createAuthClient } from 'https://cdn.jsdelivr.net/npm/@neondatabase/auth@0.7.0-beta/+esm';

const tenantBasePath = window.location.pathname.match(/^\/t\/[^/]+/)?.[0] || '';
const configPath = tenantBasePath
    ? `${tenantBasePath}/api/security/provider`
    : '/api/security/provider';
const response = await fetch(configPath, { cache: 'no-store' });
const configuration = await response.json();

if (!response.ok || configuration.provider !== 'neon' || !configuration.auth_url) {
    throw new Error(configuration.detail || 'Neon Auth no está configurado.');
}

export const neonAuth = createAuthClient(configuration.auth_url);
