import type { CustomerCountry } from '@liwan/contracts'

/** The select value of "the main company's country", which is saved as `phone_country_id: null`. */
export const MAIN_COMPANY_COUNTRY = 'main'

export interface CountryItem { value: string; label: string }

/** The choices of the phone country select: the main company's country first, then every country; the saved one is kept even before the list loads. */
export function countryItems(countries: readonly CustomerCountry[], saved: CustomerCountry | null, mainLabel: string): CountryItem[] {
  const all = saved && !countries.some(country => country.id === saved.id) ? [saved, ...countries] : countries
  return [{ value: MAIN_COMPANY_COUNTRY, label: mainLabel }, ...all.map(country => ({ value: String(country.id), label: country.name }))]
}

export const countryValue = (id: number | null): string => (id === null ? MAIN_COMPANY_COUNTRY : String(id))
export const countryId = (value: string): number | null => (value === MAIN_COMPANY_COUNTRY ? null : Number(value))
