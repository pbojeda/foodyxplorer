/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // F-UX-A: `@foodxplorer/shared` ships raw TypeScript with Node16-style
  // `.js` imports. Next.js must transpile it through its own TS pipeline so
  // those imports resolve to the real `.ts` files in packages/shared/src.
  transpilePackages: ['@foodxplorer/shared'],
  webpack: (config) => {
    // Shared package ships raw TypeScript using Node16-style `.js` suffixes on
    // intra-package imports. Tell webpack's resolver that a `.js` request in
    // a TypeScript context must fall back to the corresponding `.ts` / `.tsx`
    // source file. Without this, `import './schemas/enums.js'` from shared
    // fails at webpack module resolution even though it succeeds at tsc.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
  images: {
    remotePatterns: [],
  },
  async headers() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.nutrixplorer.com';
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${apiUrl}; font-src 'self' https://fonts.gstatic.com; frame-src 'none'; object-src 'none'`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
