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
export const orderCreateSchema = z.object({ id: uuid.optional(), type: orderType.default("DINE_IN"), tableId: uuid.nullable().optional(), covers: z.number().int().min(1).max(200).optional(), customerName: z.string().max(80).nullable().optional(), notes: z.string().max(500).nullable().optional() });
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
