/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@autoshop/shared'],
  experimental: { typedRoutes: false },
};

module.exports = nextConfig;
