import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "-31.95123, 115.86021" for a point with no address. */
export const pointTitle = ([lat, lng]: [number, number]) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`
