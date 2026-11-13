// DHL Express (MyDHL API), UPS and FedEx, called directly over their REST
// APIs as the plan says; no SDKs and no middlemen. Each carrier gets: live
// rates, buying a label, and tracking. Logins come only from the server's
// environment settings.
//
// International parcels are sent "duties paid by the receiver" (DAP): the
// owner's decision of 2026-10-29. Each carrier is told so in its own words.

import { randomUUID } from 'node:crypto';
import type { Parcel } from './parcel.js';

export type CarrierCode = 'dhl' | 'ups' | 'fedex';
export type TrackingStatus = 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'returned';

export class CarrierError extends Error {
  override name = 'CarrierError';
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface Address {
  name: string;
  company?: string | null;
  phone: string;
  email?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  /** State or province. Carriers want a code for some countries (US, CA); a name is sent otherwise. */
  region?: string | null;
  postalCode?: string | null;
  /** Two letters, such as NG, GB, US. */
  country: string;
}

export interface CustomsItem {
  description: string;
  hsCode: string | null;
  quantity: number;
  /** Value of one, in major units of `currency` (for example 120.50). */
  unitValue: number;
  weightGrams: number;
  originCountry: string;
}

export interface Customs {
  currency: string;
  items: CustomsItem[];
  invoiceNumber: string;
}

export interface RateRequest {
  from: Address;
  to: Address;
  parcels: Parcel[];
  shipDate: Date;
  /** Only for parcels leaving the country. */
  customs: Customs | null;
}

export interface Rate {
  serviceCode: string;
  serviceName: string;
  /** In major units of `currency`, as the carrier quoted it. */
  amount: number;
  currency: string;
  /** Working days on the way, when the carrier says. */
  transitDays: number | null;
  /** Expected delivery day (YYYY-MM-DD), when the carrier says. */
  deliveryDate: string | null;
}

export interface Label {
  trackingNumber: string;
  /** Data of the label file, base64. */
  data: string;
  format: 'pdf' | 'gif' | 'png' | 'zpl';
}

export interface ShipmentResult {
  carrierShipmentId: string;
  trackingNumber: string;
  trackingUrl: string;
  labels: Label[];
  cost: { amount: number; currency: string } | null;
}

export interface TrackingEvent {
  status: TrackingStatus;
  description: string;
  location: string | null;
  occurredAt: Date;
  raw: unknown;
}

export interface Carrier {
  code: CarrierCode;
  name: string;
  configured: boolean;
  /** "test" when pointed at the carrier's test address. */
  mode: 'test' | 'live' | null;
  rates(input: RateRequest): Promise<Rate[]>;
  ship(input: RateRequest & { serviceCode: string; reference: string }): Promise<ShipmentResult>;
  track(trackingNumber: string): Promise<{ status: TrackingStatus | null; events: TrackingEvent[] }>;
}

export function trackingUrl(carrier: CarrierCode, trackingNumber: string): string {
  const n = encodeURIComponent(trackingNumber);
  if (carrier === 'dhl') return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`;
  if (carrier === 'ups') return `https://www.ups.com/track?tracknum=${n}`;
  return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
}

// ----- shared helpers -----

async function call(url: string, init: RequestInit, label: string): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new CarrierError(`${label} could not be reached (${error instanceof Error ? error.message : 'no answer'})`);
  }
  const text = await response.text();
  let body: Record<string, any> = {};
  try {
    body = JSON.parse(text) as Record<string, any>;
  } catch {
    // handled below
  }
  if (!response.ok) {
    const message =
      body?.detail ?? body?.message ?? body?.errors?.[0]?.message ?? body?.response?.errors?.[0]?.message ?? body?.title ?? text.slice(0, 200);
    throw new CarrierError(`${label} refused the request: ${String(message)}`, response.status);
  }
  return body;
}

