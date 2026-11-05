// Records a manual payment for a group (managers and super admins): `months`
// more after the current period, like /sync → Renew, and tells the group.

import { api, EndpointError } from 'sdk';
import { priceFor } from '../lib/billing.js';
import { dayOf, formatKhmerDate } from '../lib/dates.js';
import { requireGroup } from '../lib/endpoint.js';
import { paymentSettings } from '../lib/settings.js';
import { renewSubscription } from '../lib/store.js';
import { RENEW_MONTHS } from '../lib/ui.js';

export default async function (input, ctx) {
  const { user, group } = await requireGroup(ctx, input.groupId, 'manage');
  const months = Number(input.months);
  if (!RENEW_MONTHS.includes(months)) throw new EndpointError(`Months must be one of ${RENEW_MONTHS.join(', ')}.`, { code: 'BAD_MONTHS' });
  const pay = await paymentSettings();
  const sub = await renewSubscription(group.id, {
    months, price: priceFor(months, pay), currency: pay.currency, recordedBy: user.id,
  });
  const until = formatKhmerDate(dayOf(sub.endDate));
  await api.sendMessage({ chat_id: group.tgId, text: `✅ ការជាវត្រូវបានបន្ត ដល់ ${until}។ ប្រើ /menu ដើម្បីមើលរបាយការណ៍។` }).catch(() => {});
  return { end: sub.endDate, months, price: sub.price, currency: sub.currency };
}
