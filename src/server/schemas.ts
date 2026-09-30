import { z } from "zod";

export const uuid = z.string().uuid();
export const money = z.number().int().min(0);
export const bps = z.number().int().min(0).max(100000);
export const pin = z.string().regex(/^\d{4,6}$/, "PIN de 4 à 6 chiffres");

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1), establishmentId: uuid.optional() });
export const signupSchema = z.object({
  organizationName: z.string().min(2).max(80), establishmentName: z.string().min(2).max(80), email: z.string().email(), password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(60), lastName: z.string().min(1).max(60),
});
export const pinLoginSchema = z.object({ pin });
export const terminalRegisterSchema = z.object({ name: z.string().min(1).max(60), kind: z.enum(["POS", "KDS", "KIOSK", "MANAGER"]).default("POS") });

export const establishmentUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(), legalName: z.string().max(120).nullable().optional(), tahitiNumber: z.string().max(30).nullable().optional(),
  addressLine1: z.string().max(120).nullable().optional(), addressLine2: z.string().max(120).nullable().optional(), city: z.string().max(80).nullable().optional(),
  postalCode: z.string().max(10).nullable().optional(), island: z.string().max(60).nullable().optional(), phone: z.string().max(30).nullable().optional(),
  email: z.string().email().nullable().optional(), currency: z.enum(["XPF", "EUR", "USD", "NZD"]).optional(), timezone: z.string().max(60).optional(),
  tipsEnabled: z.boolean().optional(), tipPresetsBps: z.array(bps).max(6).optional(), openingHours: z.unknown().optional(), settings: z.record(z.string(), z.unknown()).optional(),
  onboardingStep: z.number().int().min(0).max(20).optional(), onboardingDone: z.boolean().optional(),
});
export const establishmentCreateSchema = z.object({ name: z.string().min(1).max(80), city: z.string().max(80).nullable().optional() });

export const membershipSchema = z.object({ establishmentId: uuid, roleId: uuid });
export const userCreateSchema = z.object({
  email: z.string().email(), password: z.string().min(8).max(128), firstName: z.string().min(1).max(60), lastName: z.string().min(1).max(60),
  displayName: z.string().max(40).nullable().optional(), color: z.string().max(20).nullable().optional(), pin: pin.nullable().optional(), memberships: z.array(membershipSchema).min(1),
});
export const userUpdateSchema = userCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export const roleSchema = z.object({ name: z.string().min(1).max(60), permissions: z.array(z.string()) });