/** Some carriers answer with one object where several are possible. */
const list = <T>(value: T | T[] | undefined | null): T[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const kg = (grams: number): number => Math.max(0.1, Math.round(grams / 100) / 10);
const cm = (mm: number): number => Math.max(1, Math.ceil(mm / 10));
const day = (date: Date): string => date.toISOString().slice(0, 10);
const money = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new CarrierError(`The carrier gave a price we cannot read (${String(value)})`);
  return n;
};
const lines = (a: Address): string[] => [a.line1, a.line2 ?? ''].map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 45));
const customsTotal = (c: Customs): number => Math.round(c.items.reduce((sum, i) => sum + i.unitValue * i.quantity, 0) * 100) / 100;
const testAddress = (url: string, words: string[]): boolean => words.some((w) => url.includes(w));

/** An access token per carrier, kept until shortly before it runs out. */
function tokenCache(fetchToken: () => Promise<{ token: string; seconds: number }>): () => Promise<string> {
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && cached.until > Date.now()) return cached.token;
    const fresh = await fetchToken();
    cached = { token: fresh.token, until: Date.now() + Math.max(60, fresh.seconds - 120) * 1000 };
    return fresh.token;
  };
}

// ----- DHL Express (MyDHL API) -----

/** DHL's checkpoint codes that matter to a customer. Anything else is "on the way". */
function dhlStatus(code: string): TrackingStatus {
  if (code === 'OK') return 'delivered';
  if (code === 'WC') return 'out_for_delivery';
  if (code === 'RT' || code === 'RD') return 'returned';
  if (['BA', 'CA', 'CM', 'HP', 'MS', 'NH', 'OH', 'RD', 'SS', 'UD', 'CD'].includes(code)) return 'exception';
  return 'in_transit';
}

