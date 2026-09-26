// Re-export of the isomorphic tint math. The source lives in public/js/shared/tintMath.js so the browser
// compositor (public/js/ui/avatarCompose.js) tints layers with exactly the same function as the server.
export * from '../../public/js/shared/tintMath.js';
