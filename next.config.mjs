/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  /**
   * Исходники используют ESM-корректные спецификаторы с расширением .js
   * (требование Node ESM для worker и seed-скриптов). Сборщику нужно
   * сопоставить их с файлами .ts/.tsx.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
};
export default nextConfig;