export function dhl(options: { apiKey: string; apiSecret: string; accountNumber: string; apiUrl: string }): Carrier {
  const configured = options.apiKey !== '' && options.apiSecret !== '' && options.accountNumber !== '';
  const headers = { Authorization: `Basic ${Buffer.from(`${options.apiKey}:${options.apiSecret}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  const need = (): void => {
    if (!configured) throw new CarrierError('DHL is not set up: DHL_API_KEY, DHL_API_SECRET and DHL_ACCOUNT_NUMBER are needed');
  };
  // MyDHL wants the shipping time with its offset, written its own way.
  const when = (date: Date): string => `${date.toISOString().slice(0, 19)} GMT+00:00`;
  const place = (a: Address): Record<string, unknown> => ({
    postalCode: a.postalCode ?? '',
    cityName: a.city,
    countryCode: a.country,
    addressLine1: lines(a)[0] ?? '',
    ...(lines(a)[1] ? { addressLine2: lines(a)[1] } : {}),
    ...(a.region ? { countyName: a.region } : {}),
  });
  const contact = (a: Address): Record<string, unknown> => ({ fullName: a.name, companyName: a.company || a.name, phone: a.phone, ...(a.email ? { email: a.email } : {}) });
  const packages = (input: RateRequest): unknown[] =>
    input.parcels.map((p) => ({ weight: kg(p.weightGrams), dimensions: { length: cm(p.lengthMm), width: cm(p.widthMm), height: cm(p.heightMm) } }));
  return {
    code: 'dhl',
    name: 'DHL Express',
    configured,
    mode: !configured ? null : testAddress(options.apiUrl, ['/test', 'sandbox']) ? 'test' : 'live',
    async rates(input) {
      need();
      const body = await call(`${options.apiUrl}/rates`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          customerDetails: { shipperDetails: place(input.from), receiverDetails: place(input.to) },
          accounts: [{ typeCode: 'shipper', number: options.accountNumber }],
          plannedShippingDateAndTime: when(input.shipDate),
          unitOfMeasurement: 'metric',
          isCustomsDeclarable: input.customs !== null,
          ...(input.customs ? { monetaryAmount: [{ typeCode: 'declaredValue', value: customsTotal(input.customs), currency: input.customs.currency }] } : {}),
          packages: packages(input),
        }),
      }, 'DHL');
      return list(body.products as Array<Record<string, any>>).flatMap((p): Rate[] => {
        // BILLC is the price in our account's billing currency: what we pay.
        const price = list(p.totalPrice as Array<Record<string, any>>).find((t) => t.currencyType === 'BILLC') ?? list(p.totalPrice as Array<Record<string, any>>)[0];
        if (!price || !price.priceCurrency) return [];
        const eta = String(p.deliveryCapabilities?.estimatedDeliveryDateAndTime ?? '');
        const days = Number(p.deliveryCapabilities?.totalTransitDays);
        return [{ serviceCode: String(p.productCode), serviceName: String(p.productName ?? p.productCode), amount: money(price.price), currency: String(price.priceCurrency).toUpperCase(), transitDays: Number.isFinite(days) && days > 0 ? days : null, deliveryDate: /^\d{4}-\d{2}-\d{2}/.test(eta) ? eta.slice(0, 10) : null }];
      });
    },
    async ship(input) {
      need();
      const c = input.customs;
      const body = await call(`${options.apiUrl}/shipments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          plannedShippingDateAndTime: when(input.shipDate),
          pickup: { isRequested: false },
          productCode: input.serviceCode,
          accounts: [{ typeCode: 'shipper', number: options.accountNumber }],
          customerReferences: [{ value: input.reference, typeCode: 'CU' }],
          outputImageProperties: { encodingFormat: 'pdf', imageOptions: [{ typeCode: 'label', templateName: 'ECOM26_84_001' }] },
          customerDetails: {
            shipperDetails: { postalAddress: place(input.from), contactInformation: contact(input.from) },
            receiverDetails: { postalAddress: place(input.to), contactInformation: contact(input.to) },
          },
          content: {
            packages: packages(input),
            isCustomsDeclarable: c !== null,
            description: 'Human hair products',
            unitOfMeasurement: 'metric',
            ...(c
              ? {
                  declaredValue: customsTotal(c),
                  declaredValueCurrency: c.currency,
                  // Delivered at place: the receiver pays duties and taxes.
                  incoterm: 'DAP',
                  exportDeclaration: {
                    invoice: { number: c.invoiceNumber, date: day(input.shipDate) },
                    lineItems: c.items.map((item, k) => ({
                      number: k + 1,
                      description: item.description.slice(0, 70),
                      price: item.unitValue,
                      quantity: { value: item.quantity, unitOfMeasurement: 'PCS' },
                      ...(item.hsCode ? { commodityCodes: [{ typeCode: 'outbound', value: item.hsCode }] } : {}),
                      exportReasonType: 'permanent',
                      manufacturerCountry: item.originCountry,
                      weight: { netValue: kg(item.weightGrams * item.quantity), grossValue: kg(item.weightGrams * item.quantity) },
                    })),
                  },
                }
              : {}),
          },
        }),
      }, 'DHL');
      const tracking = String(body.shipmentTrackingNumber ?? '');
      if (!tracking) throw new CarrierError('DHL did not return a tracking number');
      const charge = list(body.shipmentCharges as Array<Record<string, any>>).find((t) => t.currencyType === 'BILLC');
      const labels = list(body.documents as Array<Record<string, any>>)
        .filter((d) => d.typeCode === 'label' && d.content)
        .map((d, k): Label => ({ trackingNumber: String(body.packages?.[k]?.trackingNumber ?? tracking), data: String(d.content), format: 'pdf' }));
      if (labels.length === 0) throw new CarrierError('DHL did not return a label');
      return { carrierShipmentId: tracking, trackingNumber: tracking, trackingUrl: String(body.trackingUrl ?? trackingUrl('dhl', tracking)), labels, cost: charge ? { amount: money(charge.price), currency: String(charge.priceCurrency).toUpperCase() } : null };
    },
    async track(trackingNumber) {
      need();
      const body = await call(`${options.apiUrl}/shipments/${encodeURIComponent(trackingNumber)}/tracking?trackingView=all-checkpoints&levelOfDetail=all`, { method: 'GET', headers }, 'DHL');
      const shipment = list(body.shipments as Array<Record<string, any>>)[0] ?? {};
      const events = list(shipment.events as Array<Record<string, any>>).flatMap((e): TrackingEvent[] => {
        const at = new Date(`${String(e.date)}T${String(e.time ?? '00:00:00')}${typeof e.GMTOffset === 'string' ? e.GMTOffset : 'Z'}`);
        if (Number.isNaN(at.getTime())) return [];
        return [{ status: dhlStatus(String(e.typeCode ?? '')), description: String(e.description ?? ''), location: list(e.serviceArea as Array<Record<string, any>>)[0]?.description ?? null, occurredAt: at, raw: e }];
      });
      events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      const delivered = String(shipment.status ?? '').toLowerCase() === 'delivered';
      return { status: delivered ? 'delivered' : (events[events.length - 1]?.status ?? null), events };
    },
  };
}

// ----- UPS -----

/** What UPS's service codes mean, in the words shown at checkout. */
export const UPS_SERVICES: Record<string, string> = {
  '07': 'UPS Worldwide Express',
  '08': 'UPS Worldwide Expedited',
  '11': 'UPS Standard',
  '54': 'UPS Worldwide Express Plus',
  '65': 'UPS Worldwide Saver',
  '01': 'UPS Next Day Air',
  '02': 'UPS 2nd Day Air',
  '03': 'UPS Ground',
};

/** UPS's activity types: D delivered, X exception, I in transit, P pickup, M manifest. */
function upsStatus(type: string, description: string): TrackingStatus {
  if (type === 'D') return 'delivered';
  if (type === 'X') return 'exception';
  if (type === 'RS') return 'returned';
  if (/out for delivery/i.test(description)) return 'out_for_delivery';
  return 'in_transit';
}

const UPS_VERSION = 'v2409';

export function ups(options: { clientId: string; clientSecret: string; accountNumber: string; apiUrl: string }): Carrier {
  const configured = options.clientId !== '' && options.clientSecret !== '' && options.accountNumber !== '';
  const need = (): void => {
    if (!configured) throw new CarrierError('UPS is not set up: UPS_CLIENT_ID, UPS_CLIENT_SECRET and UPS_ACCOUNT_NUMBER are needed');
  };
  const token = tokenCache(async () => {
    const body = await call(`${options.apiUrl}/security/v1/oauth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', 'x-merchant-id': options.accountNumber },
      body: 'grant_type=client_credentials',
    }, 'UPS');
    if (!body.access_token) throw new CarrierError('UPS did not give an access token');
    return { token: String(body.access_token), seconds: Number(body.expires_in) || 3600 };
  });
  const headers = async (): Promise<Record<string, string>> => ({ Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', transId: randomUUID().replace(/-/g, '').slice(0, 32), transactionSrc: 'hairbydemj' });
  const address = (a: Address): Record<string, unknown> => ({ AddressLine: lines(a), City: a.city, ...(a.region ? { StateProvinceCode: a.region.slice(0, 5) } : {}), ...(a.postalCode ? { PostalCode: a.postalCode } : {}), CountryCode: a.country });
  const party = (a: Address): Record<string, unknown> => ({ Name: (a.company || a.name).slice(0, 35), AttentionName: a.name.slice(0, 35), Phone: { Number: a.phone.replace(/[^0-9+]/g, '').slice(0, 15) }, ...(a.email ? { EMailAddress: a.email } : {}), Address: address(a) });
  const packages = (input: RateRequest, key: 'PackagingType' | 'Packaging'): unknown[] =>
    input.parcels.map((p) => ({
      [key]: { Code: '02' },
      Dimensions: { UnitOfMeasurement: { Code: 'CM' }, Length: String(cm(p.lengthMm)), Width: String(cm(p.widthMm)), Height: String(cm(p.heightMm)) },
      PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: String(kg(p.weightGrams)) },
    }));
  const billShipper = { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: options.accountNumber } }] };
  return {
    code: 'ups',
    name: 'UPS',
    configured,
    mode: !configured ? null : testAddress(options.apiUrl, ['wwwcie.', 'sandbox']) ? 'test' : 'live',
    async rates(input) {
      need();
      const c = input.customs;
      const body = await call(`${options.apiUrl}/api/rating/${UPS_VERSION}/Shoptimeintransit`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({
          RateRequest: {
            Request: { RequestOption: 'Shoptimeintransit' },
            Shipment: {
              Shipper: { ...party(input.from), ShipperNumber: options.accountNumber },
              ShipFrom: party(input.from),
              ShipTo: party(input.to),
              PaymentDetails: billShipper,
              ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
              DeliveryTimeInformation: { PackageBillType: '03', Pickup: { Date: day(input.shipDate).replace(/-/g, '') } },
              ...(c ? { InvoiceLineTotal: { CurrencyCode: c.currency, MonetaryValue: customsTotal(c).toFixed(2) } } : {}),
              ShipmentTotalWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: String(kg(input.parcels.reduce((s, p) => s + p.weightGrams, 0))) },
              Package: packages(input, 'PackagingType'),
            },
          },
        }),
      }, 'UPS');
      return list(body.RateResponse?.RatedShipment as Array<Record<string, any>>).flatMap((r): Rate[] => {
        const code = String(r.Service?.Code ?? '');
        // Our account's own (negotiated) price when UPS gives one.
        const charge = r.NegotiatedRateCharges?.TotalCharge ?? r.TotalCharges;
        if (!code || !charge?.CurrencyCode) return [];
        const arrival = r.TimeInTransit?.ServiceSummary?.EstimatedArrival;
        const days = Number(arrival?.BusinessDaysInTransit ?? r.GuaranteedDelivery?.BusinessDaysInTransit);
        const date = String(arrival?.Arrival?.Date ?? '');
        return [{ serviceCode: code, serviceName: UPS_SERVICES[code] ?? `UPS service ${code}`, amount: money(charge.MonetaryValue), currency: String(charge.CurrencyCode).toUpperCase(), transitDays: Number.isFinite(days) && days > 0 ? days : null, deliveryDate: /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : null }];
      });
    },
    async ship(input) {
      need();
      const c = input.customs;
      const body = await call(`${options.apiUrl}/api/shipments/${UPS_VERSION}/ship`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({
          ShipmentRequest: {
            Request: { RequestOption: 'nonvalidate' },
            Shipment: {
              Description: 'Human hair products',
              Shipper: { ...party(input.from), ShipperNumber: options.accountNumber },
              ShipFrom: party(input.from),
              ShipTo: party(input.to),
              // Only the transport is billed to us; duties and taxes stay with the receiver.
              PaymentInformation: billShipper,
              Service: { Code: input.serviceCode },
              ReferenceNumber: { Value: input.reference },
              ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
              Package: packages(input, 'Packaging'),
              ...(c
                ? {
                    ShipmentServiceOptions: {
                      InternationalForms: {
                        FormType: '01',
                        InvoiceNumber: c.invoiceNumber,
                        InvoiceDate: day(input.shipDate).replace(/-/g, ''),
                        ReasonForExport: 'SALE',
                        TermsOfShipment: 'DAP',
                        CurrencyCode: c.currency,
                        Product: c.items.map((item) => ({
                          Description: item.description.slice(0, 35),
                          Unit: { Number: String(item.quantity), Value: item.unitValue.toFixed(2), UnitOfMeasurement: { Code: 'PCS' } },
                          ...(item.hsCode ? { CommodityCode: item.hsCode } : {}),
                          OriginCountryCode: item.originCountry,
                        })),
                      },
                    },
                  }
                : {}),
            },
            LabelSpecification: { LabelImageFormat: { Code: 'GIF' }, LabelStockSize: { Height: '6', Width: '4' } },
          },
        }),
      }, 'UPS');
      const results = body.ShipmentResponse?.ShipmentResults ?? {};
      const labels = list(results.PackageResults as Array<Record<string, any>>)
        .filter((p) => p.TrackingNumber && p.ShippingLabel?.GraphicImage)
        .map((p): Label => ({ trackingNumber: String(p.TrackingNumber), data: String(p.ShippingLabel.GraphicImage), format: String(p.ShippingLabel.ImageFormat?.Code ?? 'GIF').toLowerCase() === 'png' ? 'png' : 'gif' }));
      const first = labels[0];
      if (!first) throw new CarrierError('UPS did not return a label');
      const charge = results.NegotiatedRateCharges?.TotalCharge ?? results.ShipmentCharges?.TotalCharges;
      return { carrierShipmentId: String(results.ShipmentIdentificationNumber ?? first.trackingNumber), trackingNumber: first.trackingNumber, trackingUrl: trackingUrl('ups', first.trackingNumber), labels, cost: charge?.CurrencyCode ? { amount: money(charge.MonetaryValue), currency: String(charge.CurrencyCode).toUpperCase() } : null };
    },
    async track(trackingNumber) {
      need();
      const body = await call(`${options.apiUrl}/api/track/v1/details/${encodeURIComponent(trackingNumber)}?locale=en_US&returnSignature=false`, { method: 'GET', headers: await headers() }, 'UPS');
      const pkg = list(list(body.trackResponse?.shipment as Array<Record<string, any>>)[0]?.package as Array<Record<string, any>>)[0] ?? {};
      const events = list(pkg.activity as Array<Record<string, any>>).flatMap((a): TrackingEvent[] => {
        const d = String(a.date ?? '');
        const t = String(a.time ?? '000000').padStart(6, '0');
        const at = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`);
        if (Number.isNaN(at.getTime())) return [];
        const where = a.location?.address;
        const description = String(a.status?.description ?? '');
        return [{ status: upsStatus(String(a.status?.type ?? ''), description), description, location: where ? [where.city, where.countryCode].filter(Boolean).join(', ') || null : null, occurredAt: at, raw: a }];
      });
      events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      return { status: events[events.length - 1]?.status ?? null, events };
    },
  };
}

// ----- FedEx -----

/** FedEx's status codes: DL delivered, OD out for delivery, DE/SE/CA problems, RS returned. */
function fedexStatus(code: string): TrackingStatus {
  if (code === 'DL') return 'delivered';
  if (code === 'OD') return 'out_for_delivery';
  if (code === 'RS' || code === 'RP') return 'returned';
  if (['DE', 'SE', 'CA', 'DY', 'CD'].includes(code)) return 'exception';
  return 'in_transit';
}

const FEDEX_SERVICES: Record<string, string> = {
  INTERNATIONAL_PRIORITY: 'FedEx International Priority',
  INTERNATIONAL_ECONOMY: 'FedEx International Economy',
  FEDEX_INTERNATIONAL_PRIORITY: 'FedEx International Priority',
  FEDEX_INTERNATIONAL_PRIORITY_EXPRESS: 'FedEx International Priority Express',
  INTERNATIONAL_FIRST: 'FedEx International First',
  FEDEX_INTERNATIONAL_CONNECT_PLUS: 'FedEx International Connect Plus',
};

export function fedex(options: { apiKey: string; secretKey: string; accountNumber: string; apiUrl: string }): Carrier {
  const configured = options.apiKey !== '' && options.secretKey !== '' && options.accountNumber !== '';
  const need = (): void => {
    if (!configured) throw new CarrierError('FedEx is not set up: FEDEX_API_KEY, FEDEX_SECRET_KEY and FEDEX_ACCOUNT_NUMBER are needed');
  };
  const token = tokenCache(async () => {
    const body = await call(`${options.apiUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: options.apiKey, client_secret: options.secretKey }).toString(),
    }, 'FedEx');
    if (!body.access_token) throw new CarrierError('FedEx did not give an access token');
    return { token: String(body.access_token), seconds: Number(body.expires_in) || 3600 };
  });
  const headers = async (): Promise<Record<string, string>> => ({ Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', 'X-locale': 'en_US' });
  const address = (a: Address): Record<string, unknown> => ({ streetLines: lines(a), city: a.city, ...(a.region && a.region.length <= 3 ? { stateOrProvinceCode: a.region } : {}), ...(a.postalCode ? { postalCode: a.postalCode } : {}), countryCode: a.country });
  const party = (a: Address): Record<string, unknown> => ({ contact: { personName: a.name, phoneNumber: a.phone.replace(/[^0-9]/g, '').slice(0, 15), ...(a.company ? { companyName: a.company } : {}), ...(a.email ? { emailAddress: a.email } : {}) }, address: address(a) });
  const packages = (input: RateRequest): unknown[] =>
    input.parcels.map((p, k) => ({ sequenceNumber: k + 1, weight: { units: 'KG', value: kg(p.weightGrams) }, dimensions: { length: cm(p.lengthMm), width: cm(p.widthMm), height: cm(p.heightMm), units: 'CM' } }));
  const customs = (c: Customs): Record<string, unknown> => ({
    // Duties and taxes are the receiver's to pay.
    dutiesPayment: { paymentType: 'RECIPIENT' },
    isDocumentOnly: false,
    totalCustomsValue: { amount: customsTotal(c), currency: c.currency },
    commercialInvoice: { shipmentPurpose: 'SOLD', termsOfSale: 'DAP', customerReferences: [{ customerReferenceType: 'INVOICE_NUMBER', value: c.invoiceNumber }] },
    commodities: c.items.map((item) => ({
      description: item.description.slice(0, 450),
      quantity: item.quantity,
      quantityUnits: 'PCS',
      weight: { units: 'KG', value: kg(item.weightGrams * item.quantity) },
      unitPrice: { amount: item.unitValue, currency: c.currency },
      customsValue: { amount: Math.round(item.unitValue * item.quantity * 100) / 100, currency: c.currency },
      countryOfManufacture: item.originCountry,
      ...(item.hsCode ? { harmonizedCode: item.hsCode } : {}),
    })),
  });
  return {
    code: 'fedex',
    name: 'FedEx',
    configured,
    mode: !configured ? null : testAddress(options.apiUrl, ['sandbox']) ? 'test' : 'live',
    async rates(input) {
      need();
      const body = await call(`${options.apiUrl}/rate/v1/rates/quotes`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({
          accountNumber: { value: options.accountNumber },
          rateRequestControlParameters: { returnTransitTimes: true },
          requestedShipment: {
            shipper: { address: address(input.from) },
            recipient: { address: address(input.to) },
            shipDateStamp: day(input.shipDate),
            pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
            rateRequestType: ['ACCOUNT'],
            ...(input.customs ? { customsClearanceDetail: customs(input.customs) } : {}),
            requestedPackageLineItems: packages(input),
          },
        }),
      }, 'FedEx');
      return list(body.output?.rateReplyDetails as Array<Record<string, any>>).flatMap((r): Rate[] => {
        const details = list(r.ratedShipmentDetails as Array<Record<string, any>>);
        const price = details.find((d) => d.rateType === 'ACCOUNT') ?? details[0];
        if (!price || !price.currency) return [];
        const code = String(r.serviceType ?? '');
        const eta = String(r.commit?.dateDetail?.dayFormat ?? r.operationalDetail?.deliveryDate ?? '');
        const words: Record<string, number> = { ONE_DAY: 1, TWO_DAYS: 2, THREE_DAYS: 3, FOUR_DAYS: 4, FIVE_DAYS: 5, SIX_DAYS: 6, SEVEN_DAYS: 7, EIGHT_DAYS: 8, NINE_DAYS: 9, TEN_DAYS: 10 };
        const days = words[String(r.operationalDetail?.transitTime ?? r.commit?.transitDays?.minimumTransitTime ?? '')] ?? null;
        return [{ serviceCode: code, serviceName: String(r.serviceName ?? FEDEX_SERVICES[code] ?? code), amount: money(price.totalNetCharge), currency: String(price.currency).toUpperCase(), transitDays: days, deliveryDate: /^\d{4}-\d{2}-\d{2}/.test(eta) ? eta.slice(0, 10) : null }];
      });
    },
    async ship(input) {
      need();
      const body = await call(`${options.apiUrl}/ship/v1/shipments`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({
          labelResponseOptions: 'LABEL',
          accountNumber: { value: options.accountNumber },
          requestedShipment: {
            shipper: party(input.from),
            recipients: [party(input.to)],
            shipDatestamp: day(input.shipDate),
            serviceType: input.serviceCode,
            packagingType: 'YOUR_PACKAGING',
            pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
            shippingChargesPayment: { paymentType: 'SENDER', payor: { responsibleParty: { accountNumber: { value: options.accountNumber } } } },
            labelSpecification: { imageType: 'PDF', labelStockType: 'PAPER_4X6' },
            ...(input.customs ? { customsClearanceDetail: customs(input.customs) } : {}),
            requestedPackageLineItems: packages(input).map((p) => ({ ...(p as object), customerReferences: [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: input.reference }] })),
          },
        }),
      }, 'FedEx');
      const shipment = list(body.output?.transactionShipments as Array<Record<string, any>>)[0] ?? {};
      const labels = list(shipment.pieceResponses as Array<Record<string, any>>).flatMap((piece) =>
        list(piece.packageDocuments as Array<Record<string, any>>)
          .filter((d) => d.encodedLabel)
          .map((d): Label => ({ trackingNumber: String(piece.trackingNumber ?? shipment.masterTrackingNumber), data: String(d.encodedLabel), format: String(d.docType ?? 'PDF').toLowerCase() === 'zpl' ? 'zpl' : 'pdf' })),
      );
      const tracking = String(shipment.masterTrackingNumber ?? labels[0]?.trackingNumber ?? '');
      if (!tracking || labels.length === 0) throw new CarrierError('FedEx did not return a label');
      const rate = list(shipment.completedShipmentDetail?.shipmentRating?.shipmentRateDetails as Array<Record<string, any>>)[0];
      return { carrierShipmentId: tracking, trackingNumber: tracking, trackingUrl: trackingUrl('fedex', tracking), labels, cost: rate?.currency ? { amount: money(rate.totalNetCharge), currency: String(rate.currency).toUpperCase() } : null };
    },
    async track(trackingNumber) {
      need();
      const body = await call(`${options.apiUrl}/track/v1/trackingnumbers`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] }),
      }, 'FedEx');
      const result = list(list(body.output?.completeTrackResults as Array<Record<string, any>>)[0]?.trackResults as Array<Record<string, any>>)[0] ?? {};
      const events = list(result.scanEvents as Array<Record<string, any>>).flatMap((e): TrackingEvent[] => {
        const at = new Date(String(e.date ?? ''));
        if (Number.isNaN(at.getTime())) return [];
        const where = e.scanLocation;
        return [{ status: fedexStatus(String(e.derivedStatusCode ?? e.eventType ?? '')), description: String(e.eventDescription ?? ''), location: where ? [where.city, where.countryCode].filter(Boolean).join(', ') || null : null, occurredAt: at, raw: e }];
      });
      events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      const latest = String(result.latestStatusDetail?.code ?? '');
      return { status: latest ? fedexStatus(latest) : (events[events.length - 1]?.status ?? null), events };
    },
  };
}