export const taxRateSchema = z.object({ name: z.string().min(1).max(60), rateBps: bps, isDefault: z.boolean().optional(), isActive: z.boolean().optional() });
export const categorySchema = z.object({ name: z.string().min(1).max(60), color: z.string().max(20).optional(), parentId: uuid.nullable().optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional(), imageUrl: z.string().max(500).nullable().optional() });
export const variantSchema = z.object({ id: uuid.optional(), name: z.string().min(1).max(60), priceTtc: money, sku: z.string().max(60).nullable().optional() });
export const productSchema = z.object({
  name: z.string().min(1).max(120), description: z.string().max(1000).nullable().optional(), categoryId: uuid.nullable().optional(), taxRateId: uuid.nullable().optional(),
  kitchenStationId: uuid.nullable().optional(), imageUrl: z.string().max(500).nullable().optional(), color: z.string().max(20).nullable().optional(), priceTtc: money,
  costPrice: money.optional(), sku: z.string().max(60).nullable().optional(), barcode: z.string().max(60).nullable().optional(), isAvailable: z.boolean().optional(),
  availability: z.unknown().optional(), trackStock: z.boolean().optional(), stockQty: z.number().int().optional(), stockMin: z.number().int().optional(),
  sortOrder: z.number().int().optional(), isActive: z.boolean().optional(), variants: z.array(variantSchema).optional(), modifierGroupIds: z.array(uuid).optional(),
});
export const productUpdateSchema = productSchema.partial();
export const importRowSchema = z.object({ category: z.string().min(1), name: z.string().min(1), description: z.string().optional(), priceTtc: money, taxRateBps: bps.nullable().optional(), costPrice: money.optional(), sku: z.string().optional(), isAvailable: z.boolean().optional() });
export const modifierGroupSchema = z.object({
  name: z.string().min(1).max(60), minSelect: z.number().int().min(0), maxSelect: z.number().int().min(1).nullable(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional(),
  modifiers: z.array(z.object({ id: uuid.optional(), name: z.string().min(1).max(60), priceDelta: z.number().int(), isDefault: z.boolean().optional(), isAvailable: z.boolean().optional() })),
});
export const menuSchema = z.object({
  name: z.string().min(1).max(80), description: z.string().max(500).nullable().optional(), priceTtc: money, taxRateId: uuid.nullable().optional(), color: z.string().max(20).nullable().optional(),
  isActive: z.boolean().optional(), sortOrder: z.number().int().optional(),
  sections: z.array(z.object({ name: z.string().min(1).max(60), minSelect: z.number().int().min(0), maxSelect: z.number().int().min(1), items: z.array(z.object({ productId: uuid, supplement: z.number().int().min(0) })) })).min(1),
});
export const kitchenStationSchema = z.object({ name: z.string().min(1).max(40), color: z.string().max(20).optional(), warnAfterSec: z.number().int().min(0).optional(), alertAfterSec: z.number().int().min(0).optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().optional() });

export const roomSchema = z.object({ name: z.string().min(1).max(60), kind: z.enum(["INDOOR", "TERRACE", "BAR", "OTHER"]).optional(), sortOrder: z.number().int().optional(), width: z.number().int().min(200).max(5000).optional(), height: z.number().int().min(200).max(5000).optional() });
export const tableShape = z.enum(["ROUND", "SQUARE", "RECT"]);
export const tableSchema = z.object({ roomId: uuid, name: z.string().min(1).max(20), seats: z.number().int().min(1).max(50).optional(), shape: tableShape.optional(), x: z.number().int().optional(), y: z.number().int().optional(), width: z.number().int().min(40).max(600).optional(), height: z.number().int().min(40).max(600).optional(), rotation: z.number().int().optional() });
export const layoutSchema = z.object({ tables: z.array(z.object({ id: uuid, x: z.number().int(), y: z.number().int(), width: z.number().int().min(40).max(600), height: z.number().int().min(40).max(600), rotation: z.number().int(), shape: tableShape, seats: z.number().int().min(1).max(50), name: z.string().min(1).max(20) })) });
export const tableStateSchema = z.object({ state: z.enum(["FREE", "RESERVED", "TO_CLEAN"]) });

export const orderType = z.enum(["DINE_IN", "COUNTER", "TAKEAWAY", "DELIVERY", "ONLINE", "KIOSK"]);
export const orderCreateSchema = z.object({
  id: uuid.optional(), type: orderType.default("DINE_IN"), tableId: uuid.nullable().optional(), covers: z.number().int().min(1).max(200).optional(),
  customerName: z.string().max(80).nullable().optional(), notes: z.string().max(500).nullable().optional(),
  // Services pré-générés par le client (mode hors ligne) : ids connus avant la synchronisation
  courses: z.array(z.object({ id: uuid, name: z.string().min(1).max(40) })).min(1).max(10).optional(),
  openedAt: z.string().datetime().optional(),
});
export const orderUpdateSchema = z.object({ covers: z.number().int().min(1).max(200).optional(), customerName: z.string().max(80).nullable().optional(), notes: z.string().max(500).nullable().optional(), type: orderType.optional() });
const modifierSel = z.array(z.object({ modifierId: uuid, quantity: z.number().int().min(1).max(20).optional() })).optional();
export const addItemSchema = z.object({
  id: uuid.optional(), productId: uuid.optional(), menuId: uuid.optional(), variantId: uuid.nullable().optional(), quantity: z.number().int().min(1).max(200).optional(),
  courseId: uuid.nullable().optional(), seatNumber: z.number().int().min(1).max(200).nullable().optional(), notes: z.string().max(300).nullable().optional(), isUrgent: z.boolean().optional(),
  modifiers: modifierSel, menuSelections: z.array(z.object({ sectionId: uuid, productId: uuid, modifiers: modifierSel })).optional(),
}).refine((v) => !!v.productId || !!v.menuId, { message: "productId ou menuId requis" });
export const updateItemSchema = z.object({ quantity: z.number().int().min(1).max(200).optional(), seatNumber: z.number().int().min(1).max(200).nullable().optional(), notes: z.string().max(300).nullable().optional(), courseId: uuid.nullable().optional(), isUrgent: z.boolean().optional() });
export const removeItemSchema = z.object({ reason: z.string().max(200).nullable().optional(), managerPin: pin.optional() });
export const sendSchema = z.object({ courseId: uuid.nullable().optional(), all: z.boolean().optional() });
export const courseStatusSchema = z.object({ status: z.enum(["PENDING", "HOLD", "FIRE", "SERVED"]) });
// Cuisine (Phase 3)
export const kitchenListQuery = z.object({ stationId: uuid.optional(), includeDone: z.string().optional() });
export const kitchenTicketStatusSchema = z.object({ status: z.enum(["ACCEPTED", "IN_PROGRESS", "READY", "DONE"]) });
export const kitchenItemReadySchema = z.object({ ready: z.boolean() });
export const discountSchema = z.object({ amount: money.optional(), percentBps: bps.max(10000).optional(), reason: z.string().min(1).max(200), managerPin: pin.optional() });
export const cancelSchema = z.object({ reason: z.string().min(1).max(200), managerPin: pin.optional() });
export const transferSchema = z.object({ tableId: uuid });
export const paymentMethod = z.enum(["CASH", "CARD", "CHECK", "TRANSFER", "MEAL_VOUCHER", "COMPLIMENTARY", "OTHER"]);
export const paymentsSchema = z.object({
  payments: z.array(z.object({ id: uuid.optional(), method: paymentMethod, amount: z.number().int().min(1), tipAmount: money.optional(), tendered: money.optional(), reference: z.string().max(80).nullable().optional(), splitLabel: z.string().max(40).nullable().optional() })).min(1).max(20),
  managerPin: pin.optional(),
});
export const refundSchema = z.object({ amount: z.number().int().min(1), reason: z.string().min(1).max(200), managerPin: pin.optional() });

export const cashOpenSchema = z.object({ openingFloat: money, notes: z.string().max(300).nullable().optional() });
export const cashMovementSchema = z.object({ kind: z.enum(["PAY_IN", "PAY_OUT", "DEPOSIT", "CORRECTION"]), amount: z.number().int(), reason: z.string().min(1).max(200), managerPin: pin.optional() });
export const cashCloseSchema = z.object({ countedCash: money, notes: z.string().max(300).nullable().optional() });

export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Stock (Phase 4)
const qty = z.number().min(0).max(1_000_000);
export const ingredientSchema = z.object({ name: z.string().min(1).max(120), unit: z.string().min(1).max(12).optional(), stockMin: qty.optional(), avgCost: money.optional(), isCritical: z.boolean().optional(), isActive: z.boolean().optional() });
export const movementSchema = z.object({ ingredientId: uuid, kind: z.enum(["PURCHASE", "ADJUSTMENT", "LOSS", "BREAKAGE", "INTERNAL_USE"]), quantity: z.number().min(-1_000_000).max(1_000_000), unitCost: money.nullable().optional(), reason: z.string().max(200).nullable().optional() });
export const movementsQuery = z.object({ ingredientId: uuid.optional(), kind: z.enum(["SALE", "PURCHASE", "ADJUSTMENT", "LOSS", "BREAKAGE", "INTERNAL_USE", "INVENTORY"]).optional(), from: z.string().optional(), to: z.string().optional(), take: z.coerce.number().int().min(1).max(1000).optional() });
export const inventorySchema = z.object({ lines: z.array(z.object({ ingredientId: uuid, countedQty: qty })).min(1).max(500), reason: z.string().max(200).nullable().optional() });
export const recipeSchema = z.object({ lines: z.array(z.object({ ingredientId: uuid, quantity: z.number().min(0).max(100000) })).max(100), applyCost: z.boolean().optional() });
export const supplierSchema = z.object({ name: z.string().min(1).max(120), contactName: z.string().max(120).nullable().optional(), phone: z.string().max(40).nullable().optional(), email: z.string().email().max(160).nullable().optional().or(z.literal("")), address: z.string().max(300).nullable().optional(), notes: z.string().max(1000).nullable().optional(), isActive: z.boolean().optional() });
export const supplierProductSchema = z.object({ supplierId: uuid, ingredientId: uuid.nullable().optional(), productId: uuid.nullable().optional(), reference: z.string().max(60).nullable().optional(), name: z.string().min(1).max(160), packSize: z.number().positive().max(100000).optional(), lastPrice: money.optional() });
const poLine = z.object({ supplierProductId: uuid, quantity: qty, unitPrice: money.nullable().optional() });
export const purchaseOrderSchema = z.object({ supplierId: uuid, expectedAt: z.string().nullable().optional(), notes: z.string().max(1000).nullable().optional(), lines: z.array(poLine).min(1).max(200) });
export const purchaseOrderUpdateSchema = z.object({ expectedAt: z.string().nullable().optional(), notes: z.string().max(1000).nullable().optional(), lines: z.array(poLine).max(200).optional() });
export const receiveSchema = z.object({ lines: z.array(z.object({ lineId: uuid, receivedQty: qty })).min(1) });
export const stockReportQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

// Personnel (Phase 5)
export const employeeSchema = z.object({ userId: uuid.nullable().optional(), firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), jobTitle: z.string().max(80).nullable().optional(), hourlyCost: money.nullable().optional(), pin: z.string().regex(/^\d{4,6}$/).nullable().optional(), isActive: z.boolean().optional() });
export const shiftSchema = z.object({ employeeId: uuid, startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), notes: z.string().max(200).nullable().optional() });
export const clockSchema = z.object({ pin: z.string().regex(/^\d{4,6}$/), kind: z.enum(["CLOCK_IN", "BREAK_START", "BREAK_END", "CLOCK_OUT"]) });
export const clockIdentifySchema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });
export const timeEntrySchema = z.object({ employeeId: uuid.optional(), kind: z.enum(["CLOCK_IN", "BREAK_START", "BREAK_END", "CLOCK_OUT"]).optional(), at: z.string().datetime({ offset: true }), reason: z.string().min(1).max(200) });
export const periodQuery = z.object({ from: daySchema, to: daySchema });
export const exportQuery = z.object({ type: z.enum(["period", "products", "orders", "staff", "accounting"]), format: z.enum(["csv", "xlsx", "pdf"]), from: daySchema, to: daySchema });

