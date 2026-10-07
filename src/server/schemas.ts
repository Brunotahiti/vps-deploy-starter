import { z } from "zod";

export const uuid = z.string().uuid();
export const money = z.number().int().min(0);
export const bps = z.number().int().min(0).max(100000);
export const pin = z.string().regex(/^\d{4,6}$/, "PIN de 4 à 6 chiffres");

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1), establishmentId: uuid.optional() });
export const signupSchema = z.object({
  organizationName: z.string().min(2).max(80), establishmentName: z.string().min(2).max(80), email: z.string().email(), password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(60), lastName: z.string().min(1).max(60),
  businessType: z.enum(["snack", "restaurant", "bar"]).optional(),
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
  businessType: z.enum(["snack", "restaurant", "bar"]).optional(),
});
export const establishmentCreateSchema = z.object({ name: z.string().min(1).max(80), city: z.string().max(80).nullable().optional() });

export const membershipSchema = z.object({ establishmentId: uuid, roleId: uuid });
export const userCreateSchema = z.object({
  email: z.string().email(), password: z.string().min(8).max(128), firstName: z.string().min(1).max(60), lastName: z.string().min(1).max(60),
  displayName: z.string().max(40).nullable().optional(), color: z.string().max(20).nullable().optional(), pin: pin.nullable().optional(), memberships: z.array(membershipSchema).min(1),
});
export const userUpdateSchema = userCreateSchema.partial().extend({ isActive: z.boolean().optional(), currentPassword: z.string().max(200).optional() });
export const inviteSchema = z.object({ email: z.string().email(), firstName: z.string().min(1).max(60), lastName: z.string().min(1).max(60), color: z.string().max(20).nullable().optional(), memberships: z.array(membershipSchema).min(1) });
export const acceptInviteSchema = z.object({ password: z.string().min(8).max(128), pin: pin.nullable().optional() });
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
  imageUrl: z.string().max(500).nullable().optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().optional(),
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
  customerName: z.string().max(80).nullable().optional(), notes: z.string().max(500).nullable().optional(), tableLabel: z.string().max(20).nullable().optional(),
  customerPhone: z.string().max(30).nullable().optional(), pickupAt: z.string().datetime().nullable().optional(),
  // Services pré-générés par le client (mode hors ligne) : ids connus avant la synchronisation
  courses: z.array(z.object({ id: uuid, name: z.string().min(1).max(40) })).min(1).max(10).optional(),
  openedAt: z.string().datetime().optional(),
});
export const orderUpdateSchema = z.object({ covers: z.number().int().min(1).max(200).optional(), customerName: z.string().max(80).nullable().optional(), tableLabel: z.string().max(20).nullable().optional(), customerPhone: z.string().max(30).nullable().optional(), pickupAt: z.string().datetime().nullable().optional(), notes: z.string().max(500).nullable().optional(), type: orderType.optional() });
export const takeawayStepSchema = z.object({ step: z.enum(["ready", "not_ready", "picked_up"]) });
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
export const paymentMethod = z.enum(["CASH", "CARD", "CHECK", "TRANSFER", "MEAL_VOUCHER", "COMPLIMENTARY", "OTHER", "ACCOUNT", "GIFT_CARD"]);
export const paymentsSchema = z.object({
  payments: z.array(z.object({ id: uuid.optional(), method: paymentMethod, amount: z.number().int().min(1), tendered: money.optional(), reference: z.string().max(80).nullable().optional(), splitLabel: z.string().max(40).nullable().optional(), customerAccountId: uuid.nullable().optional(), giftCardCode: z.string().trim().max(20).nullable().optional() })).min(1).max(20),
  managerPin: pin.optional(),
});
export const refundSchema = z.object({ amount: z.number().int().min(1), reason: z.string().min(1).max(200), managerPin: pin.optional() });

