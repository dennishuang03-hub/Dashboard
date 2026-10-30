/**
 * Where each agent's Pencapaian RM goes on WhatsApp: the agent as the dashboard
 * names it (the RM sheet's Regional column) → that agent's group.
 *
 * Group ids, not names: a group can be renamed in WhatsApp at any time — "Group
 * RM Jakarta" became "J&T HQxRM AG40 (Daily Report)" — and the id never
 * changes. The name beside each is for whoever edits this file.
 *
 * Server only — the server sends to these groups and nowhere else, whatever
 * the browser asks. The page knows only the agent names (waAgents.ts). Adding
 * an agent: its name there, its group here, and a redeploy.
 */
import type { WaAgent } from './waAgents.js'

export const WA_GROUPS: Record<WaAgent, string> = {
  TANGERANG: '120363433878999195@g.us', // J&T HQxRM AG12 (Daily Report)
  BEKASI: '120363413051176363@g.us', // J&T HQxRM AG13 (Daily Report)
  BOGOR: '120363430732984082@g.us', // J&T HQxRM AG14 (Daily Report)
  DEPOK: '120363413978028390@g.us', // J&T HQxRM AG15 (Daily Report)
  BANDUNG: '120363413586332942@g.us', // J&T HQxRM AG16 (Daily Report)
  SEMARANG: '120363414254135539@g.us', // J&T HQxRM AG17 (Daily Report)
  YOGYAKARTA: '120363432104201491@g.us', // J&T HQxRM AG18 (Daily Report)
  SURABAYA: '120363429596847051@g.us', // J&T HQxRM AG19 (Daily Report)
  BALI: '120363414449213516@g.us', // J&T HQxRM AG21 (Daily Report)
  JAKARTA: '120363430613405683@g.us', // J&T HQxRM AG40 (Daily Report)
}
