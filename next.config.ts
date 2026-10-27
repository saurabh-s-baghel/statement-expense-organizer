import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  webpack(config, { dev }) {
    if (dev) config.watchOptions = { ...config.watchOptions, poll: 1000, aggregateTimeout: 300, ignored: ['**/node_modules/**', '**/.git/**', '**/private/**', '**/public/vendor/**', '**/test-results*/**'] };
    return config;
  },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" }
    ] }];
  }
};
export default nextConfig;
