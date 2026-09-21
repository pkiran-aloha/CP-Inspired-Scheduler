import fs from 'fs'
import { blankState } from '../src/state/store'
import { claimTo1500, claimsTo1500 } from '../src/lib/cms1500'
const st = blankState()
const claims = Object.values(st.claims)
const paid = claims.find((c) => c.status === 'paid')
const self = claims.find((c) => c.mode === 'selfpay')
const denied = claims.find((c) => c.status === 'denied')
fs.writeFileSync('/tmp/cms-paid.pdf', Buffer.from(claimTo1500(st, paid).output('arraybuffer')))
fs.writeFileSync('/tmp/cms-self.pdf', Buffer.from(claimTo1500(st, self).output('arraybuffer')))
if (denied) fs.writeFileSync('/tmp/cms-denied.pdf', Buffer.from(claimTo1500(st, denied).output('arraybuffer')))
fs.writeFileSync('/tmp/cms-batch.pdf', Buffer.from(claimsTo1500(st, claims.slice(0, 8)).output('arraybuffer')))
console.log('wrote', paid.no, self?.no, denied?.no, 'batch8')
