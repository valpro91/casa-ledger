import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE controls the URL prefix.
//  - GitHub Pages at https://<user>.github.io/casa-ledger/  -> set BASE=/casa-ledger/
//  - Vercel / custom domain at the root                     -> leave it as "/"
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE || "/",
});
