export type Proposal = {
  name: string
  brand: string
  label: string
  quantity: string
  unit: string
  barcode: string
  sourceRef: string
}
export type OffResult =
  | { status: 'found' | 'incomplete'; proposal: Proposal }
  | {
      status: 'absent' | 'unavailable' | 'network' | 'timeout' | 'limited'
      retryAfter?: number
    }
export const fields =
  'code,product_name_it,product_name,brands,quantity,product_quantity,product_quantity_unit'
export const canonicalCode = (code: string) =>
  code.length === 12 ? `0${code}` : code
const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''
export function parseOff(body: unknown, code: string): OffResult {
  if (
    !body ||
    typeof body !== 'object' ||
    !('product' in body) ||
    !body.product ||
    typeof body.product !== 'object' ||
    Array.isArray(body.product)
  )
    return { status: 'unavailable' }
  const p = body.product as Record<string, unknown>
  if (
    typeof p.code !== 'string' ||
    canonicalCode(p.code) !== canonicalCode(code)
  )
    return { status: 'unavailable' }
  for (const key of [
    'product_name_it',
    'product_name',
    'brands',
    'quantity',
    'product_quantity_unit',
  ]) {
    if (p[key] !== undefined && p[key] !== null && typeof p[key] !== 'string')
      return { status: 'unavailable' }
  }
  if (
    p.product_quantity !== undefined &&
    p.product_quantity !== null &&
    typeof p.product_quantity !== 'string' &&
    typeof p.product_quantity !== 'number'
  )
    return { status: 'unavailable' }
  const name = text(p.product_name_it, 160) || text(p.product_name, 160)
  const brand = text(p.brands, 120),
    label = text(p.quantity, 120)
  const unit = ['g', 'kg', 'ml', 'l'].includes(String(p.product_quantity_unit))
    ? String(p.product_quantity_unit)
    : ''
  const raw = String(p.product_quantity ?? '')
  const quantity =
    unit && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(raw) && Number(raw) > 0
      ? raw
      : ''
  return {
    status: name && brand && label ? 'found' : 'incomplete',
    proposal: {
      name,
      brand,
      label,
      quantity,
      unit: quantity ? unit : '',
      barcode: code,
      sourceRef: `https://world.openfoodfacts.org/product/${canonicalCode(code)}`,
    },
  }
}
export async function fetchOff(
  code: string,
  userAgent: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 7000,
): Promise<OffResult> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(
      `https://world.openfoodfacts.org/api/v3/product/${code}?fields=${fields}&lc=it&cc=it&product_type=food`,
      {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'error',
      },
    )
    if (response.status === 404) return { status: 'absent' }
    if (response.status === 429)
      return {
        status: 'limited',
        retryAfter: Math.min(
          3600,
          Math.max(60, Number(response.headers.get('retry-after')) || 60),
        ),
      }
    if (!response.ok) return { status: 'unavailable' }
    return parseOff(await response.json(), code)
  } catch (error) {
    return {
      status: controller.signal.aborted
        ? 'timeout'
        : error instanceof SyntaxError
          ? 'unavailable'
          : 'network',
    }
  } finally {
    clearTimeout(timer)
  }
}

// Treat wire data as unknown, including cached/older Edge responses.
export function validateOffResult(
  value: unknown,
  expectedCode: string,
): OffResult {
  const unavailable: OffResult = { status: 'unavailable' }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('status' in value) ||
    typeof value.status !== 'string'
  )
    return unavailable
  if (value.status === 'found' || value.status === 'incomplete') {
    if (
      !('proposal' in value) ||
      !value.proposal ||
      typeof value.proposal !== 'object' ||
      Array.isArray(value.proposal)
    )
      return unavailable
    const p = value.proposal as Record<string, unknown>
    for (const key of [
      'name',
      'brand',
      'label',
      'quantity',
      'unit',
      'barcode',
      'sourceRef',
    ])
      if (typeof p[key] !== 'string') return unavailable
    const proposal = p as Proposal
    if (
      proposal.name.length > 160 ||
      proposal.brand.length > 120 ||
      proposal.label.length > 120 ||
      canonicalCode(proposal.barcode) !== canonicalCode(expectedCode) ||
      proposal.sourceRef !==
        `https://world.openfoodfacts.org/product/${canonicalCode(expectedCode)}` ||
      (proposal.quantity !== '' &&
        (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(proposal.quantity) ||
          Number(proposal.quantity) <= 0)) ||
      !['', 'g', 'kg', 'ml', 'l'].includes(proposal.unit) ||
      Boolean(proposal.quantity) !== Boolean(proposal.unit)
    )
      return unavailable
    if (
      value.status === 'found' &&
      (!proposal.name.trim() ||
        !proposal.brand.trim() ||
        !proposal.label.trim())
    )
      return unavailable
    return {
      status: value.status,
      proposal: {
        name: proposal.name,
        brand: proposal.brand,
        label: proposal.label,
        quantity: proposal.quantity,
        unit: proposal.unit,
        barcode: proposal.barcode,
        sourceRef: proposal.sourceRef,
      },
    }
  }
  if (
    !['absent', 'unavailable', 'network', 'timeout', 'limited'].includes(
      String(value.status),
    )
  )
    return unavailable
  if (
    'retryAfter' in value &&
    (typeof value.retryAfter !== 'number' ||
      !Number.isFinite(value.retryAfter) ||
      value.retryAfter < 0 ||
      value.retryAfter > 86400)
  )
    return unavailable
  return {
    status: value.status as
      'absent' | 'unavailable' | 'network' | 'timeout' | 'limited',
    ...('retryAfter' in value
      ? { retryAfter: value.retryAfter as number }
      : {}),
  }
}
