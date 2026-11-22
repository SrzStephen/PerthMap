// @vitest-environment node
import {existsSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {stripLocal} from '../strip-local'

function dist() {
    const dir = mkdtempSync(join(tmpdir(), 'strip-local-'))
    mkdirSync(join(dir, 'data', 'local'), {recursive: true})
    writeFileSync(join(dir, 'data', 'attrs.bin'), 'public')
    writeFileSync(join(dir, 'data', 'local', 'attrs.bin'), 'personal use only')
    return dir
}

describe('stripLocal', () => {
    it('removes local data from a public build only', () => {
        const dir = dist()
        expect(stripLocal(dir, false)).toBe(true)
        expect(existsSync(join(dir, 'data', 'local'))).toBe(false)
        expect(existsSync(join(dir, 'data', 'attrs.bin'))).toBe(true)
    })

    it('keeps local data in a local build', () => {
        const dir = dist()
        expect(stripLocal(dir, true)).toBe(false)
        expect(existsSync(join(dir, 'data', 'local', 'attrs.bin'))).toBe(true)
    })

    it('does nothing without local data', () => {
        expect(stripLocal(join(tmpdir(), 'no-such-dist-dir'), false)).toBe(false)
    })
})
