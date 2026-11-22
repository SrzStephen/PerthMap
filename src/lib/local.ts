/** Local build (`npm run dev:local`): also loads personal-use-only layers from `public/data/local/`. */
export const LOCAL_LAYERS = import.meta.env.VITE_LOCAL_LAYERS === '1'

/** Where the public build sends people for layers it may not redistribute. */
export const PLANWA = 'https://espatial.dplh.wa.gov.au/PlanWA/Index.html?viewer=PlanWA'
