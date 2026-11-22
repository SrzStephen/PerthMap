/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** "1" in a local build: load personal-use-only layers from public/data/local/. */
    readonly VITE_LOCAL_LAYERS?: string
}
