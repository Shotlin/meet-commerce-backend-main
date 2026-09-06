# Production Readiness Verification Checklist

**Reference Contract:** *Meet Commerce Backend Specification Version 1.0 (§12)*  
**Verification Date:** 6 August 2026

---

## 1. P0 Release Blockers Checklist (Spec §12.1)

- [x] **Canonical Models Selected**: Single write paths for Carts, Orders, Inventory, Vendors, and Riders (`src/app.js`, `src/modules/cart-quote`, `src/modules/orders`, `src/modules/inventory`).
- [x] **Customer Order Ownership**: `assertCustomerResource` enforces `orders.customer_id === principal.userId` (`src/core/permissions/object-policy.js`).
- [x] **Vendor & Warehouse Scope Protection**: `assertVendorResource` and `assertWarehouseResource` block cross-tenant access (`src/core/permissions/object-policy.js`).
- [x] **Vendor/Warehouse Staff Login**: Scoped JWT token issuance from `vendor_users` / `warehouse_users` (`src/modules/vendors/vendor-staff.service.js`).
- [x] **Dashboard 2FA & Session Revocation**: TOTP enrolment, single-use recovery codes, and `session_version` bumping (`src/modules/auth/user-2fa.service.js`).
- [x] **Public Loyalty Mutation Disabled**: Restricted to internal ledger transactions (`src/modules/wallet/wallet.service.js`).
- [x] **FEFO Concurrency Safety**: Row locking (`FOR UPDATE SKIP LOCKED`) and quantity guards (`quantity_on_hand >= quantity_reserved`) (`src/modules/inventory/inventory.repository.js`).
- [x] **Payment Verification**: Canonical order coupling, paise amount validation, and Razorpay sandbox verification (`src/modules/payments/payments.service.js`).
- [x] **Webhook Replay Protection**: Raw body HMAC signature verification and provider event deduplication (`src/modules/payments/payments.repository.js`).
- [x] **Procurement & QC Route Plugins Mounted**: Registered in `src/app.js` under `/api/v1/procurement` and `/api/v1/warehouse-receipts`.
- [x] **Socket.IO Room Authorization**: Object ownership validation on `order:track` room joins (`src/plugins/socketio.plugin.js`).
- [x] **Report SQL Integration**: Analytical SQL reporting views (`v_vendor_summary`, `v_inventory_summary`) validated against PostgreSQL schema (`109_admin_reports_views.sql`).
- [x] **Full API Test Suite Execution**: 1,829 / 1,829 tests passing in Vitest (`tests/`).

---

## 2. Domain-Completion Gate Checklist (Spec §12.2)

- [x] **Procurement Request & Vendor Response**: `procurement_orders` state machine complete.
- [x] **Supply-Batch Evidence & Dispatch Readiness**: Evidence checklist validator implemented.
- [x] **Warehouse Physical Receipt & QC**: Measurement facts and per-line QC decisions verified.
- [x] **Accepted Stock Posting**: Single-transaction lot creation from final QC disposition.
- [x] **Inventory Reservation Consume/Release**: Reservation lifecycle (`ACTIVE` -> `CONSUMED` / `RELEASED` / `EXPIRED`).
- [x] **Pricing, Tax & Quote Engine**: Server-authoritative price calculation ignoring client input.
- [x] **Order Compensation Logic**: Multi-resource compensation across stock, payment, and wallet.
- [x] **Picking, Weight & Dispatch**: Picker lot scan validation and packaging seal tracking.
- [x] **Rider Accept, OTP & Delivery Proof**: Server-generated delivery OTP and photo proof verification.
- [x] **Complaint, Refund & Recall Traceability**: Lot-to-vendor complaint tracing and recall lot blocking.

---

## 3. Hardening & Approval Verification

- [x] **OpenAPI Complete**: 454 path operations generated and validated (`artifacts/openapi.json`).
- [x] **Structured Logging**: Request ID, tenant scope, correlation IDs logged without PII secrets.
- [x] **Observability**: Process metrics, queue health, DB connection pool checks.
- [x] **Test Execution Evidence**: 100% PASS rate across all 167 test files.
