import {GraduationCap} from 'lucide-react'
import type {IntakeSchools} from '../../lib/schools'

export const OFFICIAL_LOOKUP = 'https://www.det.wa.edu.au/schoolsonline/home.do'
export const INTAKE_CAVEAT = 'Approximate — from DoE maps; check the official lookup if near a boundary.'

export type SchoolsState = IntakeSchools | 'loading' | 'error' | null

interface SchoolsSectionProps {
    schools: SchoolsState
    asOf: string | null
}

const Row = ({level, name}: { level: 'Primary' | 'Secondary'; name: string | undefined }) => (
    <li className="flex gap-2 text-sm">
        <GraduationCap size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--muted)]"/>
        <span>{name ? `${level}: ${name}` : `No public ${level.toLowerCase()} intake area here`}</span>
    </li>
)

export function SchoolsSection({schools, asOf}: SchoolsSectionProps) {
    if (schools === null) return null
    return (
        <section className="mt-4 border-t pt-4" aria-label="Schools">
            <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Schools</h3>
            {schools === 'loading' && <p className="mt-2 text-sm text-[var(--muted)]">Loading schools…</p>}
            {schools === 'error' && <p className="mt-2 text-sm text-[var(--muted)]">School data unavailable</p>}
            {typeof schools === 'object' && (
                <>
                    <ul className="mt-2 space-y-2">
                        <Row level="Primary" name={schools.primary?.name}/>
                        <Row level="Secondary" name={schools.secondary?.name}/>
                    </ul>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                        {INTAKE_CAVEAT}{' '}
                        <a href={OFFICIAL_LOOKUP} target="_blank" rel="noreferrer" className="underline">
                            Official lookup
                        </a>
                    </p>
                    {asOf && <p className="mt-1 text-xs text-[var(--muted)]">{`As of ${asOf}`}</p>}
                </>
            )}
        </section>
    )
}
