/** @type {import('next').NextConfig} */
const nextConfig = {
    // Force Next to generate the *.nft.json tracing files Vercel expects
    outputFileTracing: true,
  
    experimental: {
      // Helps Vercel tracing resolve paths correctly
      outputFileTracingRoot: process.cwd(),
    },
  };
  
  export default nextConfig;