# Turbo LEV CRM — canonical domain contracts

## Purpose

`Client`, `Vehicle`, `Employee` and `WorkOrder` are cross-module entities. Their core wire shape must be defined once and reused by API consumers, cabinet read models and future module extraction.

Canonical contracts live in:

- `src/lib/contracts/crm-core.ts` — stable TypeScript entity/read-model contracts;
- `src/lib/contracts/crm-core.parsers.ts` — runtime parsing of `unknown` payloads at API/UI boundaries.

## Rules

1. A UI must not create another independent definition of the same core entity fields when the canonical contract already covers them.
2. JSON returned by an API is treated as `unknown` until it is parsed/narrowed at the client boundary.
3. Prisma models are persistence models, not browser contracts. Client components must not import Prisma payload types.
4. Module-specific data extends a core contract through a read model instead of changing the meaning of the core entity.
5. Contract changes are additive by default. Removing/renaming an existing field requires an explicit migration of all affected API consumers.
6. Money/decimal values use `CrmDecimal = string | number` at the wire boundary because Prisma Decimal serialisation and older API paths are not yet uniform.
7. Date/time values are wire strings. Business date calculations remain in domain/services, not in the contract layer.

## Core entities

### Client

Stable identity: `id`, `name`, `phone`, `createdAt`, `updatedAt`.

### Vehicle

Stable identity plus technical/configuration data used across Clients, Planner, Parts, Work Orders and Vehicle Images. Relations such as owner, diagnostics and work-order history are read-model fields layered on top.

### Employee

Stable personnel identity: name/contact/category/position/active state. Compensation, documents, role assignments and cabinet access are represented by `PersonnelItemContract`.

### WorkOrder

Stable identity: `id`, `status`, lifecycle timestamps. Workflow labels, gates, transitions, client/vehicle context and diagnostics are represented by `WorkOrderListItemContract` / `WorkOrderDetailContract`.

## Migration sequence

1. Contract foundation + smoke tests.
2. Clients / Vehicles directory APIs and screens.
3. Personnel API and screen.
4. Work Orders list/detail.
5. Planner / Mechanic / Service Manager read models built from these contracts.
6. Remove local duplicate entity types only after every consumer of that surface has migrated.

The migration deliberately preserves current API URLs and user-visible behaviour. This is an architectural safety refactor, not a business-flow rewrite.