export const cashOpenSchema = z.object({ id: z.string().uuid().optional(), openingFloat: money, notes: z.string().max(300).nullable().optional() }); // id : ouverture hors ligne (rejeu sans doublon)
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
// Période de rapport : début ≤ fin et au plus 13 mois (évite de charger tout l'historique d'un coup)
export const periodQuery = z.object({ from: daySchema, to: daySchema }).refine((q) => q.from <= q.to, { message: "La date de début doit précéder la date de fin", path: ["from"] }).refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 400, { message: "Période trop longue (13 mois au plus)", path: ["to"] });
export const exportQuery = z.object({ type: z.enum(["period", "products", "orders", "staff", "accounting"]), format: z.enum(["csv", "xlsx", "pdf"]), from: daySchema, to: daySchema }).refine((q) => q.from <= q.to, { message: "La date de début doit précéder la date de fin", path: ["from"] }).refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 400, { message: "Période trop longue (13 mois au plus)", path: ["to"] });

// Digital (Phase 6)
const modSel = z.array(z.object({ modifierId: uuid, quantity: z.number().int().min(1).max(20).optional() })).optional();
export const publicLineSchema = z.object({ id: uuid, productId: uuid.optional(), menuId: uuid.optional(), variantId: uuid.nullable().optional(), quantity: z.number().int().min(1).max(50), modifiers: modSel, menuSelections: z.array(z.object({ sectionId: uuid, productId: uuid, modifiers: modSel })).optional(), notes: z.string().max(200).nullable().optional() });
export const tableOrderSchema = z.object({ id: uuid, lines: z.array(publicLineSchema).min(1).max(60), covers: z.number().int().min(1).max(50).optional(), notes: z.string().max(300).nullable().optional() });
export const callWaiterSchema = z.object({ reason: z.string().max(120).nullable().optional() });
export const onlineOrderSchema = z.object({ id: uuid, mode: z.enum(["PICKUP", "DELIVERY"]), name: z.string().min(2).max(80), phone: z.string().min(6).max(30), email: z.string().email().max(160).nullable().optional().or(z.literal("")), when: z.string().max(40).nullable().optional(), address: z.string().max(300).nullable().optional(), zone: z.string().max(80).nullable().optional(), notes: z.string().max(300).nullable().optional(), lines: z.array(publicLineSchema).min(1).max(60), lang: z.enum(["fr", "en", "ty"]).optional() });
export const kioskOrderSchema = z.object({ id: uuid, mode: z.enum(["DINE_IN", "TAKEAWAY"]), name: z.string().max(40).nullable().optional(), lines: z.array(publicLineSchema).min(1).max(60), lang: z.enum(["fr", "en", "ty"]).optional() });
// « website » : champ piège invisible pour un humain ; seuls les robots le remplissent
export const publicReservationSchema = z.object({ website: z.string().max(200).optional(), name: z.string().min(2).max(80), phone: z.string().min(6).max(30).refine((v) => v.replace(/\D/g, "").length >= 6, "Numéro de téléphone invalide"), email: z.string({ error: "E-mail obligatoire : le restaurant vous répond par e-mail" }).trim().email("Adresse e-mail invalide").max(160), startsAt: z.string().datetime({ offset: true }), partySize: z.number().int().min(1).max(50), notes: z.string().max(300).nullable().optional(), allergies: z.string().max(200).nullable().optional() });
export const reservationSchema = z.object({
  name: z.string().trim().min(1).max(80), phone: z.string().max(30).nullable().optional(), email: z.string().email().max(160).nullable().optional().or(z.literal("").transform(() => null)),
  startsAt: z.string().datetime({ offset: true }), partySize: z.number().int().min(1).max(50), tableId: uuid.nullable().optional(),
  notes: z.string().max(300).nullable().optional(), allergies: z.string().max(200).nullable().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "ARRIVED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(), customerId: uuid.nullable().optional(),
  durationMinutes: z.number().int().min(15).max(360).optional(), source: z.enum(["PHONE", "WALK_IN", "ONLINE", "OTHER"]).optional(), tags: z.array(z.string().max(30)).max(10).optional(), notify: z.boolean().optional(),
});
export const reservationStatusSchema = z.object({ status: z.enum(["PENDING", "CONFIRMED", "ARRIVED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"]), tableId: uuid.nullable().optional(), notify: z.boolean().optional(), message: z.string().trim().max(300).nullable().optional(), expect: z.enum(["PENDING", "CONFIRMED", "ARRIVED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional() });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const reservationSettingsSchema = z.object({
  services: z.array(z.object({ key: z.enum(["lunch", "dinner"]), label: z.string().max(20).optional(), enabled: z.boolean(), from: hhmm, to: hhmm })).max(2).optional(),
  interval: z.number().int().optional(), duration: z.number().int().min(30).max(300).optional(), capacity: z.number().int().min(1).max(2000).nullable().optional(),
});
export const customerSchema = z.object({ firstName: z.string().max(80).nullable().optional(), lastName: z.string().max(80).nullable().optional(), phone: z.string().max(30).nullable().optional(), email: z.string().email().max(160).nullable().optional().or(z.literal("")), notes: z.string().max(1000).nullable().optional(), allergies: z.string().max(300).nullable().optional(), birthday: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Anniversaire au format MM-JJ").nullable().optional().or(z.literal("")), marketingConsent: z.boolean().optional() });
export const attachCustomerSchema = z.object({ customerId: uuid.nullable() });
export const redeemSchema = z.object({ rewards: z.number().int().min(1).max(10).optional() });
export const adjustPointsSchema = z.object({ points: z.number().int().min(-100000).max(100000), reason: z.string().min(1).max(200) });
export const rejectSchema = z.object({ reason: z.string().min(1).max(200) });
const httpUrl = z.string().max(500).refine((v) => v === "" || /^https?:\/\//.test(v), "Adresse web attendue (https://…)");
// Photo : adresse web, ou photo enregistrée dans ManaResto (/api/uploads/…, photos de démonstration /demo/…) ; jamais « //hôte »
const imageUrl = z.string().max(500).refine((v) => v === "" || /^https?:\/\//.test(v) || /^\/(?!\/)[\w\-./%]+$/.test(v), "Adresse de photo attendue (https://… ou photo envoyée)");
export const digitalSettingsSchema = z.object({
  qrMode: z.enum(["MENU", "MENU_CALL", "ORDER", "ORDER_DIRECT"]).optional(),
  online: z.object({ enabled: z.boolean(), pickup: z.boolean(), delivery: z.boolean(), pickupLeadMin: z.number().int().min(0).max(240), deliveryFee: money, deliveryMinOrder: money, deliveryZones: z.array(z.string().min(1).max(80)).max(50), message: z.string().max(300) }).partial().optional(),
  kiosk: z.object({ enabled: z.boolean(), dineIn: z.boolean(), takeaway: z.boolean() }).partial().optional(),
  loyalty: z.object({ enabled: z.boolean(), pointsPer100: z.number().int().min(0).max(100), rewardPoints: z.number().int().min(1).max(100000), rewardValue: money }).partial().optional(),
  site: z.object({ enabled: z.boolean(), tagline: z.string().max(120), description: z.string().max(2000), coverUrl: imageUrl, logoUrl: imageUrl, photos: z.array(imageUrl.pipe(z.string().min(1))).max(12), facebook: httpUrl, instagram: httpUrl, showMenu: z.boolean(), showPrices: z.boolean(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).partial().optional(),
});

// Avancé (Phase 7)
export const apiKeySchema = z.object({ name: z.string().min(1).max(80), scopes: z.array(z.string()).min(1).max(10) });
export const boxSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const webhookSchema = z.object({ url: z.string().url().max(500), events: z.array(z.string()).min(1).max(20), description: z.string().max(200).nullable().optional(), isActive: z.boolean().optional() });
export const printerSchema = z.object({ name: z.string().min(1).max(60), kind: z.enum(["RECEIPT", "KITCHEN"]), driver: z.enum(["cloud-epson", "cloud-star", "escpos-network", "agent", "browser"]), terminalId: uuid.nullable().optional(), hasDrawer: z.boolean().optional(), drawerPin: z.union([z.literal(2), z.literal(5)]).optional(), connection: z.object({ host: z.string().max(80).optional(), port: z.number().int().min(1).max(65535).optional(), agentUrl: z.string().max(300).optional(), timeoutMs: z.number().int().min(500).max(30000).optional() }).optional(), paperWidthMm: z.number().int().min(40).max(112).optional(), stationId: uuid.nullable().optional(), isActive: z.boolean().optional() });
export const drawerOpenSchema = z.object({ reason: z.string().trim().max(200).nullable().optional() });
export const printSchema = z.object({ printerId: uuid, kind: z.enum(["receipt", "kitchen", "test", "drawer", "recap"]), orderId: uuid.optional(), ticketId: uuid.optional(), day: daySchema.optional() });
export const terminalChargeSchema = z.object({ orderId: uuid, amount: z.number().int().min(1), paymentId: uuid.optional(), splitLabel: z.string().max(60).nullable().optional() });
export const terminalSettingsSchema = z.object({ adapter: z.enum(["manual", "bridge"]), url: z.string().url().max(300).optional().or(z.literal("")), apiKey: z.string().max(200).optional(), terminalId: z.string().max(80).optional(), timeoutMs: z.number().int().min(5000).max(300000).optional() });
export const copyCatalogSchema = z.object({ fromId: uuid, products: z.boolean().optional(), menus: z.boolean().optional() });
export const apiOrdersQuery = z.object({ from: daySchema.optional(), to: daySchema.optional(), status: z.string().optional(), take: z.coerce.number().int().min(1).max(500).optional(), skip: z.coerce.number().int().min(0).optional() });

// ---------------------------------------------------------------- Suivi de service (Phase 9)
export const snoozeSchema = z.object({ minutes: z.number().int().min(1).max(120) });
export const serviceStepSchema = z.object({ status: z.enum(["PENDING", "DONE", "SKIPPED", "NOT_NEEDED"]), reason: z.string().max(200).nullable().optional() });
export const assignServerSchema = z.object({ serverId: uuid.nullable().optional() });
export const serviceSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  assignTo: z.enum(["SERVER", "TEAM"]).optional(),
  sound: z.boolean().optional(),
  vibrate: z.boolean().optional(),
  delays: z.object({ welcome: z.number().int().min(0).max(120), drinksCheck: z.number().int().min(0).max(120), foodCheck: z.number().int().min(0).max(120), dessertOffer: z.number().int().min(0).max(120), dessertCheck: z.number().int().min(0).max(120), bill: z.number().int().min(0).max(120), late: z.number().int().min(1).max(120) }).partial().optional(),
  steps: z.array(z.object({ key: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/), label: z.string().min(1).max(120) })).min(1).max(20).optional(),
});

// Site vitrine : demande de démonstration
const orBlank = (schema: z.ZodString) => schema.optional().or(z.literal(""));
export const demoRequestSchema = z.object({
  restaurantName: z.string().trim().min(2, "Nom de l'établissement requis").max(120),
  contactName: z.string().trim().min(2, "Nom du contact requis").max(120),
  // Un moyen de contact suffit : téléphone ou e-mail (vérifié plus bas)
  phone: orBlank(z.string().trim().max(30).refine((v) => v === "" || v.replace(/\D/g, "").length >= 6, "Téléphone invalide")),
  email: orBlank(z.string().trim().email("E-mail invalide").max(160)),
  commune: orBlank(z.string().trim().max(80)),
  kind: z.enum(["RESTAURANT", "ROULOTTE", "SNACK", "BAR", "CAFE", "AUTRE"]).optional().or(z.literal("")),
  message: z.string().trim().max(1000).optional().or(z.literal("")),
  consent: z.literal(true, { message: "Votre accord est nécessaire pour être recontacté" }),
  website: z.string().max(200).optional(), // pot de miel anti-spam : un robot le remplit, un humain ne le voit pas
  startedAt: z.number().optional(), // horodatage d'ouverture du formulaire (anti-robot)
}).refine((v) => !!(v.phone || v.email), { message: "Indiquez un téléphone ou un e-mail", path: ["phone"] });

// ─── Hygiène & HACCP ───
const celsius = z.number().min(-60).max(300); // °C, au dixième près
const hygieneDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ");
export const hygieneEquipmentSchema = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(["FRIDGE", "FREEZER", "HOT", "OTHER"]), minTemp: celsius, maxTemp: celsius, isActive: z.boolean().optional() })
  .refine((v) => v.minTemp <= v.maxTemp, { message: "La température minimale doit être inférieure ou égale à la maximale", path: ["maxTemp"] });
export const temperatureReadingSchema = z.object({ equipmentId: uuid, value: celsius, correctiveAction: z.string().trim().max(300).nullable().optional() });
export const cleaningTaskSchema = z.object({ name: z.string().trim().min(1).max(100), area: z.string().trim().max(60).nullable().optional(), frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]), instructions: z.string().trim().max(500).nullable().optional(), isActive: z.boolean().optional() });
export const cleaningDoneSchema = z.object({ note: z.string().trim().max(300).nullable().optional() });
export const traceRecordSchema = z.object({
  kind: z.enum(["RECEPTION", "PREPARATION"]), name: z.string().trim().min(1).max(120), supplierName: z.string().trim().max(120).nullable().optional(),
  lotNumber: z.string().trim().max(60).nullable().optional(), quantity: z.string().trim().max(40).nullable().optional(), temperature: celsius.nullable().optional(),
  compliant: z.boolean().optional(), issue: z.string().trim().max(300).nullable().optional(), useBy: hygieneDay.nullable().optional(),
});
export const traceCloseSchema = z.object({ reason: z.enum(["USED", "DISCARDED"]) });
export const hygieneRangeQuery = z.object({ from: hygieneDay.optional(), to: hygieneDay.optional() });

// ─── Comptes clients & factures pro ───
const optText = (n: number) => z.string().trim().max(n).nullable().optional();
export const customerAccountSchema = z.object({
  name: z.string().trim().min(1).max(120), tahitiNumber: optText(20), contactName: optText(120), email: z.string().trim().email().max(160).nullable().optional().or(z.literal("")),
  phone: optText(40), address: optText(300), creditLimit: z.number().int().min(0).max(100_000_000).nullable().optional(), paymentTermsDays: z.number().int().min(0).max(120).optional(),
  notes: optText(1000), isActive: z.boolean().optional(),
});
export const invoiceCreateSchema = z.object({ upTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export const settlementSchema = z.object({ amount: z.number().int().min(1).max(100_000_000), method: z.enum(["CASH", "CARD", "CHECK", "TRANSFER"]), reference: optText(80), note: optText(300) });

// ─── Marketing & cartes cadeaux ───
export const giftCardSaleSchema = z.object({
  amount: z.number().int().min(100).max(10_000_000), method: z.enum(["CASH", "CARD", "CHECK", "TRANSFER", "OFFERED"]), reference: z.string().trim().max(80).nullable().optional(),
  buyerName: z.string().trim().max(120).nullable().optional(), recipientName: z.string().trim().max(120).nullable().optional(), message: z.string().trim().max(300).nullable().optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export const giftCardCancelSchema = z.object({ reason: z.string().trim().min(1).max(200) });
export const campaignSegment = z.enum(["ALL", "INACTIVE", "BIRTHDAY_MONTH", "NEW"]);
export const campaignSchema = z.object({ name: z.string().trim().min(1).max(120), segment: campaignSegment, subject: z.string().trim().min(1).max(150), body: z.string().trim().min(1).max(5000) });
export const reviewSettingsSchema = z.object({ reviewUrl: z.string().trim().url().max(500).refine((u) => u.startsWith("https://"), "Adresse https:// attendue").nullable().or(z.literal("")) });

// ─── Écrans en salle ───
export const screenSchema = z.object({
  name: z.string().trim().min(1).max(60), categoryIds: z.array(uuid).max(100).optional(), showPrices: z.boolean().optional(), hideSoldOut: z.boolean().optional(), showImages: z.boolean().optional(),
  rotateSeconds: z.number().int().min(5).max(120).optional(), theme: z.enum(["lagoon", "night", "light"]).optional(), headline: z.string().trim().max(40).nullable().optional(),
  headlineText: z.string().trim().max(160).nullable().optional(), headlinePrice: z.number().int().min(0).max(10_000_000).nullable().optional(), isActive: z.boolean().optional(),
});

// ─── Traiteur & événements ───
const eventLine = z.object({
  label: z.string().trim().min(1).max(200), quantity: z.number().min(0.5).max(10_000).refine((q) => Number.isInteger(q * 2), "Quantité entière ou demie"),
  unitPrice: z.number().int().min(0).max(10_000_000), taxRateBps: z.number().int().min(0).max(5000), taxRateName: z.string().trim().max(40).nullable().optional().transform((v) => v ?? null),
});
const eventFields = {
  title: z.string().trim().min(1).max(120), kind: z.enum(["BUFFET", "WEDDING", "PRIVATE", "CORPORATE", "OTHER"]),
  startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), guests: z.number().int().min(1).max(5000),
  location: optText(200), privatize: z.boolean().optional(),
  clientName: z.string().trim().min(1).max(120), clientCompany: optText(120), clientTahitiNumber: optText(20), clientEmail: z.string().trim().email().max(160).nullable().optional().or(z.literal("")),
  clientPhone: optText(40), clientAddress: optText(300),
  lines: z.array(eventLine).max(200).optional(), depositAmount: z.number().int().min(0).max(100_000_000).optional(),
  quoteNotes: optText(3000), kitchenNotes: optText(3000), internalNotes: optText(3000),
};
export const eventCreateSchema = z.object(eventFields);
export const eventUpdateSchema = z.object(eventFields).partial();
export const quoteSendSchema = z.object({ email: z.boolean(), validityDays: z.number().int().min(1).max(180).optional() });
export const eventPaymentSchema = z.object({ amount: z.number().int().min(1).max(100_000_000), method: z.enum(["CASH", "CARD", "CHECK", "TRANSFER"]), reference: optText(80), refund: z.boolean().optional() });
export const eventInvoiceSchema = z.object({ dueDays: z.number().int().min(0).max(120).optional() });
export const eventCancelSchema = z.object({ reason: z.string().trim().min(1).max(300) });
export const quoteAcceptSchema = z.object({ name: z.string().trim().min(2).max(120), agree: z.literal(true) });

// Option Bar : happy hour, ardoises, verres offerts, fiches cocktails, cave du bar
export const barSettingsSchema = z.object({
  happyHours: z.array(z.object({
    id: z.string().min(1).max(40), name: z.string().trim().min(1).max(40), days: z.array(z.number().int().min(0).max(6)).max(7),
    start: hhmm, end: hhmm, discountBps: z.number().int().min(100).max(10000), categoryIds: z.array(uuid).max(50), productIds: z.array(uuid).max(300).default([]), enabled: z.boolean(),
  })).max(10),
});
export const tabCreateSchema = z.object({ id: uuid.optional(), name: z.string().trim().min(1).max(60), customerId: uuid.nullable().optional() });
export const offerItemSchema = z.object({ reason: z.string().trim().min(2).max(120), managerPin: pin.optional() });
export const unofferItemSchema = z.object({ managerPin: pin.optional() });
export const cocktailSchema = z.object({
  glass: z.string().trim().max(60).nullable().optional(), garnish: z.string().trim().max(120).nullable().optional(), method: z.string().trim().max(1000).nullable().optional(),
  doses: z.array(z.object({ ingredientId: uuid, quantity: z.number().min(0).max(10_000) })).max(20),
});
export const bottleSchema = z.object({
  name: z.string().trim().min(1).max(80), barKind: z.enum(["spirit", "wine", "beer", "soft", "syrup", "other"]), unit: z.enum(["cl", "pce"]),
  bottleMl: z.number().int().min(50).max(5000).nullable().optional(), minBottles: z.number().min(0).max(10_000).optional(), bottleCost: money.optional(),
});
export const bottleReceiveSchema = z.object({ bottles: z.number().positive().max(10_000), bottleCost: money.nullable().optional() });
export const bottleBreakageSchema = z.object({ quantity: z.number().positive().max(100_000), per: z.enum(["bottle", "unit"]), reason: z.string().trim().min(2).max(120) });
export const barInventorySchema = z.object({ counts: z.array(z.object({ id: uuid, bottles: z.number().min(0).max(100_000) })).min(1).max(500) });

// Cave à vin (option)
const year = z.number().int().min(1900).max(2100);
export const wineSchema = z.object({
  name: z.string().trim().min(1).max(80), producer: optText(80), appellation: optText(80), region: optText(60), country: optText(40),
  color: z.enum(["RED", "WHITE", "ROSE", "SPARKLING", "SWEET", "ORANGE"]), vintage: year.nullable().optional(), grapes: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  abv: z.number().min(0).max(25).nullable().optional(), isOrganic: z.boolean().optional(), tastingNotes: optText(1000), pairingNotes: optText(400), servingTemp: optText(20),
  drinkFrom: year.nullable().optional(), drinkUntil: year.nullable().optional(), location: optText(60), imageUrl: optText(500),
  keepDays: z.number().int().min(1).max(60).nullable().optional(), pairedProductIds: z.array(uuid).max(50).optional(), showOnList: z.boolean().optional(), isActive: z.boolean().optional(),
  bottleMl: z.number().int().min(100).max(15_000).optional(), minBottles: z.number().min(0).max(10_000).optional(), bottleCost: money.optional(),
});
export const wineFormatsSchema = z.object({
  categoryId: uuid.nullable().optional(), taxRateId: uuid.nullable().optional(), kitchenStationId: uuid.nullable().optional(),
  bottle: z.object({ priceTtc: money }).nullable().optional(),
  glass: z.object({ priceTtc: money, ml: z.number().int().min(50).max(1500) }).nullable().optional(),
  carafe: z.object({ priceTtc: money, ml: z.number().int().min(50).max(1500) }).nullable().optional(),
});
export const wineReceiveSchema = z.object({ bottles: z.number().int().positive().max(10_000), bottleCost: money.nullable().optional(), note: optText(120) });
export const wineRemoveSchema = z.object({ bottles: z.number().positive().max(10_000), kind: z.enum(["BREAKAGE", "LOSS", "INTERNAL_USE"]), reason: z.string().trim().min(2).max(120) });
export const wineInventorySchema = z.object({ counts: z.array(z.object({ id: uuid, bottles: z.number().min(0).max(100_000) })).min(1).max(1000), location: optText(60) });
export const wineSettingsSchema = z.object({ showOnSite: z.boolean().optional(), listTitle: z.string().trim().max(60).optional(), listIntro: z.string().trim().max(400).optional(), hideOutOfStock: z.boolean().optional() });
export const wineOpenAdjustSchema = z.object({ remainingMl: z.number().int().min(0).max(15_000) });
export const wineDiscardSchema = z.object({ reason: optText(120) });
