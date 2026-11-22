import {existsSync, rmSync} from 'node:fs'
import {join} from 'node:path'

/**
 * Personal-use-only layers (public/data/local/) must never be deployed: a public build deletes them from its output.
 * Returns whether anything was removed.
 */
export function stripLocal(distDir: string, local: boolean): boolean {
    const dir = join(distDir, 'data', 'local')
    if (local || !existsSync(dir)) return false
    rmSync(dir, {recursive: true, force: true})
    return true
}
