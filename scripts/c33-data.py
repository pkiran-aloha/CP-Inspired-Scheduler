import re

p = 'src/lib/seed.js'
s = open(p).read()

tpl = """// Custom Fields master — reusable typed templates; payers only reference these ids
export const CF_DEFS = [
  { id: 'cf-authdept', label: 'Prior auth dept', type: 'select', options: ['Behavioral Intake 2', 'Auth Review Unit 3', 'School Liaison'], required: true, note: 'Which department issued the auth — printed on the claim remarks.', status: 'active' },
  { id: 'cf-waiver', label: 'Service waiver on file', type: 'toggle', onLabel: 'Yes', offLabel: 'No', required: false, note: 'Copay/coinsurance waiver documentation received.', status: 'active' },
  { id: 'cf-present', label: 'Caregiver present', type: 'toggle', onLabel: 'Present', offLabel: 'Not present', required: false, note: '', status: 'active' },
  { id: 'cf-goals', label: 'Session focus areas', type: 'multi', options: ['Mandec', 'Toilet training', 'Sleep routine', 'Play skills', 'Feeding', 'Safety skills'], required: false, note: 'Tick every goal targeted during the session.', status: 'active' },
  { id: 'cf-parentsig', label: 'Parent/Caregiver signature', type: 'signature', required: true, note: 'Capture at the end of any parent-training session.', status: 'active' },
  { id: 'cf-teleconf', label: 'Telehealth consent confirmed', type: 'text', required: false, note: 'Verbal consent wording or link sent.', status: 'inactive' },
]

export const SVCS = SERVICES.map((s) => {"""
if 'CF_DEFS' not in s:
    assert 'export const SVCS = SERVICES.map((s) => {' in s
    s = s.replace('export const SVCS = SERVICES.map((s) => {', tpl, 1)

if "cf: ['cf-authdept'" not in s:
    # Aetna: swap the v7 inline defs for template refs
    i = s.index("Object.assign(PAYERS[1],")
    end = s.index("] })", i) + 4          # include the whole `] })` tail
    head = s[i:end].split('cf: [')[0].rstrip().rstrip(',').rstrip()
    s = s[:i] + head + ", cf: ['cf-authdept', 'cf-present'] })" + s[end:]
    assert "cf: ['cf-authdept', 'cf-present'] })" in s

    # Blue Shield CA: pick the signature template
    old4 = "Object.assign(PAYERS[4], { cmsType: 'Medicaid', format: 'None', payerId: 'DHCS-51', clearingHouse: 'Change Healthcare', ctList: '', services: [], cf: [] })"
    new4 = "Object.assign(PAYERS[4], { cmsType: 'Medicaid', format: 'None', payerId: 'DHCS-51', clearingHouse: 'Change Healthcare', ctList: '', services: [], cf: ['cf-parentsig'] })"
    assert old4 in s
    s = s.replace(old4, new4)
    open(p, 'w').write(s)
    print('seed written OK')
else:
    print('seed already done')

# ── store.jsx: customFields slice ───────────────────────────────────────────
p = 'src/state/store.jsx'
s = open(p).read()
if 'CF_DEFS' not in s:
    m = re.search(r"import \{([^}]*)\} from '([^']*seed[^']*)'", s)
    assert m, 'seed import not found'
    names = [x.strip() for x in m.group(1).split(',') if x.strip()]
    names.append('CF_DEFS')
    s = s[:m.start()] + "import { " + ', '.join(names) + " } from '" + m.group(2) + "'" + s[m.end():]
    s = s.replace("    svcs: SVCS,\n    teams: TEAMS,", "    svcs: SVCS,\n    customFields: CF_DEFS,\n    teams: TEAMS,")
    s = s.replace("          svcs: Array.isArray(saved.svcs) && saved.svcs.length ? saved.svcs : base.svcs,",
                  "          svcs: Array.isArray(saved.svcs) && saved.svcs.length ? saved.svcs : base.svcs,\n          customFields: Array.isArray(saved.customFields) ? saved.customFields : base.customFields,")
    svc_red = """      const list = state.svcs || []
      if (action.mode === 'add') return { ...state, svcs: [...list, action.item] }
      if (action.mode === 'patch') return { ...state, svcs: list.map((x) => (x.id === action.item.id ? { ...x, ...action.item } : x)) }
      return { ...state, svcs: list.filter((x) => x.id !== action.id) }"""
    assert svc_red in s, 'svc reducer text mismatch'
    s = s.replace(svc_red, svc_red + """
    }
    case 'cfdef': {
      const list = state.customFields || []
      if (action.mode === 'add') return { ...state, customFields: [...list, action.item] }
      if (action.mode === 'patch') return { ...state, customFields: list.map((x) => (x.id === action.item.id ? { ...x, ...action.item } : x)) }
      return { ...state, customFields: list.filter((x) => x.id !== action.id)""")
    s = s.replace("    removeSvc: (id) => dispatch({ type: 'svc', mode: 'remove', id }),",
                  "    removeSvc: (id) => dispatch({ type: 'svc', mode: 'remove', id }),\n    addCfDef: (item) => dispatch({ type: 'cfdef', mode: 'add', item: { id: uid(), status: 'active', required: false, options: [], onLabel: 'Yes', offLabel: 'No', note: '', ...item } }),\n    updateCfDef: (item) => dispatch({ type: 'cfdef', mode: 'patch', item }),\n    removeCfDef: (id) => dispatch({ type: 'cfdef', mode: 'remove', id }),")
    open(p, 'w').write(s)
    t = open(p).read()
    print('store OK', "customFields: CF_DEFS," in t, t.count('cfdef') >= 4, t.count('CfDef') == 3)
else:
    print('store already done')
