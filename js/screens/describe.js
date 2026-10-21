// Turns raw ops into sentences for the Activity feed and edit history.

import { formatMoney } from '../core/money.js';
import { expenseEffect } from '../core/balances.js';
import { app } from '../app/app.js';

/** Name of whoever wrote an op: "You", the member that phone claimed, or "Someone". */
export function actorName(g, deviceId) {
  const store = app.store;
  if (deviceId === store.device.id) return 'You';
  if (deviceId === '~recurring') return 'Evenly';
  for (const m of store.state(g).member.values()) if (m.claimedBy === deviceId) return m.name;
  return 'Someone';
}

const q = (s) => `“${s}”`;

/** { text, effect, effectKind } for one activity item. */
export function describe({ g, op, ent, kind }) {
  const store = app.store;
  const st = store.state(g);
  const who = actorName(g, op.d);
  const gname = q(st.group.name || 'a group');
  const name = (id) => store.memberName(g, id);
  const me = store.meIn(g);
  const v = op.v || {};

  switch (op.t) {
    case 'group': {
      if (kind.verb === 'created') return { text: `${who} created the group ${gname}.` };
      if (v.deleted) return { text: `${who} deleted the group ${gname}.` };
      if ('simplify' in v) return { text: `${who} turned simplify debts ${v.simplify ? 'on' : 'off'} in ${gname}.` };
      if ('name' in v) return { text: `${who} renamed the group to ${q(v.name)}.` };
      if ('whiteboard' in v) return { text: `${who} updated the whiteboard in ${gname}.` };
      if ('defaultSplit' in v) return { text: `${who} changed the default split in ${gname}.` };
      return { text: `${who} updated ${gname}.` };
    }
    case 'member': {
      if (kind.verb === 'created') {
        if (v.claimedBy === op.d) return { text: `${who === 'You' ? 'You' : ent.name} joined ${gname}.` };
        return { text: `${who} added ${ent.name} to ${gname}.` };
      }
      if (v.claimedBy) return { text: `${ent.name} joined ${gname} on their phone.` };
      if (v.left) return { text: `${who} removed ${ent.name} from ${gname}.` };
      return { text: `${who} updated ${ent.name}’s details in ${gname}.` };
    }
    case 'expense': {
      const d = q(ent.desc || 'an expense');
      const verb = { created: 'added', edited: 'updated', deleted: 'deleted', restored: 'restored' }[kind.verb];
      const text = `${who} ${verb} ${d} in ${gname}.`;
      if (kind.verb === 'deleted' || !me) return { text };
      const eff = expenseEffect(ent, me);
      if (eff.kind === 'lent') return { text, effect: `You get back ${formatMoney(eff.amount, ent.currency)}`, effectKind: 'pos' };
      if (eff.kind === 'borrowed') return { text, effect: `You owe ${formatMoney(eff.amount, ent.currency)}`, effectKind: 'neg' };
      return { text, effect: 'You’re not involved', effectKind: 'muted' };
    }
    case 'payment': {
      const amt = formatMoney(ent.amount || 0, ent.currency || 'INR');
      if (kind.verb === 'deleted') return { text: `${who} deleted a payment in ${gname}.` };
      const line = `${name(ent.from)} paid ${ent.to === me ? 'you' : name(ent.to)} ${amt}`;
      return { text: `${who} ${kind.verb === 'created' ? 'recorded a payment' : 'updated a payment'} in ${gname}: ${line}.` };
    }
    case 'comment': {
      const exp = st.expense.get(ent.on);
      return { text: `${who} commented on ${q(exp?.desc || 'an expense')}: ${q(ent.text || '')}` };
    }
    case 'conversion':
      return { text: `${who} converted ${ent.from} balances to ${ent.to} in ${gname} at ${ent.rate}.` };
    default:
      return { text: `${who} made a change in ${gname}.` };
  }
}

const FIELD_LABELS = { desc: 'description', amount: 'amount', currency: 'currency', paidBy: 'who paid', split: 'split', date: 'date', category: 'category', notes: 'notes', receipt: 'receipt', repeat: 'repeat' };

/** One line of an entity's edit history. */
export function historyLine(g, ent, op, index) {
  const who = actorName(g, op.w === '~recurring' ? '~recurring' : op.d);
  const v = op.v || {};
  if (index === 0) return op.w === '~recurring' ? 'Added automatically (repeats)' : `Added by ${who}`;
  if (v.deleted === true) return `Deleted by ${who}`;
  if (v.deleted === false && Object.keys(v).length === 1) return `Restored by ${who}`;
  const fields = Object.keys(v).filter((k) => FIELD_LABELS[k]).map((k) => FIELD_LABELS[k]);
  return `${who} changed ${fields.length ? fields.join(', ') : 'details'}`;
}
