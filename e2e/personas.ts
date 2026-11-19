/**
 * The demo-company personas of the scratch stack, in the order tools/e2e_seed.py
 * creates them (PERSONAS, ROLE_PERSONAS, BRANCH_PERSONAS). The login is
 * `e2e_<key>`; e2e.config.ts declares each one's credentials from this list so a
 * test asks for `credentials.user('<key>')` and the persona's session in
 * `e2e/tests/personas.setup.e2e.ts` carries the name.
 *
 * Adding a persona means adding it to both this list and tools/e2e_seed.py.
 * The `admin` and `employee` technical accounts are not personas.
 */
export const PERSONA_KEYS = [
  'ceo', 'it_admin', 'hr_manager', 'payroll', 'cfo', 'accountant',
  'auditor', 'pm', 'ops_manager', 'staff1', 'staff2', 'crm_manager', 'crm_agent', 'crm_agent2',
  'users_reader', 'ops_monitor', 'docs_editor', 'fin_reader', 'no_ai', 'payroll_finance', 'no_roles',
  'jeddah_staff', 'dammam_manager',
  // The Customer Inbox roles: without these no seeded account holds any inbox.* capability,
  // so every inbox scenario and its API routes are unreachable (finding 2026-11-07).
  'inbox_manager', 'inbox_supervisor', 'inbox_agent',
  // The personal-tasks capabilities with no project right (TSK-94); seeded last, like the inbox roles.
  'tasks_only',
  // Both the inbox and the CRM capabilities (CRM-140, CRM-141); seeded after the tasks persona.
  'inbox_crm_agent',
  // Channel and CRM settings rights together (CRM-150, CRM-151); seeded after the bridge agent.
  'inbox_crm_admin',
] as const;

export type PersonaKey = typeof PERSONA_KEYS[number];
