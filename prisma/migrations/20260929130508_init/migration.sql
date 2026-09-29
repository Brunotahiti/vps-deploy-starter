-- CreateEnum
CREATE TYPE "TerminalKind" AS ENUM ('POS', 'KDS', 'KIOSK', 'MANAGER');

-- CreateEnum
CREATE TYPE "RoomKind" AS ENUM ('INDOOR', 'TERRACE', 'BAR', 'OTHER');

-- CreateEnum
CREATE TYPE "TableShape" AS ENUM ('ROUND', 'SQUARE', 'RECT');

-- CreateEnum
CREATE TYPE "TableState" AS ENUM ('FREE', 'RESERVED', 'TO_CLEAN');

-- CreateEnum
CREATE TYPE "PrinterKind" AS ENUM ('RECEIPT', 'KITCHEN');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ARRIVED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'COUNTER', 'TAKEAWAY', 'DELIVERY', 'ONLINE', 'KIOSK');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'SENT', 'BILL_REQUESTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('PENDING', 'HOLD', 'SENT', 'FIRE', 'READY', 'SERVED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'SENT', 'PREPARING', 'READY', 'SERVED', 'VOIDED');

-- CreateEnum
CREATE TYPE "KitchenTicketStatus" AS ENUM ('NEW', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'CHECK', 'TRANSFER', 'MEAL_VOUCHER', 'COMPLIMENTARY', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementKind" AS ENUM ('OPENING', 'SALE', 'REFUND', 'PAY_IN', 'PAY_OUT', 'DEPOSIT', 'CORRECTION', 'CLOSING');

-- CreateEnum
CREATE TYPE "InventoryMovementKind" AS ENUM ('SALE', 'PURCHASE', 'ADJUSTMENT', 'LOSS', 'BREAKAGE', 'INTERNAL_USE', 'INVENTORY');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TimeEntryKind" AS ENUM ('CLOCK_IN', 'BREAK_START', 'BREAK_END', 'CLOCK_OUT');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "establishments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legal_name" TEXT,
    "tahiti_number" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "postal_code" TEXT,
    "island" TEXT,
    "country" TEXT NOT NULL DEFAULT 'PF',
    "phone" TEXT,
    "email" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'XPF',
    "currency_exponent" INTEGER NOT NULL DEFAULT 0,
    "locale" TEXT NOT NULL DEFAULT 'fr-PF',
    "timezone" TEXT NOT NULL DEFAULT 'Pacific/Tahiti',
    "tips_enabled" BOOLEAN NOT NULL DEFAULT false,
    "tip_presets_bps" JSONB NOT NULL DEFAULT '[500,1000,1500]',
    "opening_hours" JSONB,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "onboarding_step" INTEGER NOT NULL DEFAULT 0,
    "onboarding_done" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "establishments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "pin_hash" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "display_name" TEXT,
    "color" TEXT,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "user_establishments" (
    "user_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_establishments_pkey" PRIMARY KEY ("user_id","establishment_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "establishment_id" UUID,
    "terminal_id" UUID,
    "ip" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminals" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TerminalKind" NOT NULL DEFAULT 'POS',
    "device_key_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RoomKind" NOT NULL DEFAULT 'INDOOR',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 1200,
    "height" INTEGER NOT NULL DEFAULT 800,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 2,
    "shape" "TableShape" NOT NULL DEFAULT 'SQUARE',
    "x" INTEGER NOT NULL DEFAULT 0,
    "y" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 100,
    "height" INTEGER NOT NULL DEFAULT 100,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "state" "TableState" NOT NULL DEFAULT 'FREE',
    "qr_token" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#0EA5A4',
    "image_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_stations" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#F97316',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "warn_after_sec" INTEGER NOT NULL DEFAULT 600,
    "alert_after_sec" INTEGER NOT NULL DEFAULT 900,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "station_id" UUID,
    "name" TEXT NOT NULL,
    "kind" "PrinterKind" NOT NULL DEFAULT 'RECEIPT',
    "driver" TEXT NOT NULL DEFAULT 'escpos-network',
    "connection" JSONB NOT NULL DEFAULT '{}',
    "paper_width_mm" INTEGER NOT NULL DEFAULT 80,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "category_id" UUID,
    "tax_rate_id" UUID,
    "kitchen_station_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "color" TEXT,
    "price_ttc" INTEGER NOT NULL,
    "cost_price" INTEGER NOT NULL DEFAULT 0,
    "sku" TEXT,
    "barcode" TEXT,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "auto_unavailable" BOOLEAN NOT NULL DEFAULT false,
    "availability" JSONB,
    "track_stock" BOOLEAN NOT NULL DEFAULT false,
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "stock_min" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_ttc" INTEGER NOT NULL,
    "sku" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifiers" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_modifier_groups" (
    "product_id" UUID NOT NULL,
    "modifier_group_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_modifier_groups_pkey" PRIMARY KEY ("product_id","modifier_group_id")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "tax_rate_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_ttc" INTEGER NOT NULL,
    "color" TEXT,
    "image_url" TEXT,
    "availability" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_sections" (
    "id" UUID NOT NULL,
    "menu_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 1,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "supplement" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "allergies" TEXT,
    "visit_count" INTEGER NOT NULL DEFAULT 0,
    "total_spent" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "order_id" UUID,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "customer_id" UUID,
    "table_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "party_size" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "allergies" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_counters" (
    "establishment_id" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("establishment_id","day")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" "OrderType" NOT NULL DEFAULT 'DINE_IN',
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "table_id" UUID,
    "server_id" UUID,
    "terminal_id" UUID,
    "customer_id" UUID,
    "customer_name" TEXT,
    "covers" INTEGER NOT NULL DEFAULT 1,
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "discount_total" INTEGER NOT NULL DEFAULT 0,
    "discount_reason" TEXT,
    "tax_total" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "tip_total" INTEGER NOT NULL DEFAULT 0,
    "paid_total" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bill_requested_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "CourseStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "fired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "course_id" UUID,
    "product_id" UUID,
    "variant_id" UUID,
    "menu_id" UUID,
    "parent_item_id" UUID,
    "kitchen_station_id" UUID,
    "kitchen_ticket_id" UUID,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" INTEGER NOT NULL,
    "modifiers_total" INTEGER NOT NULL DEFAULT 0,
    "discount_amount" INTEGER NOT NULL DEFAULT 0,
    "line_total" INTEGER NOT NULL DEFAULT 0,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "tax_rate_name" TEXT,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "cost_price" INTEGER NOT NULL DEFAULT 0,
    "seat_number" INTEGER,
    "notes" TEXT,
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "served_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_modifiers" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "modifier_id" UUID,
    "group_name" TEXT,
    "name" TEXT NOT NULL,
    "price_delta" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_tickets" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "course_id" UUID,
    "station_id" UUID,
    "status" "KitchenTicketStatus" NOT NULL DEFAULT 'NEW',
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "kitchen_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_method_configs" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "label" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "opens_drawer" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "provider_config" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_method_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "cash_session_id" UUID,
    "received_by_id" UUID,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "amount" INTEGER NOT NULL,
    "tip_amount" INTEGER NOT NULL DEFAULT 0,
    "tendered" INTEGER,
    "change_given" INTEGER NOT NULL DEFAULT 0,
    "refunded_amount" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "split_label" TEXT,
    "provider_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "issued_by_id" UUID,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "terminal_id" UUID,
    "opened_by_id" UUID NOT NULL,
    "closed_by_id" UUID,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opening_float" INTEGER NOT NULL,
    "expected_cash" INTEGER,
    "counted_cash" INTEGER,
    "difference" INTEGER,
    "notes" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "cash_session_id" UUID NOT NULL,
    "user_id" UUID,
    "payment_id" UUID,
    "order_id" UUID,
    "kind" "CashMovementKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pce',
    "stock_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "stock_min" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avg_cost" INTEGER NOT NULL DEFAULT 0,
    "last_cost" INTEGER NOT NULL DEFAULT 0,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "user_id" UUID,
    "kind" "InventoryMovementKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" INTEGER,
    "reason" TEXT,
    "reference_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "ingredient_id" UUID,
    "product_id" UUID,
    "reference" TEXT,
    "name" TEXT NOT NULL,
    "pack_size" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "last_price" INTEGER NOT NULL DEFAULT 0,
    "avg_price" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expected_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "total" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "supplier_product_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "received_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unit_price" INTEGER NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "user_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "job_title" TEXT,
    "hourly_cost" INTEGER,
    "pin_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" "TimeEntryKind" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminal_id" UUID,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "establishment_id" UUID,
    "user_id" UUID,
    "authorized_by_id" UUID,
    "terminal_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "establishment_id" UUID NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "establishments_organization_id_idx" ON "establishments"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "establishments_organization_id_slug_key" ON "establishments"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "roles"("organization_id", "key");

-- CreateIndex
CREATE INDEX "user_establishments_establishment_id_idx" ON "user_establishments"("establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "terminals_device_key_hash_key" ON "terminals"("device_key_hash");

-- CreateIndex
CREATE INDEX "terminals_establishment_id_idx" ON "terminals"("establishment_id");

-- CreateIndex
CREATE INDEX "rooms_establishment_id_idx" ON "rooms"("establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "tables_qr_token_key" ON "tables"("qr_token");

-- CreateIndex
CREATE INDEX "tables_establishment_id_idx" ON "tables"("establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "tables_room_id_name_key" ON "tables"("room_id", "name");

-- CreateIndex
CREATE INDEX "tax_rates_establishment_id_idx" ON "tax_rates"("establishment_id");

-- CreateIndex
CREATE INDEX "categories_establishment_id_sort_order_idx" ON "categories"("establishment_id", "sort_order");

-- CreateIndex
CREATE INDEX "kitchen_stations_establishment_id_idx" ON "kitchen_stations"("establishment_id");

-- CreateIndex
CREATE INDEX "printers_establishment_id_idx" ON "printers"("establishment_id");

-- CreateIndex
CREATE INDEX "products_establishment_id_category_id_idx" ON "products"("establishment_id", "category_id");

-- CreateIndex
CREATE INDEX "products_establishment_id_barcode_idx" ON "products"("establishment_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "products_establishment_id_sku_key" ON "products"("establishment_id", "sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "modifier_groups_establishment_id_idx" ON "modifier_groups"("establishment_id");

-- CreateIndex
CREATE INDEX "modifiers_group_id_idx" ON "modifiers"("group_id");

-- CreateIndex
CREATE INDEX "menus_establishment_id_idx" ON "menus"("establishment_id");

-- CreateIndex
CREATE INDEX "menu_sections_menu_id_idx" ON "menu_sections"("menu_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_section_id_product_id_key" ON "menu_items"("section_id", "product_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_phone_idx" ON "customers"("organization_id", "phone");

-- CreateIndex
CREATE INDEX "customers_organization_id_email_idx" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_establishment_id_customer_id_key" ON "loyalty_accounts"("establishment_id", "customer_id");

-- CreateIndex
CREATE INDEX "loyalty_transactions_account_id_idx" ON "loyalty_transactions"("account_id");

-- CreateIndex
CREATE INDEX "reservations_establishment_id_starts_at_idx" ON "reservations"("establishment_id", "starts_at");

-- CreateIndex
CREATE INDEX "orders_establishment_id_status_idx" ON "orders"("establishment_id", "status");

-- CreateIndex
CREATE INDEX "orders_establishment_id_opened_at_idx" ON "orders"("establishment_id", "opened_at");

-- CreateIndex
CREATE INDEX "orders_table_id_idx" ON "orders"("table_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_establishment_id_number_key" ON "orders"("establishment_id", "number");

-- CreateIndex
CREATE INDEX "courses_order_id_idx" ON "courses"("order_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_kitchen_ticket_id_idx" ON "order_items"("kitchen_ticket_id");

-- CreateIndex
CREATE INDEX "order_item_modifiers_order_item_id_idx" ON "order_item_modifiers"("order_item_id");

-- CreateIndex
CREATE INDEX "kitchen_tickets_station_id_status_idx" ON "kitchen_tickets"("station_id", "status");

-- CreateIndex
CREATE INDEX "kitchen_tickets_order_id_idx" ON "kitchen_tickets"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_configs_establishment_id_method_key" ON "payment_method_configs"("establishment_id", "method");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_establishment_id_created_at_idx" ON "payments"("establishment_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_cash_session_id_idx" ON "payments"("cash_session_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "cash_sessions_establishment_id_status_idx" ON "cash_sessions"("establishment_id", "status");

-- CreateIndex
CREATE INDEX "cash_movements_cash_session_id_idx" ON "cash_movements"("cash_session_id");

-- CreateIndex
CREATE INDEX "ingredients_establishment_id_idx" ON "ingredients"("establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_product_id_ingredient_id_key" ON "recipes"("product_id", "ingredient_id");

-- CreateIndex
CREATE INDEX "inventory_movements_establishment_id_created_at_idx" ON "inventory_movements"("establishment_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_ingredient_id_idx" ON "inventory_movements"("ingredient_id");

-- CreateIndex
CREATE INDEX "suppliers_establishment_id_idx" ON "suppliers"("establishment_id");

-- CreateIndex
CREATE INDEX "supplier_products_supplier_id_idx" ON "supplier_products"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_establishment_id_number_key" ON "purchase_orders"("establishment_id", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchase_order_id_idx" ON "purchase_order_lines"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_establishment_id_idx" ON "employees"("establishment_id");

-- CreateIndex
CREATE INDEX "shifts_establishment_id_starts_at_idx" ON "shifts"("establishment_id", "starts_at");

-- CreateIndex
CREATE INDEX "time_entries_establishment_id_at_idx" ON "time_entries"("establishment_id", "at");

-- CreateIndex
CREATE INDEX "time_entries_employee_id_at_idx" ON "time_entries"("employee_id", "at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_establishment_id_created_at_idx" ON "audit_logs"("establishment_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- AddForeignKey
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_establishments" ADD CONSTRAINT "user_establishments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_establishments" ADD CONSTRAINT "user_establishments_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_establishments" ADD CONSTRAINT "user_establishments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_kitchen_station_id_fkey" FOREIGN KEY ("kitchen_station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_modifier_group_id_fkey" FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_sections" ADD CONSTRAINT "menu_sections_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "menu_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_kitchen_ticket_id_fkey" FOREIGN KEY ("kitchen_ticket_id") REFERENCES "kitchen_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_id_fkey" FOREIGN KEY ("modifier_id") REFERENCES "modifiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_method_configs" ADD CONSTRAINT "payment_method_configs_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_supplier_product_id_fkey" FOREIGN KEY ("supplier_product_id") REFERENCES "supplier_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
