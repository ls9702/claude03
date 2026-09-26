// Re-export of the isomorphic paper-doll layer contract. The source lives in public/js/shared/partStack.js so the
// browser compositor (public/js/ui/avatarCompose.js) imports the very same module; server code, scripts and
// tests keep importing it from here.
export * from '../../public/js/shared/partStack.js';
