/**
 * The agents whose Pencapaian RM can go to a WhatsApp group, as the dashboard
 * names them (the RM sheet's Regional column).
 *
 * Kept apart from the group ids (waGroups.ts) because the page needs this list
 * — to offer "Kirim ke Grup WhatsApp" — and everything the page imports is
 * published in its JavaScript. The ids stay on the server. waGroups.ts is typed
 * against this list, so an agent added here without a group fails the build.
 */
export const WA_AGENTS = [
  'TANGERANG', 'BEKASI', 'BOGOR', 'DEPOK', 'BANDUNG',
  'SEMARANG', 'YOGYAKARTA', 'SURABAYA', 'BALI', 'JAKARTA',
] as const

export type WaAgent = (typeof WA_AGENTS)[number]
