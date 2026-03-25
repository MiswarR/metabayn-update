export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(String(email || ''));
}

export function parsePaidAtMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    if (value > 1_000_000_000_000) return Math.trunc(value);
    if (value > 1_000_000_000) return Math.trunc(value * 1000);
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    if (n > 1_000_000_000_000) return Math.trunc(n);
    if (n > 1_000_000_000) return Math.trunc(n * 1000);
  }
  const dt = new Date(s);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

const EXPECTED_PRODUCT_NAMES = [
  'Metabayn - Smart Metadata Agent',
  'Metabayn – Smart Metadata Generator App for Images & Videos'
];

function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchProduct(body) {
  const expectedNorms = EXPECTED_PRODUCT_NAMES.map((n) => ({ ref: n, norm: normalizeTitle(n) }));

  const candidates = [];
  const push = (v) => {
    const s = String(v ?? '').trim();
    if (s) candidates.push(s);
  };

  const md =
    body?.data?.message_data ??
    body?.data?.messageData ??
    body?.message_data ??
    body?.messageData ??
    body?.data?.payload?.message_data ??
    body?.data?.payload?.messageData ??
    body?.payload?.message_data ??
    body?.payload?.messageData ??
    body?.data?.payload ??
    body?.payload ??
    body?.data ??
    body;

  push(md?.title);
  push(md?.product?.title);
  push(md?.product?.name);
  push(md?.product_name);
  push(md?.productName);
  push(md?.item_name);
  push(md?.itemName);

  const items =
    Array.isArray(md?.items) ? md.items :
    Array.isArray(md?.products) ? md.products :
    Array.isArray(body?.data?.items) ? body.data.items :
    Array.isArray(body?.data?.products) ? body.data.products :
    [];

  for (const it of items) {
    push(it?.title);
    push(it?.name);
    push(it?.product?.title);
    push(it?.product?.name);
    push(it?.product_name);
    push(it?.productName);
    push(it?.item_name);
    push(it?.itemName);
  }

  for (const c of candidates) {
    const norm = normalizeTitle(c);
    for (const ex of expectedNorms) {
      if (norm === ex.norm) return { matched: true, ref: ex.ref };
      if (norm.startsWith(`${ex.norm} (`)) return { matched: true, ref: ex.ref };
      if (norm.startsWith(`${ex.norm} -`)) return { matched: true, ref: ex.ref };
      if (norm.startsWith(`${ex.norm} |`)) return { matched: true, ref: ex.ref };
    }
  }

  try {
    const raw = JSON.stringify(body);
    const rawNorm = normalizeTitle(raw);
    for (const ex of expectedNorms) {
      if (rawNorm.includes(ex.norm)) return { matched: true, ref: ex.ref };
    }
  } catch {}

  return { matched: false, ref: null };
}

export function findEmailInPayload(body) {
  const data = body?.data;
  const messageData =
    data?.message_data ??
    data?.messageData ??
    data?.payload?.message_data ??
    data?.payload?.messageData ??
    body?.message_data ??
    body?.messageData ??
    body?.payload?.message_data ??
    body?.payload?.messageData ??
    body;

  const candidates = [
    messageData?.customer?.email,
    messageData?.buyer?.email,
    messageData?.email,
    data?.customer?.email,
    data?.buyer?.email,
    data?.email,
    body?.customer?.email,
    body?.buyer?.email,
    body?.email
  ];
  for (const c of candidates) {
    const e = normalizeEmail(c);
    if (e) return e;
  }
  return '';
}

export function parsePurchase(body) {
  const email = findEmailInPayload(body);
  const paymentStatusRaw =
    body?.data?.status ??
    body?.data?.payment_status ??
    body?.data?.paymentStatus ??
    body?.data?.message_data?.totals?.status ??
    body?.data?.message_data?.status ??
    body?.status ??
    body?.event ??
    '';
  const paymentStatus = String(paymentStatusRaw ?? '').trim().toLowerCase();

  const paidAtMs =
    parsePaidAtMs(body?.data?.paid_at) ??
    parsePaidAtMs(body?.data?.paidAt) ??
    parsePaidAtMs(body?.data?.created_at) ??
    parsePaidAtMs(body?.data?.createdAt) ??
    parsePaidAtMs(body?.data?.message_data?.paid_at) ??
    parsePaidAtMs(body?.data?.message_data?.paidAt) ??
    parsePaidAtMs(body?.data?.message_data?.created_at) ??
    parsePaidAtMs(body?.data?.message_data?.createdAt) ??
    null;

  const { matched: productMatched, ref: productRef } = matchProduct(body);

  const orderId = String(body?.data?.order_id ?? body?.data?.orderId ?? body?.order_id ?? body?.orderId ?? '').trim() || null;
  const eventId = String(body?.event_id ?? body?.eventId ?? body?.id ?? '').trim() || null;

  const amountRaw =
    body?.data?.amount ??
    body?.data?.total ??
    body?.data?.message_data?.totals?.total ??
    body?.data?.message_data?.totals?.amount ??
    body?.data?.message_data?.totals?.grand_total ??
    null;
  const amount = amountRaw === null || amountRaw === undefined ? null : Number(amountRaw);
  const currencyRaw =
    body?.data?.currency ??
    body?.data?.message_data?.totals?.currency ??
    body?.currency ??
    null;
  const currency = currencyRaw ? String(currencyRaw).toUpperCase() : null;

  return {
    email,
    paymentStatus,
    paidAtMs,
    productMatched,
    productRef,
    orderId,
    eventId,
    amount: Number.isFinite(amount) ? amount : null,
    currency
  };
}
