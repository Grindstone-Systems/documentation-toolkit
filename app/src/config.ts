/**
 * Deployment configuration. Everything here is public and static: the app
 * has no backend and makes no requests beyond its own files. See docs/PRIVACY.md.
 */
export const CONFIG = {
  repo: import.meta.env.VITE_REPO ?? "Grindstone-Systems/documentation-toolkit",
};