// Digital (Phase 6)
const modSel = z.array(z.object({ modifierId: uuid, quantity: z.number().int().min(1).max(20).optional() })).optional();
export const publicLineSchema = z.object({ id: uuid, productId: uuid.optional(), menuId: uuid.optional(), variantId: uuid.nullable().optional(), quantity: z.number().int().min(1).max(50), modifiers: modSel, menuSelections: z.array(z.object({ sectionId: uuid, productId: uuid, modifiers: modSel })).optional(), notes: z.string().max(200).nullable().optional() });
export const tableOrderSchema = z.object({ id: uuid, lines: z.array(publicLineSchema).min(1).max(60), covers: z.number().int().min(1).max(50).optional(), notes: z.string().max(300).nullable().optional() });
export const callWaiterSchema = z.object({ reason: z.string().max(120).nullable().optional() });
export const onlineOrderSchema = z.object({ id: uuid, mode: z.enum(["PICKUP", "DELIVERY"]), name: z.string().min(2).max(80), phone: z.string().min(6).max(30), email: z.string().email().max(160).nullable().optional().or(z.literal("")), when: z.string().max(40).nullable().optional(), address: z.string().max(300).nullable().optional(), zone: z.string().max(80).nullable().optional(), notes: z.string().max(300).nullable().optional(), lines: z.array(publicLineSchema).min(1).max(60), lang: z.enum(["fr", "en", "ty"]).optional() });
export const kioskOrderSchema = z.object({ id: uuid, mode: z.enum(["DINE_IN", "TAKEAWAY"]), name: z.string().max(40).nullable().optional(), lines: z.array(publicLineSchema).min(1).max(60), lang: z.enum(["fr", "en", "ty"]).optional() });
export const publicReservationSchema = z.object({ name: z.string().min(2).max(80), phone: z.string().min(6).max(30), email: z.string().email().max(160).nullable().optional().or(z.literal("")), startsAt: z.string().datetime({ offset: true }), partySize: z.number().int().min(1).max(50), notes: z.string().max(300).nullable().optional(), allergies: z.string().max(200).nullable().optional() });
export const reservationSchema = z.object({ name: z.string().min(1).max(80), phone: z.string().max(30).nullable().optional(), email: z.string().max(160).nullable().optional(), startsAt: z.string().datetime({ offset: true }), partySize: z.number().int().min(1).max(50), tableId: uuid.nullable().optional(), notes: z.string().max(300).nullable().optional(), allergies: z.string().max(200).nullable().optional(), status: z.enum(["PENDING", "CONFIRMED", "ARRIVED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(), customerId: uuid.nullable().optional() });
export const reservationStatusSchema = z.object({ status: z.enum(["PENDING", "CONFIRMED", "ARRIVED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"]), tableId: uuid.nullable().optional() });
export const customerSchema = z.object({ firstName: z.string().max(80).nullable().optional(), lastName: z.string().max(80).nullable().optional(), phone: z.string().max(30).nullable().optional(), email: z.string().email().max(160).nullable().optional().or(z.literal("")), notes: z.string().max(1000).nullable().optional(), allergies: z.string().max(300).nullable().optional() });
export const attachCustomerSchema = z.object({ customerId: uuid.nullable() });
export const redeemSchema = z.object({ rewards: z.number().int().min(1).max(10).optional() });
export const adjustPointsSchema = z.object({ points: z.number().int().min(-100000).max(100000), reason: z.string().min(1).max(200) });
export const rejectSchema = z.object({ reason: z.string().min(1).max(200) });
const httpUrl = z.string().max(500).refine((v) => v === "" || /^https?:\/\//.test(v), "Adresse web attendue (https://…)");
export const digitalSettingsSchema = z.object({
  qrMode: z.enum(["MENU", "MENU_CALL", "ORDER", "ORDER_DIRECT"]).optional(),
  online: z.object({ enabled: z.boolean(), pickup: z.boolean(), delivery: z.boolean(), pickupLeadMin: z.number().int().min(0).max(240), deliveryFee: money, deliveryMinOrder: money, deliveryZones: z.array(z.string().min(1).max(80)).max(50), message: z.string().max(300) }).partial().optional(),
  kiosk: z.object({ enabled: z.boolean(), dineIn: z.boolean(), takeaway: z.boolean() }).partial().optional(),
  loyalty: z.object({ enabled: z.boolean(), pointsPer100: z.number().int().min(0).max(100), rewardPoints: z.number().int().min(1).max(100000), rewardValue: money }).partial().optional(),
  site: z.object({ enabled: z.boolean(), tagline: z.string().max(120), description: z.string().max(2000), coverUrl: httpUrl, logoUrl: httpUrl, photos: z.array(httpUrl.pipe(z.string().min(1))).max(12), facebook: httpUrl, instagram: httpUrl, showMenu: z.boolean(), showPrices: z.boolean(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).partial().optional(),
});

// Avancé (Phase 7)
export const apiKeySchema = z.object({ name: z.string().min(1).max(80), scopes: z.array(z.string()).min(1).max(10) });
export const webhookSchema = z.object({ url: z.string().url().max(500), events: z.array(z.string()).min(1).max(20), description: z.string().max(200).nullable().optional(), isActive: z.boolean().optional() });
export const printerSchema = z.object({ name: z.string().min(1).max(60), kind: z.enum(["RECEIPT", "KITCHEN"]), driver: z.enum(["escpos-network", "agent", "browser"]), connection: z.object({ host: z.string().max(80).optional(), port: z.number().int().min(1).max(65535).optional(), agentUrl: z.string().max(300).optional(), timeoutMs: z.number().int().min(500).max(30000).optional() }).optional(), paperWidthMm: z.number().int().min(40).max(112).optional(), stationId: uuid.nullable().optional(), isActive: z.boolean().optional() });
export const printSchema = z.object({ printerId: uuid, kind: z.enum(["receipt", "kitchen", "test"]), orderId: uuid.optional(), ticketId: uuid.optional() });
export const terminalChargeSchema = z.object({ orderId: uuid, amount: z.number().int().min(1) });
export const terminalSettingsSchema = z.object({ adapter: z.enum(["manual", "bridge"]), url: z.string().url().max(300).optional().or(z.literal("")), apiKey: z.string().max(200).optional(), terminalId: z.string().max(80).optional(), timeoutMs: z.number().int().min(5000).max(300000).optional() });
export const copyCatalogSchema = z.object({ fromId: uuid, products: z.boolean().optional(), menus: z.boolean().optional() });
export const apiOrdersQuery = z.object({ from: daySchema.optional(), to: daySchema.optional(), status: z.string().optional(), take: z.coerce.number().int().min(1).max(500).optional(), skip: z.coerce.number().int().min(0).optional() });
