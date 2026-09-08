/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";
const basePath = isProd ? "/harness-mc" : "";
const isMorroWiseLocalDocsPreview = process.env.MORROWISE_DOCS_LOCAL_PREVIEW === "1";

const nextConfig = {
  output: "export",
  // Next uses a custom `distDir` as the static export destination when
  // `output: "export"` is enabled. Keep the local-only docs export in the
  // generated-artifact area instead of creating a public-root `out/` tree.
  distDir: isMorroWiseLocalDocsPreview ? ".tmp/morrowise-docs/site" : ".next",
  basePath,
  allowedDevOrigins: ["127.0.0.1"],
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  images: { unoptimized: true },
};
export default nextConfig;
