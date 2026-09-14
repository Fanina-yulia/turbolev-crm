/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/**": [
      "./public/brand/turbo-lev-document-logo.png",
      "./public/brand/turbo-lev-document-car-panorama.png",
      "./public/fonts/DejaVuSans.ttf",
      "./public/fonts/DejaVuSans-Bold.ttf"
    ]
  }
};

export default nextConfig;
